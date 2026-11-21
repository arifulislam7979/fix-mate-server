import "dotenv/config";
import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import Stripe from "stripe";

const app = express();
const port = process.env.PORT || 5000;
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

app.use(cors());

const client = new MongoClient(process.env.MONGODB_URI);
export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}
const connectMongoDB = await connectToMongoDB();
const db = connectMongoDB.db("fix-mate");
const users = db.collection("user");
const services = db.collection("services");
const bookings = db.collection("bookings");
const payments = db.collection("payments");

app.post(
  "/api/webhooks/stripe",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const signature = req.headers["stripe-signature"];

    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET,
      );
    } catch (err) {
      console.error("Webhook signature verification failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      if (session.payment_status === "paid") {
        const bookingId = session.metadata?.bookingId;

        if (bookingId && ObjectId.isValid(bookingId)) {
          const bookingObjectId = new ObjectId(bookingId);
          const existingBooking = await bookings.findOne({
            _id: bookingObjectId,
          });

          if (existingBooking) {
            const transactionId =
              typeof session.payment_intent === "string"
                ? session.payment_intent
                : session.id;

            const paidAmount =
              typeof session.amount_total === "number"
                ? session.amount_total / 100
                : Number(
                    existingBooking.finalAmount ??
                      existingBooking.basePrice ??
                      0,
                  );

            await bookings.updateOne(
              { _id: bookingObjectId },
              {
                $set: {
                  paymentStatus: "paid",
                  paidAt: new Date(),
                  updatedAt: new Date(),
                  transactionId,
                  stripeSessionId: session.id,
                },
              },
            );

            await payments.updateOne(
              { stripeSessionId: session.id },
              {
                $setOnInsert: {
                  bookingId: bookingObjectId,
                  serviceTitle:
                    existingBooking.serviceTitle || "Repair Service",
                  customerEmail:
                    session.customer_email ||
                    existingBooking.customerEmail ||
                    "",
                  technicianEmail: existingBooking.technicianEmail || "",
                  amount: paidAmount,
                  currency: session.currency || "usd",
                  transactionId,
                  stripeSessionId: session.id,
                  status: "paid",
                  paidAt: new Date(),
                },
              },
              { upsert: true },
            );
          }
        }
      }
    }

    return res.status(200).json({ received: true });
  },
);

app.use(express.json());

app.get("/", (req, res) => {
  res.send("Hello World!");
});

// User Related api
app.get("/users", async (req, res) => {
  const { email } = req.query;

  if (email) {
    const user = await users.findOne({ email: String(email).trim() });
    return res.send(user || null);
  }
  const cursor = users.find({});
  const result = await cursor.toArray();
  res.send(result);
});

app.patch("/users/:id/role", async (req, res) => {
  const id = req.params.id;
  const query = { _id: new ObjectId(id) };
  const { role } = req.body;
  const updateDoc = {
    $set: {
      role: role,
    },
  };
  const result = await users.updateOne(query, updateDoc);
  res.send(result);
});

app.delete("/users/:id", async (req, res) => {
  const id = req.params.id;
  const query = { _id: new ObjectId(id) };
  const result = await users.deleteOne(query);
  res.send(result);
});

app.patch("/users/:id/profile", async (req, res) => {
  const { id } = req.params;
  const { name, phone, area, bio, image } = req.body;

  if (!ObjectId.isValid(id)) {
    return res.status(400).send({ message: "Invalid user ID" });
  }
  const query = { _id: new ObjectId(id) };
  const updateFields = {
    updatedAt: new Date(),
  };

  if (typeof name === "string" && name.trim()) updateFields.name = name.trim();
  if (typeof phone === "string") updateFields.phone = phone.trim();
  if (typeof area === "string") updateFields.area = area.trim();
  if (typeof bio === "string") updateFields.bio = bio.trim();
  if (typeof image === "string") updateFields.image = image.trim();

  const updatedDoc = {
    $set: updateFields,
  };

  const result = await users.updateOne(query, updatedDoc);
  res.send(result);
});

// Services Related api
app.get("/services", async (req, res) => {
  const query = {};
  const andConditions = [];

  if (req.query) {
    if (req.query.technicianEmail) {
      query.technicianEmail = req.query.technicianEmail;
    }

    if (req.query.approvalStatus) {
      query.approvalStatus = req.query.approvalStatus;
    }

    if (req.query.isAvailable !== undefined) {
      query.isAvailable = req.query.isAvailable === "true";
    }

    const searchText = String(req.query.q || "").trim();
    if (searchText) {
      const searchRegex = new RegExp(searchText, "i");
      andConditions.push({
        $or: [
          { title: searchRegex },
          { serviceTitle: searchRegex },
          { category: searchRegex },
          { description: searchRegex },
        ],
      });
    }

    // 2. Category filter (e.g. ?category=AC)
    const categoryVal = req.query.category;
    if (categoryVal && categoryVal.toLowerCase() !== "all") {
      query.category = new RegExp(`^${categoryVal}$`, "i");
    }

    // 3. Service mode / delivery type filter (e.g. ?mode=Shop Drop-off)
    const modeVal = req.query.mode;
    if (modeVal && modeVal.toLowerCase() !== "all") {
      const modeRegex = new RegExp(`^${modeVal}$`, "i");
      andConditions.push({
        $or: [
          { serviceMode: modeRegex },
          { deliveryType: modeRegex },
          { mode: modeRegex },
        ],
      });
    }
  }
  if (andConditions.length > 0) {
    query.$and = andConditions;
  }

  let sortOption = { createdAt: -1, _id: -1 };
  const sortKey = String(req.query?.sort || "newest")
    .trim()
    .toLowerCase();

  if (sortKey === "price_asc" || sortKey === "low_to_high") {
    sortOption = { basePrice: 1, price: 1, _id: 1 };
  } else if (sortKey === "price_desc" || sortKey === "high_to_low") {
    sortOption = { basePrice: -1, price: -1, _id: -1 };
  }

  const cursor = services.find(query).sort(sortOption);
  const result = await cursor.toArray();
  res.send(result);
});

app.get("/services/latest", async (req, res) => {
  const query = {
    approvalStatus: "approved",
    isAvailable: true,
  };
  const result = await services
    .find(query)
    .sort({ createdAt: -1, _id: -1 })
    .limit(6)
    .toArray();
  res.send(result);
});

app.post("/services", async (req, res) => {
  const data = req.body;
  const newService = {
    ...data,
    approvalStatus: data.approvalStatus || "pending",
    isAvailable: data.isAvailable ?? true,
    createdAt: new Date(),
  };
  const result = await services.insertOne(newService);
  res.send(result);
});

app.patch("/services/:id", async (req, res) => {
  const id = req.params.id;
  const query = { _id: new ObjectId(id) };
  const updateData = req.body;

  const updateFields = {
    ...updateData,
  };

  if (
    updateData.title ||
    updateData.category ||
    updateData.description ||
    updateData.basePrice
  ) {
    updateFields.approvalStatus = "pending";
  }

  const updateDoc = {
    $set: updateFields,
  };

  const result = await services.updateOne(query, updateDoc);

  if (result.matchedCount === 0) {
    return res
      .status(404)
      .json({ success: false, message: "Service not found" });
  }

  res.status(200).json({
    success: true,
    message: "Availability updated successfully",
    result,
  });
});

app.get("/services/:id", async (req, res) => {
  const id = req.params.id;
  const query = { _id: new ObjectId(id) };
  const result = await services.findOne(query);
  res.send(result);
});
// admin and technician api
app.delete("/services/:id", async (req, res) => {
  const id = req.params.id;
  const query = { _id: new ObjectId(id) };
  const result = await services.deleteOne(query);
  res.send(result);
});
// admin services api
app.patch("/services/:id/status", async (req, res) => {
  const id = req.params.id;
  const { approvalStatus } = req.body;
  const query = { _id: new ObjectId(id) };
  const updateDoc = {
    $set: {
      approvalStatus: approvalStatus,
    },
  };
  const result = await services.updateOne(query, updateDoc);
  res.send(result);
});

// Bookings Related api
app.post("/bookings", async (req, res) => {
  const data = req.body;
  const { customerRole, customerEmail } = data;

  if (String(customerRole || "").toLowerCase() !== "customer") {
    return res.status(403).send({
      success: false,
      message: "Only customers are allowed to book services.",
    });
  }
  const { customerRole: _role, ...bookingData } = data;

  const newBooking = {
    ...bookingData,
    status: bookingData.status || "requested",
    paymentStatus: bookingData.paymentStatus || "unpaid",
    createdAt: new Date(),
  };
  const result = await bookings.insertOne(newBooking);
  res.status(201).send({
    success: true,
    insertedId: result.insertedId,
    result,
  });
});

app.get("/bookings", async (req, res) => {
  const { customerEmail, technicianEmail, status, search } = req.query;
  const query = {};

  if (typeof customerEmail === "string" && customerEmail.trim()) {
    query.customerEmail = customerEmail.trim().toLowerCase();
  }

  if (typeof technicianEmail === "string" && technicianEmail.trim()) {
    query.technicianEmail = technicianEmail.trim().toLowerCase();
  }

  if (
    typeof status === "string" &&
    status.trim() &&
    status.trim().toLowerCase() !== "all"
  ) {
    query.status = status.trim().toLowerCase();
  }
  if (typeof search === "string" && search.trim()) {
    const safeRegex = new RegExp(
      search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "i",
    );
    query.$or = [
      { serviceTitle: safeRegex },
      { customerName: safeRegex },
      { customerEmail: safeRegex },
      { customerPhone: safeRegex },
      { address: safeRegex },
      { problemDescription: safeRegex },
    ];
  }

  const result = await bookings
    .find(query)
    .sort({ createdAt: -1, _id: -1 })
    .toArray();

  return res.status(200).json(result);
});

app.patch("/bookings/:id/cancel", async (req, res) => {
  const id = req.params.id;
  const query = { _id: new ObjectId(id) };
  const booking = await bookings.findOne(query);

  if (!booking) {
    return res.status(404).send({
      success: false,
      message: "Booking not found.",
    });
  }

  if (booking.status !== "requested") {
    return res.status(400).send({
      success: false,
      message: "Only requested bookings can be cancelled.",
    });
  }
  const updateDoc = {
    $set: {
      status: "cancelled",
      updatedAt: new Date(),
    },
  };

  const result = await bookings.updateOne(query, updateDoc);
  res.send({
    success: true,
    modifiedCount: result.modifiedCount,
  });
});

// technician api
app.patch("/bookings/:id/status", async (req, res) => {
  const { id } = req.params;
  const { status, finalAmount, technicianEmail } = req.body || {};

  const allowedStatuses = [
    "requested",
    "accepted",
    "in-progress",
    "completed",
    "rejected",
    "cancelled",
  ];

  if (typeof status !== "string" || !allowedStatuses.includes(status)) {
    return res.status(400).json({
      success: false,
      message: "Invalid booking status",
    });
  }

  const query = { _id: new ObjectId(id) };
  const existingBooking = await bookings.findOne(query);

  if (!existingBooking) {
    return res.status(404).json({
      success: false,
      message: "Booking not found",
    });
  }

  if (
    typeof technicianEmail === "string" &&
    technicianEmail.trim() &&
    existingBooking.technicianEmail &&
    existingBooking.technicianEmail.trim().toLowerCase() !==
      technicianEmail.trim().toLowerCase()
  ) {
    return res.status(403).json({
      success: false,
      message: "You are not authorized to update this booking",
    });
  }

  const updateFields = {
    status,
    updatedAt: new Date(),
  };

  if (status === "completed") {
    const numericFinalAmount = Number(finalAmount);
    updateFields.finalAmount = numericFinalAmount;
  } else if (typeof finalAmount === "number" && finalAmount > 0) {
    updateFields.finalAmount = finalAmount;
  }

  const updatedBooking = await bookings.findOneAndUpdate(
    query,
    { $set: updateFields },
    { returnDocument: "after" },
  );

  const finalDoc = updatedBooking?.value || updatedBooking;

  return res.status(200).json({
    success: true,
    message: "Booking status updated successfully",
    booking: finalDoc,
  });
});
// Payment related api

app.post("/create-checkout-session", async (req, res) => {
  const bookingId = req.body._id;
  const customerEmail = req.body.customerEmail;

  if (!bookingId) {
    return res.status(400).json({ message: "Valid bookingId is required" });
  }
  const booking = await bookings.findOne({ _id: new ObjectId(bookingId) });

  if (!booking) {
    return res.status(404).json({ message: "Booking not found" });
  }

  // check
  if (
    customerEmail &&
    booking.customerEmail?.toLowerCase() !== customerEmail.trim().toLowerCase()
  ) {
    return res.status(403).json({ message: "Unauthorized booking payment" });
  }

  if (booking.status !== "completed") {
    return res
      .status(400)
      .json({ message: "Payment is only allowed after job completion" });
  }

  if (booking.paymentStatus === "paid") {
    return res.status(400).json({ message: "This booking is already paid" });
  }
  const amount = Number(booking.finalAmount ?? booking.basePrice ?? 0);
  if (Number.isNaN(amount) || amount <= 0) {
    return res.status(400).json({ message: "Invalid payable amount" });
  }

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: booking.customerEmail,
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: booking.serviceTitle,
            description: `Technician: ${booking.technicianName}`,
          },
          unit_amount: Math.round(amount * 100),
        },
        quantity: 1,
      },
    ],
    metadata: {
      bookingId: booking._id.toString(),
      customerEmail: booking.customerEmail,
      technicianEmail: booking.technicianEmail,
    },

    success_url: `${process.env.CLIENT_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}&bookingId=${booking._id.toString()}`,
    cancel_url: `${process.env.CLIENT_URL}/payment/cancel?bookingId=${booking._id.toString()}`,
  });

  return res.status(200).json({ url: session.url, sessionId: session.id });
});

app.get("/payments", async (req, res) => {
  const { customerEmail, technicianEmail } = req.query;
  const query = {};

  if (customerEmail) {
    query.customerEmail = customerEmail;
  }

  if (technicianEmail) {
    query.technicianEmail = technicianEmail;
  }

  const result = await payments
    .find(query)
    .sort({ paidAt: -1, _id: -1 })
    .toArray();

  res.send(result);
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});

export default app;

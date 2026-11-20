import "dotenv/config";
import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

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

app.get("/", (req, res) => {
  res.send("Hello World!");
});

// User Related api
app.get("/users", async (req, res) => {
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

// Services Related api
app.get("/services", async (req, res) => {
  const query = {};

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
  }
  const cursor = services.find(query);
  const result = await cursor.toArray();
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

  // টেকনিশিয়ান ইমেইল পাঠানো হলে মালিকানা যাচাই
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

  // Completed হলে finalAmount ভ্যালিডেট ও সেট করা
  if (status === "completed") {
    const numericFinalAmount = Number(finalAmount);
    if (Number.isNaN(numericFinalAmount) || numericFinalAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Final amount must be a number greater than 0",
      });
    }
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

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});

export default app;

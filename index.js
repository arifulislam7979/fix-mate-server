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

app.get("/", (req, res) => {
  res.send("Hello World!");
});

// User Related api
app.get("/users", async (req, res) => {
  const cursor = users.find({});
  const result = await cursor.toArray();
  res.send(result);
});

app.patch('/users/:id/role',async(req,res) => {
  const id = req.params.id;
  const query = {_id: new ObjectId(id)}
  const {role} = req.body
  const updateDoc = {
    $set: {
      role: role
    }
  }
  const result = await users.updateOne(query,updateDoc)
  res.send(result)
})

app.delete('/users/:id',async(req,res)=> {
  const id = req.params.id;
  const query = {_id: new ObjectId(id)}
  const result = await users.deleteOne(query)
  res.send(result)
})

// Services Related api
app.get("/services", async (req, res) => {
  const query = {};
  if (req.query) {
    if (req.query.technicianEmail) {
      req.technicianEmail = req.query.technicianEmail;
    }
  }
  const cursor = services.find(query);
  const result = await cursor.toArray();
  res.send(result);
});

app.post("/services", async (req, res) => {
  const data = req.body;
  const result = await services.insertOne(data);
  res.send(result);
});

app.patch("/services/:id", async (req, res) => {
  const id = req.params.id;
  const query = { _id: new ObjectId(id) };
  const updateData = req.body;

  const updateFields = { 
    ...updateData 
  };

  if (updateData.title || updateData.category || updateData.description || updateData.basePrice) {
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
app.patch('/services/:id/status', async(req,res) => {
  const id = req.params.id;
  const {approvalStatus} = req.body;
  const query = {_id: new ObjectId(id)};
  const updateDoc = {
    $set: {
      approvalStatus: approvalStatus
    }
  }
  const result = await services.updateOne(query,updateDoc)
  res.send(result)
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});

export default app;

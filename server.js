"use strict";
const express = require("express");
const mongoose = require("mongoose");
const path = require("path");

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/smartcampus";

const CATS = ["Projector", "Wi-Fi", "Drinking Water", "Laboratory Equipment", "Washroom", "Hostel Maintenance"];
const DEPTS = ["Computer Science", "Electronics", "Mechanical", "Civil", "Electrical", "Information Technology"];
const STATUS = ["Pending", "In Progress", "Resolved"];

// ---------- Model ----------
const schema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    name: { type: String, required: true, trim: true },
    dept: { type: String, required: true, enum: DEPTS },
    cat: { type: String, required: true, enum: CATS },
    desc: { type: String, required: true, trim: true },
    status: { type: String, enum: STATUS, default: "Pending" },
    createdAt: { type: Date, default: Date.now, index: true },
  },
  { versionKey: false }
);
const Complaint = mongoose.model("Complaint", schema);

const view = (d) => ({
  id: d.id, name: d.name, dept: d.dept, cat: d.cat,
  desc: d.desc, status: d.status, createdAt: d.createdAt,
});

// ---------- Helpers ----------
function validate(b) {
  const f = {};
  const name = String(b.name ?? "").trim();
  const desc = String(b.desc ?? "").trim();
  if (!name) f.name = "Enter your name.";
  else if (name.length < 2 || name.length > 60 || !/^[A-Za-z][A-Za-z .'’-]*$/.test(name))
    f.name = "Use letters only, at least 2 characters.";
  if (!DEPTS.includes(b.dept)) f.dept = "Choose your department.";
  if (!CATS.includes(b.cat)) f.cat = "Choose a category.";
  if (!desc) f.desc = "Describe the problem.";
  else if (desc.length < 10) f.desc = "Add more detail (at least 10 characters).";
  else if (desc.length > 500) f.desc = "Keep the description under 500 characters.";
  return { fields: f, ok: Object.keys(f).length === 0, name, desc };
}

async function createWithId(data) {
  for (let i = 0; i < 10; i++) {
    const id = `SC-${new Date().getFullYear()}-${1000 + Math.floor(Math.random() * 9000)}`;
    try {
      return await Complaint.create({ ...data, id });
    } catch (e) {
      if (e.code === 11000) continue; // duplicate ID, try another
      throw e;
    }
  }
  throw new Error("Could not generate a unique complaint ID");
}

const daysAgo = (n) => new Date(Date.now() - n * 864e5);
const sample = () => [
  ["Meera S.", "Computer Science", "Projector", "Projector in Room 204 flickers and switches off during lectures.", "Pending", 1],
  ["Karthik R.", "Electronics", "Wi-Fi", "Wi-Fi in the ECE lab block drops every few minutes.", "In Progress", 3],
  ["Anjali P.", "Information Technology", "Drinking Water", "Water purifier near the library has no cold water.", "Resolved", 6],
  ["Vikram N.", "Mechanical", "Laboratory Equipment", "Two lathe machines in the workshop need servicing.", "In Progress", 4],
  ["Divya K.", "Civil", "Washroom", "Third floor washroom has a broken tap and no water supply.", "Pending", 2],
  ["Rahul M.", "Electrical", "Hostel Maintenance", "Ceiling fan in hostel room B-112 makes loud noise.", "Resolved", 8],
].map((a, i) => ({
  id: "SC-2026-" + (1001 + i), name: a[0], dept: a[1], cat: a[2],
  desc: a[3], status: a[4], createdAt: daysAgo(a[5]),
}));

async function seedIfEmpty() {
  if ((await Complaint.estimatedDocumentCount()) === 0) {
    await Complaint.insertMany(sample());
    console.log("Seeded 6 sample complaints");
  }
}

// ---------- App ----------
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "10kb" }));
app.use((req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("X-Frame-Options", "SAMEORIGIN");
  next();
});

const ah = (fn) => (req, res, next) => fn(req, res, next).catch(next);

app.get("/api/health", (req, res) => {
  const up = mongoose.connection.readyState === 1;
  res.status(up ? 200 : 503).json({ status: up ? "UP" : "DOWN" });
});

app.get("/api/complaints", ah(async (req, res) => {
  const q = {};
  if (CATS.includes(req.query.category)) q.cat = req.query.category;
  if (STATUS.includes(req.query.status)) q.status = req.query.status;
  const list = await Complaint.find(q).sort({ createdAt: -1 }).lean();
  res.json(list.map(view));
}));

app.get("/api/stats", ah(async (req, res) => {
  const rows = await Complaint.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }]);
  const by = Object.fromEntries(rows.map((r) => [r._id, r.n]));
  const pending = by["Pending"] || 0, inProgress = by["In Progress"] || 0, resolved = by["Resolved"] || 0;
  res.json({ total: pending + inProgress + resolved, pending, inProgress, resolved });
}));

app.get("/api/complaints/:id", ah(async (req, res) => {
  const id = String(req.params.id).trim().toUpperCase();
  const c = await Complaint.findOne({ id }).lean();
  if (!c) return res.status(404).json({ error: `No complaint found with ID ${id}. Check the ID and try again.` });
  res.json(view(c));
}));

app.post("/api/complaints", ah(async (req, res) => {
  const v = validate(req.body || {});
  if (!v.ok) return res.status(400).json({ error: "Please fix the highlighted fields.", fields: v.fields });
  const c = await createWithId({ name: v.name, dept: req.body.dept, cat: req.body.cat, desc: v.desc, status: "Pending" });
  res.status(201).json(view(c));
}));

app.patch("/api/complaints/:id/status", ah(async (req, res) => {
  const status = req.body && req.body.status;
  if (!STATUS.includes(status)) return res.status(400).json({ error: "Status must be Pending, In Progress or Resolved." });
  const id = String(req.params.id).trim().toUpperCase();
  const c = await Complaint.findOneAndUpdate({ id }, { status }, { new: true }).lean();
  if (!c) return res.status(404).json({ error: `No complaint found with ID ${id}.` });
  res.json(view(c));
}));

app.post("/api/reset", ah(async (req, res) => {
  await Complaint.deleteMany({});
  await Complaint.insertMany(sample());
  res.json({ message: "Sample data restored." });
}));

app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));
app.use(express.static(path.join(__dirname, "public")));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON body." });
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server." });
});

// ---------- Start ----------
async function connectWithRetry(tries = 30) {
  for (let i = 1; i <= tries; i++) {
    try {
      await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 3000 });
      console.log("Connected to MongoDB");
      return;
    } catch (e) {
      console.log(`MongoDB not ready (attempt ${i}/${tries}): ${e.message}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error("Could not connect to MongoDB");
}

(async () => {
  await connectWithRetry();
  await seedIfEmpty();
  const server = app.listen(PORT, () => console.log(`Smart Campus Complaints running on port ${PORT}`));
  const stop = () => server.close(() => mongoose.disconnect().then(() => process.exit(0)));
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
})().catch((e) => { console.error(e); process.exit(1); });

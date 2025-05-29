require("dotenv").config();
const express = require("express");
const Razorpay = require("razorpay");
const cors = require("cors");
const admin = require("firebase-admin");
const crypto = require("crypto");

const app = express();

// --- CORS Configuration ---
const corsOptions = {
  origin: ["http://localhost:3000", "https://www.ranaha.in"],
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};
app.use(cors(corsOptions));
app.use(express.json());

// --- Firebase Admin Initialization ---
let serviceAccount;

if (process.env.FIREBASE_CONFIG) {
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);

    // Fix the private_key newlines (replace literal \n with actual newline chars)
    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");
    }
  } catch (error) {
    console.error("Invalid FIREBASE_CONFIG format:", error);
    process.exit(1);
  }
} else {
  console.error("FIREBASE_CONFIG not found in environment");
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();

// --- Razorpay Initialization ---
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// --- Routes ---

app.get("/", (req, res) => {
  res.send("✅ Razorpay + Firebase API is running");
});

app.post("/create-order", async (req, res) => {
  const { name, email, phone, amount = 24900 } = req.body;

  if (!name || !email || !phone) {
    return res.status(400).json({ error: "Missing user details" });
  }

  try {
    const order = await razorpay.orders.create({
      amount,
      currency: "INR",
      receipt: `receipt_${Date.now()}`,
      payment_capture: 1,
    });

    await db.collection("payments").doc(order.id).set({
      name,
      email,
      phone,
      amount,
      orderId: order.id,
      status: "created",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json(order);
  } catch (err) {
    console.error("Order creation failed:", err);
    res.status(500).json({ error: "Order creation failed", details: err.message });
  }
});

app.post("/verify-payment", async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

  const body = razorpay_order_id + "|" + razorpay_payment_id;
  const expectedSignature = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(body)
    .digest("hex");

  if (expectedSignature !== razorpay_signature) {
    return res.status(400).json({ success: false, message: "Invalid signature" });
  }

  try {
    const enrollmentId = "ENROLL-" + Math.floor(100000 + Math.random() * 900000);

    await db.collection("payments").doc(razorpay_order_id).update({
      paymentId: razorpay_payment_id,
      paymentSignature: razorpay_signature,
      status: "paid",
      enrollmentId,
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({
      success: true,
      message: "Payment verified",
      enrollmentId,
    });
  } catch (err) {
    console.error("Verification error:", err);
    res.status(500).json({ error: "Verification failed", details: err.message });
  }
});

app.get("/test-firebase", async (req, res) => {
  try {
    const doc = await db.collection("test").doc("sample").get();
    res.json(doc.exists ? doc.data() : { message: "No data found" });
  } catch (err) {
    console.error("Firebase test failed", err);
    res.status(500).json({ error: "Admin SDK not working", details: err.message });
  }
});

// --- Start Server ---
const PORT = process.env.PORT || 5101;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});

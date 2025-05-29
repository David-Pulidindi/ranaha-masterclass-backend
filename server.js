require("dotenv").config();

const express = require("express");
const Razorpay = require("razorpay");
const cors = require("cors");
const admin = require("firebase-admin");
const crypto = require("crypto");

const serviceAccount = require("./firebase-service-account.json");

const app = express();
app.use(cors());
app.use(express.json());

// ✅ Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();

// ✅ Initialize Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

app.get("/", (req, res) => {
  res.send("✅ Razorpay + Firebase API running");
});

// ✅ Create Razorpay Order
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
    res.status(500).json({ error: "Order creation failed" });
  }
});

// ✅ Verify Payment and Store Enrollment
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
    res.status(500).json({ error: "Verification failed" });
  }
});

const PORT = process.env.PORT || 5101;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});

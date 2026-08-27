const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db");
const { signToken } = require("../middleware/auth");

const router = express.Router();

const normalizeEmail = (email) => String(email || "").trim().toLowerCase();

// Vendor registration is reviewed by an administrator before account access
// is granted.
router.post("/register", (req, res) => {
  const { fullName, businessName, password, phone, businessAddress } =
    req.body;
  const email = normalizeEmail(req.body.email);

  if (!fullName || !businessName || !email || !password) {
    return res.status(400).json({ error: "Missing required fields" });
  }
  if (password.length < 6) {
    return res
      .status(400)
      .json({ error: "Password must be at least 6 characters" });
  }

  const existing = db.prepare("SELECT id FROM vendors WHERE email = ?").get(email);
  if (existing) {
    return res.status(409).json({ error: "An account with this email already exists" });
  }

  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare(
      `INSERT INTO vendors (full_name, business_name, email, password, phone, business_address, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`
    )
    .run(fullName, businessName, email, hash, phone || null, businessAddress || null);

  res.status(201).json({
    message: "Registration submitted. Awaiting admin approval.",
    vendorId: info.lastInsertRowid,
  });
});

// Unified login for vendor or admin
router.post("/login", (req, res) => {
  const { password, role } = req.body;
  const email = normalizeEmail(req.body.email);
  if (!email || !password || !role) {
    return res.status(400).json({ error: "Email, password, and role are required" });
  }

  if (role === "admin") {
    const admin = db.prepare("SELECT * FROM admins WHERE email = ?").get(email);
    if (!admin || !bcrypt.compareSync(password, admin.password)) {
      return res.status(401).json({ error: "Invalid admin credentials" });
    }
    const token = signToken({ id: admin.id, role: "admin", name: admin.name, email: admin.email });
    return res.json({
      token,
      user: { id: admin.id, name: admin.name, email: admin.email, role: "admin" },
    });
  }

  if (role === "vendor") {
    const vendor = db.prepare("SELECT * FROM vendors WHERE email = ?").get(email);
    if (!vendor || !bcrypt.compareSync(password, vendor.password)) {
      return res.status(401).json({ error: "Invalid vendor credentials" });
    }
    if (vendor.status === "pending") {
      return res.status(403).json({ error: "Your account is still awaiting admin approval" });
    }
    if (vendor.status === "suspended") {
      return res.status(403).json({ error: "Your account has been suspended. Contact the admin." });
    }
    const token = signToken({
      id: vendor.id,
      role: "vendor",
      name: vendor.full_name,
      businessName: vendor.business_name,
      email: vendor.email,
    });
    return res.json({
      token,
      user: {
        id: vendor.id,
        name: vendor.full_name,
        businessName: vendor.business_name,
        email: vendor.email,
        role: "vendor",
        status: vendor.status,
      },
    });
  }

  return res.status(400).json({ error: "Invalid role" });
});

module.exports = router;

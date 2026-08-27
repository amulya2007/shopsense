const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth(["admin"]));

router.get("/dashboard", (req, res) => {
  const totalVendors = db.prepare("SELECT COUNT(*) as c FROM vendors").get().c;
  const pending = db
    .prepare("SELECT COUNT(*) as c FROM vendors WHERE status='pending'")
    .get().c;
  const approved = db
    .prepare("SELECT COUNT(*) as c FROM vendors WHERE status='approved'")
    .get().c;
  const suspended = db
    .prepare("SELECT COUNT(*) as c FROM vendors WHERE status='suspended'")
    .get().c;

  const recentVendors = db
    .prepare(
      `SELECT id, full_name, business_name, email, status, joined_at
       FROM vendors ORDER BY joined_at DESC LIMIT 8`
    )
    .all();

  res.json({ totalVendors, pending, approved, suspended, recentVendors });
});

router.get("/vendors", (req, res) => {
  const status = req.query.status;
  let rows;
  if (status && status !== "all") {
    rows = db
      .prepare(
        `SELECT id, full_name, business_name, email, phone, business_address, status, joined_at
         FROM vendors WHERE status = ? ORDER BY joined_at DESC`
      )
      .all(status);
  } else {
    rows = db
      .prepare(
        `SELECT id, full_name, business_name, email, phone, business_address, status, joined_at
         FROM vendors ORDER BY joined_at DESC`
      )
      .all();
  }
  res.json(rows);
});

router.put("/vendors/:id/status", (req, res) => {
  const { status } = req.body;
  if (!["pending", "approved", "suspended"].includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }
  const vendor = db.prepare("SELECT * FROM vendors WHERE id = ?").get(req.params.id);
  if (!vendor) return res.status(404).json({ error: "Vendor not found" });

  db.prepare("UPDATE vendors SET status = ? WHERE id = ?").run(status, vendor.id);
  res.json({ message: `Vendor ${status}` });
});

// Permanently remove a vendor and all data owned by that vendor.
router.delete("/vendors/:id", (req, res) => {
  const vendor = db.prepare("SELECT id FROM vendors WHERE id = ?").get(req.params.id);
  if (!vendor) return res.status(404).json({ error: "Vendor not found" });

  const deleteVendor = db.transaction((vendorId) => {
    db.prepare("DELETE FROM sales WHERE vendor_id = ?").run(vendorId);
    db.prepare("DELETE FROM products WHERE vendor_id = ?").run(vendorId);
    db.prepare("DELETE FROM vendors WHERE id = ?").run(vendorId);
  });

  deleteVendor(vendor.id);
  res.json({ message: "Vendor deleted" });
});

module.exports = router;

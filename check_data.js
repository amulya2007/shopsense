const Database = require("better-sqlite3");
const path = require("path");
const db = new Database(path.join(__dirname, "server", "db", "shopsense.db"));

console.log("\n=== SALES DATA CHECK ===\n");

// Total sales
const totalSales = db.prepare("SELECT COUNT(*) as count FROM sales").get();
console.log(`Total sales records: ${totalSales.count}`);

// Sales by vendor
const salesByVendor = db.prepare(`
  SELECT vendor_id, COUNT(*) as count, 
         ROUND(SUM(amount), 2) as total_revenue,
         MIN(date(sold_at)) as earliest,
         MAX(date(sold_at)) as latest
  FROM sales 
  GROUP BY vendor_id
`).all();

console.log(`\nSales by vendor:`);
salesByVendor.forEach(v => {
  console.log(`  Vendor ${v.vendor_id}: ${v.count} sales, ₹${v.total_revenue}, dates: ${v.earliest} to ${v.latest}`);
});

// Sample sales for vendor 1
console.log(`\nSample sales for vendor 1:`);
const samples = db.prepare("SELECT id, amount, quantity, date(sold_at) as date FROM sales WHERE vendor_id = 1 ORDER BY sold_at DESC LIMIT 5").all();
samples.forEach(s => {
  console.log(`  Sale #${s.id}: ₹${s.amount}, ${s.quantity} units, date: ${s.date}`);
});

db.close();

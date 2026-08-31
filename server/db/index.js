const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const path = require("path");
const XLSX = require("xlsx");

const db = new Database(path.join(__dirname, "shopsense.db"));
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vendors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  business_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  phone TEXT,
  business_address TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | suspended
  joined_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL,
  price REAL NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0,
  image_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  amount REAL NOT NULL,
  sold_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS app_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analytics_products (
  product_id TEXT PRIMARY KEY,
  product_name TEXT NOT NULL,
  category TEXT NOT NULL,
  price REAL NOT NULL,
  stock INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS analytics_customers (
  customer_id TEXT PRIMARY KEY,
  customer_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS analytics_orders (
  order_id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  order_date TEXT NOT NULL,
  total_amount REAL NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES analytics_customers(customer_id)
);

CREATE TABLE IF NOT EXISTS analytics_order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price REAL NOT NULL,
  FOREIGN KEY (order_id) REFERENCES analytics_orders(order_id),
  FOREIGN KEY (product_id) REFERENCES analytics_products(product_id)
);

CREATE INDEX IF NOT EXISTS idx_analytics_orders_customer ON analytics_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_analytics_orders_date ON analytics_orders(order_date);
CREATE INDEX IF NOT EXISTS idx_analytics_order_items_product ON analytics_order_items(product_id);
CREATE INDEX IF NOT EXISTS idx_analytics_order_items_order ON analytics_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_products_vendor_stock ON products(vendor_id, stock, name);
CREATE INDEX IF NOT EXISTS idx_sales_vendor_date ON sales(vendor_id, sold_at);
CREATE INDEX IF NOT EXISTS idx_sales_vendor_product ON sales(vendor_id, product_id);
`);

// Existing installations keep their SQLite database between server restarts.
// CREATE TABLE IF NOT EXISTS does not add columns introduced in later versions,
// so migrate the product image field before any catalog write is attempted.
const productColumns = db.prepare("PRAGMA table_info(products)").all().map((column) => column.name);
if (!productColumns.includes("image_url")) {
  db.exec("ALTER TABLE products ADD COLUMN image_url TEXT");
}

function readDataset(filename) {
  const workbook = XLSX.readFile(path.join(__dirname, "..", "..", "dataset", filename), { cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
}

function importAnalyticsDataset() {
  // The historical workbooks are static. Re-reading and rewriting all of them
  // on every server restart delays cold starts and blocks the first requests.
  const existingRows = db.prepare("SELECT COUNT(*) AS count FROM analytics_orders").get().count;
  if (existingRows > 0) return;
  const products = readDataset("products_1.xlsx");
  const customers = readDataset("customers_1.xlsx");
  const orders = readDataset("orders_1.xlsx");
  const orderItems = readDataset("order_items_1.xlsx");
  const insertProduct = db.prepare("INSERT OR IGNORE INTO analytics_products (product_id, product_name, category, price, stock) VALUES (?, ?, ?, ?, ?)");
  const insertCustomer = db.prepare("INSERT OR IGNORE INTO analytics_customers (customer_id, customer_name, email) VALUES (?, ?, ?)");
  const insertOrder = db.prepare("INSERT OR IGNORE INTO analytics_orders (order_id, customer_id, order_date, total_amount) VALUES (?, ?, ?, ?)");
  const insertOrderItem = db.prepare("INSERT OR IGNORE INTO analytics_order_items (order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)");

  db.transaction(() => {
    products.forEach((row) => insertProduct.run(row.product_id, row.product_name, row.category, Number(row.price), Number(row.stock)));
    customers.forEach((row) => insertCustomer.run(row.customer_id, row.customer_name, row.email));
    orders.forEach((row) => insertOrder.run(row.order_id, row.customer_id, row.order_date, Number(row.total_amount)));
    orderItems.forEach((row) => insertOrderItem.run(row.order_id, row.product_id, Number(row.quantity), Number(row.unit_price)));
  })();
}

importAnalyticsDataset();

// Seed an admin account if none exists
const adminCount = db.prepare("SELECT COUNT(*) as c FROM admins").get().c;
if (adminCount === 0) {
  const hash = bcrypt.hashSync("admin123", 10);
  db.prepare(
    "INSERT INTO admins (name, email, password) VALUES (?, ?, ?)"
  ).run("System Admin", "admin@demo.com", hash);
  console.log("Seeded admin -> admin@demo.com / admin123");
}

// Seed a demo vendor if none exists
const vendorCount = db.prepare("SELECT COUNT(*) as c FROM vendors").get().c;
if (vendorCount === 0) {
  const hash = bcrypt.hashSync("vendor123", 10);
  const info = db
    .prepare(
      `INSERT INTO vendors (full_name, business_name, email, password, phone, business_address, status)
       VALUES (?, ?, ?, ?, ?, ?, 'approved')`
    )
    .run(
      "Demo Vendor",
      "Demo Goods Co.",
      "vendor@demo.com",
      hash,
      "+1 555 010 2020",
      "44 Market Row, Austin, TX"
    );
  console.log("Seeded demo vendor -> vendor@demo.com / vendor123");
}

// Keep the demo account useful on both fresh and existing installations. These
// are deliberately ordinary customer-facing products: every record owns the
// same image, description, category, price, and inventory shown in the UI.
const DEMO_CATALOG_VERSION = "2026-08-polished-catalog-monthly-sales";
const demoProducts = [
  ["Nova Smart Watch", "A sleek everyday smartwatch for calls, activity tracking, and timely notifications.", "Electronics", 4999, 34, "/uploads/products/demo-smart-watch.jpg"],
  ["SoundWave Wireless Headphones", "Comfortable over-ear headphones for focused work, travel, and everyday listening.", "Electronics", 3299, 48, "/uploads/products/demo-wireless-headphones.jpg"],
  ["Pulse Mini Bluetooth Speaker", "A compact portable speaker that brings clear sound to picnics and small gatherings.", "Electronics", 1899, 0, "/uploads/products/demo-bluetooth-speaker.jpg"],
  ["Ceramic Coffee Mug Set", "A set of four glazed ceramic mugs for coffee, tea, and relaxed morning routines.", "Home & Kitchen", 899, 26, "/uploads/products/demo-coffee-mugs.jpg"],
  ["Stainless Steel Water Bottle", "A reusable insulated bottle that keeps refreshments close during work, commutes, and workouts.", "Home & Kitchen", 749, 62, "/uploads/products/demo-water-bottle.jpg"],
  ["Modern LED Desk Lamp", "A clean, adjustable desk lamp that adds comfortable task lighting to your workspace.", "Home & Kitchen", 1599, 9, "/uploads/products/demo-desk-lamp.jpg"],
  ["Everyday Laptop Backpack", "A practical backpack with room for a laptop, daily essentials, and short trips.", "Accessories", 2199, 31, "/uploads/products/demo-laptop-backpack.jpg"],
  ["Men's Cotton Crew T-Shirt", "A soft cotton crew-neck T-shirt designed for easy layering and everyday comfort.", "Fashion", 699, 75, "/uploads/products/demo-cotton-tshirt.jpg"],
  ["Stride Running Shoes", "Lightweight running shoes with a comfortable fit for walks, runs, and daily movement.", "Fashion", 3499, 18, "/uploads/products/demo-running-shoes.jpg"],
  ["Classic Polarized Sunglasses", "Timeless sunglasses that add an easy finishing touch to bright-day outfits.", "Accessories", 1299, 0, "/uploads/products/demo-sunglasses.jpg"],
  ["Daily Glow Skincare Set", "A simple three-step skincare set for a fresh, cared-for everyday routine.", "Beauty", 1499, 22, "/uploads/products/demo-skincare-set.jpg"],
  ["Ionic Hair Dryer", "A lightweight hair dryer for quick everyday styling at home or while travelling.", "Beauty", 2499, 14, "/uploads/products/demo-hair-dryer.jpg"],
  ["Flex Yoga Mat", "A supportive yoga mat with a comfortable surface for stretching, yoga, and floor workouts.", "Sports", 1199, 39, "/uploads/products/demo-yoga-mat.jpg"],
  ["Neoprene Dumbbell Pair", "A versatile pair of dumbbells for home strength sessions and everyday training.", "Sports", 1799, 11, "/uploads/products/demo-dumbbells.jpg"],
  ["Bamboo Cutting Board", "A smooth bamboo cutting board for everyday prep, serving, and kitchen organization.", "Home & Kitchen", 999, 44, "/uploads/products/demo-cutting-board.jpg"],
  ["Leather Card Wallet", "A slim leather card wallet that keeps daily cards organized without extra bulk.", "Accessories", 1099, 7, "/uploads/products/demo-card-wallet.jpg"],
  ["Smart Fitness Band", "A lightweight fitness band for tracking daily activity, workouts, and healthy routines.", "Electronics", 1999, 53, "/uploads/products/demo-fitness-band.jpg"],
  ["Soft Makeup Brush Set", "A curated makeup brush set for blending, buffing, and creating polished everyday looks.", "Beauty", 899, 16, "/uploads/products/demo-makeup-brushes.jpg"],
];

function seedPolishedDemoCatalog() {
  const demoVendor = db.prepare("SELECT id FROM vendors WHERE email = ?").get("vendor@demo.com");
  const catalogVersion = db.prepare("SELECT setting_value FROM app_settings WHERE setting_key = ?").get("demo_catalog_version");
  if (!demoVendor || catalogVersion?.setting_value === DEMO_CATALOG_VERSION) return;

  const insertProduct = db.prepare(
    "INSERT INTO products (vendor_id, name, description, category, price, stock, image_url) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  const insertSale = db.prepare("INSERT INTO sales (vendor_id, product_id, quantity, amount, sold_at) VALUES (?, ?, ?, ?, ?)");
  const saveVersion = db.prepare("INSERT OR REPLACE INTO app_settings (setting_key, setting_value) VALUES (?, ?)");

  db.transaction(() => {
    db.prepare("DELETE FROM sales WHERE vendor_id = ?").run(demoVendor.id);
    db.prepare("DELETE FROM products WHERE vendor_id = ?").run(demoVendor.id);
    const now = new Date();
    demoProducts.forEach((product, index) => {
      const result = insertProduct.run(demoVendor.id, ...product);
      // Spread sales over the last 12 calendar months so the reporting chart
      // has meaningful day, week, and month views instead of a single point.
      for (let monthOffset = 0; monthOffset < 12; monthOffset += 1) {
        const quantity = 1 + ((index + monthOffset) % 3);
        const saleDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthOffset, 6 + (index % 20), 12, 0, 0));
        const soldAt = saleDate.toISOString().replace("T", " ").substring(0, 19);
        insertSale.run(demoVendor.id, result.lastInsertRowid, quantity, quantity * product[3], soldAt);
      }
    });
    saveVersion.run("demo_catalog_version", DEMO_CATALOG_VERSION);
  })();
  console.log(`Seeded ${demoProducts.length} polished demo products`);
}

seedPolishedDemoCatalog();

// Seed vendor sales and products if none exist
const salesCount = db.prepare("SELECT COUNT(*) as c FROM sales").get().c;
if (salesCount === 0) {
  const vendor1 = db.prepare("SELECT id FROM vendors WHERE email = ?").get("vendor@demo.com");
  if (vendor1) {
    const existingProducts = db.prepare("SELECT COUNT(*) as c FROM products WHERE vendor_id = ?").get(vendor1.id).c;
    if (existingProducts <= 1) {
      db.prepare("INSERT INTO products (vendor_id, name, description, category, price, stock, image_url) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
        vendor1.id, "Smart Fitness Band", "Water-resistant fitness tracker with heart rate and sleep monitor.", "Electronics", 1499, 85, ""
      );
      db.prepare("INSERT INTO products (vendor_id, name, description, category, price, stock, image_url) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
        vendor1.id, "Casual Cotton T-Shirt", "100% premium breathable cotton crew neck t-shirt.", "Fashion", 799, 150, ""
      );
      db.prepare("INSERT INTO products (vendor_id, name, description, category, price, stock, image_url) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
        vendor1.id, "Ceramic Coffee Mug Set", "Set of 4 handcrafted matte-finish ceramic coffee mugs.", "Home & Kitchen", 499, 60, ""
      );
    }
  }

  // Insert sample sales for available products
  const allProducts = db.prepare("SELECT id, vendor_id, price FROM products").all();
  if (allProducts.length > 0) {
    const insertSale = db.prepare("INSERT INTO sales (vendor_id, product_id, quantity, amount, sold_at) VALUES (?, ?, ?, ?, ?)");
    const now = new Date();
    
    allProducts.forEach((p, idx) => {
      const salesCountForProd = 3 + (idx % 4);
      for (let s = 0; s < salesCountForProd; s++) {
        const daysAgo = Math.floor((s * 5 + (idx * 3)) % 28);
        const saleDate = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
        const dateStr = saleDate.toISOString().replace("T", " ").substring(0, 19);
        const qty = 1 + ((s + idx) % 4);
        const amt = Math.round(qty * p.price * 100) / 100;
        insertSale.run(p.vendor_id, p.id, qty, amt, dateStr);
      }
    });
    console.log("Seeded initial vendor sales transactions");
  }
}

module.exports = db;

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
  db.prepare(
    `INSERT INTO products (vendor_id, name, description, category, price, stock, image_url)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    info.lastInsertRowid,
    "Wireless Earbuds Pro",
    "Noise-cancelling wireless earbuds with 30hr battery life.",
    "Electronics",
    59.99,
    120,
    ""
  );
  console.log("Seeded demo vendor -> vendor@demo.com / vendor123");
}

module.exports = db;

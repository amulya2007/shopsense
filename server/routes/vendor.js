const express = require("express");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const ragService = require("../services/ragService");
const { generateLocalDescription } = require("../services/productIdentity");

const router = express.Router();
router.use(requireAuth(["vendor"]));

const uploadDirectory = path.join(__dirname, "..", "uploads", "products");
fs.mkdirSync(uploadDirectory, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDirectory,
    filename: (req, file, callback) => {
      const extension = path.extname(file.originalname).toLowerCase() || ".jpg";
      callback(null, `vendor-${req.user.id}-${Date.now()}-${Math.round(Math.random() * 1e9)}${extension}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    callback(null, file.mimetype.startsWith("image/"));
  },
});

const IMAGE_EXTENSIONS = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

function uploadedImageUrl(filename) {
  return `/uploads/products/${filename}`;
}

function createImageFilename(vendorId, extension) {
  return `vendor-${vendorId}-${Date.now()}-${Math.round(Math.random() * 1e9)}${extension}`;
}

function getPagePreviewUrl(html, pageUrl) {
  const patterns = [
    /<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|twitter:image)["']/i,
  ];
  const match = patterns.map((pattern) => html.match(pattern)).find(Boolean);
  return match ? new URL(match[1].replace(/&amp;/g, "&"), pageUrl).toString() : null;
}

function normalizeImageUrl(value) {
  const imageUrl = String(value || "").trim();
  if (!imageUrl) return "";
  if (/^data:image\/(?:jpeg|jpg|png|webp|gif);base64,[a-z0-9+/=]+$/i.test(imageUrl)) {
    return imageUrl.length <= 300000 ? imageUrl : null;
  }

  let parsed;
  try {
    parsed = new URL(imageUrl);
  } catch {
    return null;
  }

  if (!/^https?:$/.test(parsed.protocol) || parsed.hostname.endsWith("google.com")) {
    return null;
  }
  return imageUrl;
}

function stockStatus(stock, lowThreshold, mediumThreshold = lowThreshold) {
  if (stock <= 0) return "out_of_stock";
  if (stock <= lowThreshold) return "low_stock";
  return stock <= mediumThreshold ? "medium_stock" : "in_stock";
}

function validStock(value) {
  const stock = Number(value);
  return Number.isInteger(stock) && stock >= 0;
}

function lowStockThreshold(value) {
  const threshold = value === undefined ? 5 : Number(value);
  return Number.isInteger(threshold) && threshold >= 0 && threshold <= 1000000 ? threshold : null;
}

// Older AI output may contain catalog/prompt language. It is not suitable for
// customers, so replace only those unmistakable system-style descriptions when
// returning products to the catalog and product-details modal.
function isSystemStyleDescription(value) {
  const text = String(value || "").toLowerCase();
  return [
    "shopsense", "this listing", "this item specifically", "should not be confused",
    "catalog details", "product categories", "product name", "only details that appear",
    "internal data", "data limitations", "catalog/listing"
  ].some((phrase) => text.includes(phrase));
}

function productForDisplay(product) {
  if (!isSystemStyleDescription(product.description)) return product;
  return { ...product, description: generateLocalDescription(product.name, product.category) };
}

router.post("/images", (req, res) => {
  upload.single("image")(req, res, (error) => {
    if (error) {
      const message = error.code === "LIMIT_FILE_SIZE"
        ? "Image must be 5 MB or smaller."
        : "Unable to upload this image. Please choose a valid image file.";
      return res.status(400).json({ error: message });
    }
    if (!req.file) return res.status(400).json({ error: "Choose an image file to upload." });
    return res.status(201).json({ imageUrl: uploadedImageUrl(req.file.filename) });
  });
});

// Imports the public preview image from an image listing page such as PNGTree.
router.post("/images/from-page", async (req, res) => {
  const pageUrl = String(req.body?.url || "").trim();
  let page;
  try {
    const parsed = new URL(pageUrl);
    if (!/^https?:$/.test(parsed.protocol)) throw new Error("invalid URL");
    page = await fetch(parsed, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ShopSense/1.0)" },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return res.status(400).json({ error: "Unable to open that webpage. Use a public image page URL." });
  }

  if (!page.ok || !page.headers.get("content-type")?.includes("text/html")) {
    return res.status(400).json({ error: "This URL is not an image webpage. Paste a direct image URL instead." });
  }

  const previewUrl = getPagePreviewUrl(await page.text(), pageUrl);
  if (!previewUrl) {
    return res.status(400).json({ error: "No public preview image was found on that page. Upload the image file instead." });
  }

  try {
    const imageResponse = await fetch(previewUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ShopSense/1.0)" },
      signal: AbortSignal.timeout(15000),
    });
    const contentType = imageResponse.headers.get("content-type")?.split(";")[0].toLowerCase();
    const contentLength = Number(imageResponse.headers.get("content-length") || 0);
    if (!imageResponse.ok || !IMAGE_EXTENSIONS[contentType] || contentLength > 5 * 1024 * 1024) {
      throw new Error("invalid image");
    }
    const data = Buffer.from(await imageResponse.arrayBuffer());
    if (data.length > 5 * 1024 * 1024) throw new Error("image too large");
    const filename = createImageFilename(req.user.id, IMAGE_EXTENSIONS[contentType]);
    fs.writeFileSync(path.join(uploadDirectory, filename), data);
    return res.status(201).json({ imageUrl: uploadedImageUrl(filename) });
  } catch {
    return res.status(400).json({ error: "The page preview could not be downloaded. Download the image first, then drag it here." });
  }
});

// Dashboard summary
router.get("/dashboard", (req, res) => {
  const vendorId = req.user.id;

  const productsListed = db
    .prepare("SELECT COUNT(*) as c FROM products WHERE vendor_id = ?")
    .get(vendorId).c;

  const salesRow = db
    .prepare(
      `SELECT COALESCE(SUM(quantity),0) as totalSales,
              COALESCE(SUM(amount),0) as totalRevenue,
              COUNT(*) as totalTransactions
       FROM sales WHERE vendor_id = ?`
    )
    .get(vendorId);

  const recentProducts = db
    .prepare(
      `SELECT * FROM products WHERE vendor_id = ? ORDER BY created_at DESC`
    )
    .all(vendorId)
    .map(productForDisplay);

  res.json({
    totalSales: salesRow.totalSales,
    totalRevenue: salesRow.totalRevenue,
    totalTransactions: salesRow.totalTransactions,
    productsListed,
    recentProducts,
  });
});

// Catalog - list products
router.get("/products", (req, res) => {
  const products = db
    .prepare("SELECT * FROM products WHERE vendor_id = ? ORDER BY created_at DESC")
    .all(req.user.id)
    .map(productForDisplay);
  res.json(products);
});

// Name suggestions for autocomplete (searches vendor catalog AND the 10,000 dataset products)
router.get("/products/suggestions", (req, res) => {
  const q = (req.query.q || "").toLowerCase().trim();
  if (!q) return res.json([]);

  const vendorRows = db
    .prepare("SELECT DISTINCT name, category, price, stock, 'catalog' AS origin FROM products WHERE vendor_id = ? AND lower(name) LIKE ? LIMIT 5")
    .all(req.user.id, `%${q}%`);

  const datasetRows = db
    .prepare("SELECT product_id, product_name AS name, category, price, stock, 'dataset' AS origin FROM analytics_products WHERE lower(product_name) LIKE ? OR lower(product_id) LIKE ? LIMIT 8")
    .all(`%${q}%`, `%${q}%`);

  const combined = [...vendorRows, ...datasetRows];
  const seen = new Set();
  const unique = [];
  for (const item of combined) {
    if (!seen.has(item.name.toLowerCase())) {
      seen.add(item.name.toLowerCase());
      unique.push(item);
    }
  }

  res.json(unique.slice(0, 10));
});

// Live inventory for the current vendor's catalog. Historical analytics live
// under /api/analytics and are intentionally not included here.
router.get("/inventory", (req, res) => {
  const lowThreshold = lowStockThreshold(req.query.lowThreshold);
  if (lowThreshold === null) return res.status(400).json({ error: "lowThreshold must be a non-negative whole number" });

  const products = db.prepare(`
    SELECT id AS productId, name AS productName, category, price, stock
    FROM products
    WHERE vendor_id = ?
    ORDER BY stock ASC, name ASC
  `).all(req.user.id).map((product) => ({ ...product, lowStockThreshold: lowThreshold, status: stockStatus(product.stock, lowThreshold) }));

  res.json({
    lowStockThreshold: lowThreshold,
    products,
    summary: {
      totalProducts: products.length,
      totalStock: products.reduce((total, product) => total + product.stock, 0),
      lowStockProducts: products.filter((product) => product.status === "low_stock").length,
      outOfStockProducts: products.filter((product) => product.status === "out_of_stock").length,
    },
  });
});

router.get("/inventory/alerts", (req, res) => {
  const lowThreshold = lowStockThreshold(req.query.lowThreshold);
  if (lowThreshold === null) return res.status(400).json({ error: "lowThreshold must be a non-negative whole number" });

  const alerts = db.prepare(`
    SELECT id AS productId, name AS productName, stock
    FROM products
    WHERE vendor_id = ? AND stock <= ?
    ORDER BY stock ASC, name ASC
  `).all(req.user.id, lowThreshold).map((product) => ({
    ...product,
    lowStockThreshold: lowThreshold,
    status: stockStatus(product.stock, lowThreshold),
    message: product.stock <= 0 ? `${product.productName} is out of stock.` : `${product.productName} is low in stock.`,
  }));

  res.json({ lowStockThreshold: lowThreshold, alertCount: alerts.length, alerts });
});

// Add product
router.post("/products", (req, res) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const name = String(body.name || "").trim();
  const description = String(body.description || "").trim();
  const category = String(body.category || "").trim();
  const price = Number(body.price);
  const stock = body.stock;
  const imageUrl = body.imageUrl;
  if (!name || !description || !category || body.price === undefined || body.price === "") {
    return res.status(400).json({ error: "Missing required fields" });
  }
  if (!Number.isFinite(price) || price < 0) {
    return res.status(400).json({ error: "Price must be a non-negative number" });
  }
  const normalizedImageUrl = normalizeImageUrl(imageUrl);
  if (normalizedImageUrl === null) {
    return res.status(400).json({ error: "Use a direct http(s) image URL, not a Google Search link." });
  }
  if (stock !== undefined && !validStock(stock)) {
    return res.status(400).json({ error: "Stock must be a non-negative whole number" });
  }
  try {
    const info = db
      .prepare(
        `INSERT INTO products (vendor_id, name, description, category, price, stock, image_url)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        req.user.id,
        name,
        description,
        category,
        price,
        stock === undefined || stock === "" ? 0 : Number(stock),
        normalizedImageUrl
      );
    const product = db.prepare("SELECT * FROM products WHERE id = ?").get(info.lastInsertRowid);
    try { ragService.buildVectorStore(); } catch (e) { console.error("RAG rebuild error:", e); }
    return res.status(201).json(product);
  } catch (error) {
    console.error("Unable to add product:", error);
    return res.status(500).json({ error: "Unable to save this product. Please try again." });
  }
});

// Update product
router.put("/products/:id", (req, res) => {
  const product = db
    .prepare("SELECT * FROM products WHERE id = ? AND vendor_id = ?")
    .get(req.params.id, req.user.id);
  if (!product) return res.status(404).json({ error: "Product not found" });

  const { name, description, category, price, stock, imageUrl } = req.body;
  const normalizedImageUrl = imageUrl === undefined ? product.image_url : normalizeImageUrl(imageUrl);
  if (normalizedImageUrl === null) {
    return res.status(400).json({ error: "Use a direct http(s) image URL, not a Google Search link." });
  }
  if (stock !== undefined && !validStock(stock)) {
    return res.status(400).json({ error: "Stock must be a non-negative whole number" });
  }
  db.prepare(
    `UPDATE products SET name=?, description=?, category=?, price=?, stock=?, image_url=? WHERE id=?`
  ).run(
    name ?? product.name,
    description ?? product.description,
    category ?? product.category,
    price !== undefined ? Number(price) : product.price,
    stock !== undefined ? Number(stock) : product.stock,
    normalizedImageUrl,
    product.id
  );
  const updated = db.prepare("SELECT * FROM products WHERE id = ?").get(product.id);
  try { ragService.buildVectorStore(); } catch (e) { console.error("RAG rebuild error:", e); }
  res.json(updated);
});

// Set an exact stock amount without changing the rest of the product details.
router.patch("/products/:id/stock", (req, res) => {
  if (!validStock(req.body.stock)) return res.status(400).json({ error: "Stock must be a non-negative whole number" });
  const product = db.prepare("SELECT id, name FROM products WHERE id = ? AND vendor_id = ?").get(req.params.id, req.user.id);
  if (!product) return res.status(404).json({ error: "Product not found" });

  db.prepare("UPDATE products SET stock = ? WHERE id = ?").run(Number(req.body.stock), product.id);
  const updated = db.prepare("SELECT id AS productId, name AS productName, stock FROM products WHERE id = ?").get(product.id);
  try { ragService.buildVectorStore(); } catch (e) { console.error("RAG rebuild error:", e); }
  res.json({ message: "Stock updated successfully", ...updated });
});

// Adjust stock relative to its current amount, while preventing negative stock.
router.post("/products/:id/stock-adjustments", (req, res) => {
  const change = Number(req.body.change);
  if (!Number.isInteger(change) || change === 0) return res.status(400).json({ error: "change must be a non-zero whole number" });

  const product = db.prepare("SELECT id, name, stock FROM products WHERE id = ? AND vendor_id = ?").get(req.params.id, req.user.id);
  if (!product) return res.status(404).json({ error: "Product not found" });
  const updatedStock = product.stock + change;
  if (updatedStock < 0) return res.status(400).json({ error: "Stock adjustment cannot reduce stock below zero" });

  db.prepare("UPDATE products SET stock = ? WHERE id = ?").run(updatedStock, product.id);
  try { ragService.buildVectorStore(); } catch (e) { console.error("RAG rebuild error:", e); }
  res.json({ message: "Stock adjusted successfully", productId: product.id, productName: product.name, previousStock: product.stock, change, currentStock: updatedStock });
});

// Delete product
router.delete("/products/:id", (req, res) => {
  const product = db
    .prepare("SELECT * FROM products WHERE id = ? AND vendor_id = ?")
    .get(req.params.id, req.user.id);
  if (!product) return res.status(404).json({ error: "Product not found" });
  db.prepare("DELETE FROM products WHERE id = ?").run(product.id);
  try { ragService.buildVectorStore(); } catch (e) { console.error("RAG rebuild error:", e); }
  res.json({ message: "Product deleted" });
});

// Analytics (basic aggregation over products + sales)
router.get("/analytics", (req, res) => {
  const vendorId = req.user.id;
  const byCategory = db
    .prepare(
      `SELECT category, COUNT(*) as productCount, COALESCE(SUM(stock),0) as totalStock
       FROM products WHERE vendor_id = ? GROUP BY category`
    )
    .all(vendorId);

  const salesOverTime = db
    .prepare(
      `SELECT date(sold_at) as day, SUM(amount) as revenue
       FROM sales WHERE vendor_id = ? GROUP BY day ORDER BY day DESC LIMIT 14`
    )
    .all(vendorId);

  res.json({ byCategory, salesOverTime });
});

// Historical analytics endpoint – provides realistic insights
router.get("/analytics/historical", (req, res) => {
  const vendorId = req.user.id;

  // Total revenue
  const revenueRow = db.prepare(
    `SELECT COALESCE(SUM(amount),0) as totalRevenue FROM sales WHERE vendor_id = ?`
  ).get(vendorId);

  // Average order value – average revenue per order
  const avgOrderRow = db.prepare(
    `SELECT AVG(total) as averageOrderValue FROM (
       SELECT SUM(amount) as total FROM sales WHERE vendor_id = ? GROUP BY order_id
     )`
  ).get(vendorId);

  // Repeat customer rate
  const repeatRow = db.prepare(
    `SELECT COUNT(*) as repeatCount FROM (
       SELECT customer_id, COUNT(*) as cnt FROM orders WHERE vendor_id = ? GROUP BY customer_id HAVING cnt > 1
     )`
  ).get(vendorId);
  const totalCustomersRow = db.prepare(`SELECT COUNT(*) as totalCustomers FROM customers`).get();
  const repeatCustomerRate = totalCustomersRow.totalCustomers
    ? repeatRow.repeatCount / totalCustomersRow.totalCustomers
    : 0;

  // Top 5 products by quantity sold
  const topProducts = db.prepare(
    `SELECT oi.product_id, p.name, SUM(oi.quantity) as quantity_sold
       FROM order_items oi
       JOIN products p ON oi.product_id = p.id
       WHERE p.vendor_id = ?
       GROUP BY oi.product_id
       ORDER BY quantity_sold DESC
       LIMIT 5`
  ).all(vendorId);

  // Sales over time (last 14 days)
  const salesOverTime = db.prepare(
    `SELECT date(sold_at) as day, SUM(amount) as revenue
       FROM sales
       WHERE vendor_id = ?
       GROUP BY day
       ORDER BY day DESC
       LIMIT 14`
  ).all(vendorId);

  res.json({
    totalRevenue: revenueRow.totalRevenue,
    averageOrderValue: avgOrderRow.averageOrderValue,
    repeatCustomerRate,
    topProducts,
    salesOverTime,
  });
});

// Profile
router.get("/profile", (req, res) => {
  const vendor = db
    .prepare(
      "SELECT id, full_name, business_name, email, phone, business_address, status, joined_at FROM vendors WHERE id = ?"
    )
    .get(req.user.id);
  res.json(vendor);
});

router.put("/profile", (req, res) => {
  const { fullName, businessName, phone, businessAddress, password } = req.body;
  const vendor = db.prepare("SELECT * FROM vendors WHERE id = ?").get(req.user.id);
  if (!vendor) return res.status(404).json({ error: "Vendor not found" });

  let passwordHash = vendor.password;
  if (password) {
    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }
    passwordHash = bcrypt.hashSync(password, 10);
  }

  db.prepare(
    `UPDATE vendors SET full_name=?, business_name=?, phone=?, business_address=?, password=? WHERE id=?`
  ).run(
    fullName ?? vendor.full_name,
    businessName ?? vendor.business_name,
    phone ?? vendor.phone,
    businessAddress ?? vendor.business_address,
    passwordHash,
    vendor.id
  );

  const updatedVendor = db.prepare(
    "SELECT id, full_name, business_name, email, phone, business_address, status, joined_at FROM vendors WHERE id = ?"
  ).get(vendor.id);
  res.json({ message: "Profile updated", vendor: updatedVendor });
});

module.exports = router;

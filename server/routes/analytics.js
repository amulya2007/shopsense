const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const path = require("path");
const XLSX = require("xlsx");

const router = express.Router();
router.use(requireAuth(["vendor", "admin"]));

let associationDataCache = null;
let validationCache = null;
let historicalProductsCache = null;
let salesTimeseriesCache = null;

function boundedNumber(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function supportOptions(query) {
  const minimumSupport = boundedNumber(query.minSupport, 0.0002, 0, 1);
  const minimumConfidence = boundedNumber(query.minConfidence, 0.1, 0, 1);
  return { minimumSupport, minimumConfidence };
}

function datasetRows(filename) {
  const workbook = XLSX.readFile(path.join(__dirname, "..", "..", "dataset", filename), { cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
}

function forecastStatus(currentStock, predictedDemand, lowThreshold, mediumThreshold) {
  if (predictedDemand > currentStock) return "restock_required";
  if (currentStock <= lowThreshold || currentStock - predictedDemand <= 0) return "low_stock_risk";
  if (currentStock <= mediumThreshold || currentStock - predictedDemand <= lowThreshold) return "medium_risk";
  return "healthy";
}

function normalizedName(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function categoryKey(value) {
  return String(value || "uncategorized").trim().toLowerCase() || "uncategorized";
}

function observedDays(firstDate, lastDate) {
  const first = Date.parse(`${firstDate}T00:00:00Z`);
  const last = Date.parse(`${lastDate}T00:00:00Z`);
  if (!Number.isFinite(first) || !Number.isFinite(last)) return 365;
  return Math.max(1, Math.round((last - first) / 86_400_000) + 1);
}

function getHistoricalProducts() {
  if (historicalProductsCache) return historicalProductsCache;
  const history = db.prepare(`
    SELECT p.product_id, p.product_name, p.category, p.price, p.stock,
           COALESCE(SUM(oi.quantity), 0) AS unitsSold,
           MIN(o.order_date) AS firstSaleDate,
           MAX(o.order_date) AS lastSaleDate,
           COUNT(DISTINCT o.order_id) AS orderCount
    FROM analytics_products p
    LEFT JOIN analytics_order_items oi ON oi.product_id = p.product_id
    LEFT JOIN analytics_orders o ON o.order_id = oi.order_id
    GROUP BY p.product_id
  `).all().map((row) => ({
    ...row,
    observedDays: observedDays(row.firstSaleDate || "2026-01-01", row.lastSaleDate || "2026-12-31")
  }));

  const byId = new Map();
  const byName = new Map();
  const categoryTotals = new Map();

  history.forEach((row) => {
    byId.set(String(row.product_id), row);
    byName.set(normalizedName(row.product_name), row);

    const key = categoryKey(row.category);
    const old = categoryTotals.get(key) || { units: 0, products: 0, days: 0 };
    categoryTotals.set(key, {
      units: old.units + Number(row.unitsSold || 0),
      products: old.products + 1,
      days: Math.max(old.days, row.observedDays)
    });
  });

  historicalProductsCache = {
    list: history,
    byId,
    byName,
    categoryTotals,
    categories: Array.from(new Set(history.map(p => p.category))).sort()
  };
  return historicalProductsCache;
}

function getMonthlyProductSales(productId) {
  return db.prepare(`
    SELECT strftime('%m', o.order_date) AS month,
           SUM(oi.quantity) AS unitsSold
    FROM analytics_order_items oi
    JOIN analytics_orders o ON o.order_id = oi.order_id
    WHERE oi.product_id = ?
    GROUP BY strftime('%m', o.order_date)
    ORDER BY strftime('%m', o.order_date) ASC
  `).all(productId);
}

function transactionData() {
  const rows = db.prepare(`
    SELECT oi.order_id, oi.product_id, p.product_name
    FROM analytics_order_items oi
    JOIN analytics_products p ON p.product_id = oi.product_id
    ORDER BY oi.order_id, oi.product_id
  `).all();
  const transactions = new Map();
  rows.forEach((row) => {
    if (!transactions.has(row.order_id)) transactions.set(row.order_id, new Map());
    transactions.get(row.order_id).set(row.product_id, row.product_name);
  });
  return transactions;
}

function buildAssociationData() {
  if (associationDataCache) return associationDataCache;
  const transactions = transactionData();
  const itemCounts = new Map();
  const pairCounts = new Map();
  const productNames = new Map();
  const productCategories = new Map();
  const categoryPairCounts = new Map();
  const categoryCounts = new Map();

  const productCategoryRows = db.prepare("SELECT product_id, category FROM analytics_products").all();
  productCategoryRows.forEach(r => productCategories.set(r.product_id, r.category));

  transactions.forEach((items) => {
    const productIds = [...items.keys()].sort();
    const categoriesInOrder = new Set();
    productIds.forEach((id) => {
      itemCounts.set(id, (itemCounts.get(id) || 0) + 1);
      productNames.set(id, items.get(id));
      const cat = productCategories.get(id);
      if (cat) categoriesInOrder.add(cat);
    });
    for (let left = 0; left < productIds.length; left += 1) {
      for (let right = left + 1; right < productIds.length; right += 1) {
        const key = `${productIds[left]}|${productIds[right]}`;
        pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
      }
    }
    const catList = [...categoriesInOrder].sort();
    catList.forEach(cat => categoryCounts.set(cat, (categoryCounts.get(cat) || 0) + 1));
    for (let left = 0; left < catList.length; left += 1) {
      for (let right = left + 1; right < catList.length; right += 1) {
        const key = `${catList[left]}|${catList[right]}`;
        categoryPairCounts.set(key, (categoryPairCounts.get(key) || 0) + 1);
      }
    }
  });

  associationDataCache = {
    transactionCount: transactions.size,
    itemCounts,
    pairCounts,
    productNames,
    productCategories,
    categoryPairCounts,
    categoryCounts
  };
  return associationDataCache;
}

function frequentPatterns(minimumSupport) {
  const data = buildAssociationData();
  if (!data.transactionCount) return { transactionCount: 0, patterns: [], categoryPatterns: [] };
  const patterns = [...data.pairCounts.entries()]
    .map(([key, absoluteSupport]) => {
      const [firstProductId, secondProductId] = key.split("|");
      return {
        productIds: [firstProductId, secondProductId],
        itemset: [data.productNames.get(firstProductId), data.productNames.get(secondProductId)],
        absoluteSupport,
        relativeSupport: absoluteSupport / data.transactionCount,
      };
    })
    .filter((pattern) => pattern.relativeSupport >= minimumSupport)
    .sort((a, b) => b.absoluteSupport - a.absoluteSupport || a.itemset.join(" ").localeCompare(b.itemset.join(" ")));

  const categoryPatterns = [...data.categoryPairCounts.entries()]
    .map(([key, absoluteSupport]) => {
      const [cat1, cat2] = key.split("|");
      return {
        categories: [cat1, cat2],
        itemset: `${cat1} + ${cat2}`,
        absoluteSupport,
        relativeSupport: absoluteSupport / data.transactionCount,
      };
    })
    .sort((a, b) => b.absoluteSupport - a.absoluteSupport);

  return { transactionCount: data.transactionCount, patterns, categoryPatterns };
}

function associationRules(minimumSupport, minimumConfidence) {
  const data = buildAssociationData();
  if (!data.transactionCount) return { transactionCount: 0, rules: [], categoryRules: [] };
  const rules = [];
  data.pairCounts.forEach((absoluteSupport, key) => {
    const [firstProductId, secondProductId] = key.split("|");
    const relativeSupport = absoluteSupport / data.transactionCount;
    if (relativeSupport < minimumSupport) return;
    [[firstProductId, secondProductId], [secondProductId, firstProductId]].forEach(([antecedentId, consequentId]) => {
      const antecedentCount = data.itemCounts.get(antecedentId) || 1;
      const confidence = absoluteSupport / antecedentCount;
      if (confidence >= minimumConfidence) {
        rules.push({
          antecedent: data.productNames.get(antecedentId),
          consequent: data.productNames.get(consequentId),
          antecedentId,
          consequentId,
          absoluteSupport,
          relativeSupport,
          confidence,
        });
      }
    });
  });
  rules.sort((a, b) => b.confidence - a.confidence || b.absoluteSupport - a.absoluteSupport || a.antecedent.localeCompare(b.antecedent));

  const categoryRules = [];
  data.categoryPairCounts.forEach((absoluteSupport, key) => {
    const [cat1, cat2] = key.split("|");
    const relativeSupport = absoluteSupport / data.transactionCount;
    [[cat1, cat2], [cat2, cat1]].forEach(([antecedent, consequent]) => {
      const count = data.categoryCounts.get(antecedent) || 1;
      const confidence = absoluteSupport / count;
      categoryRules.push({
        antecedent,
        consequent,
        absoluteSupport,
        relativeSupport,
        confidence,
      });
    });
  });
  categoryRules.sort((a, b) => b.confidence - a.confidence || b.absoluteSupport - a.absoluteSupport);

  return { transactionCount: data.transactionCount, rules, categoryRules };
}

router.get("/inventory", (req, res) => {
  const lowThreshold = boundedNumber(req.query.lowThreshold, 5, 0, 1000000);
  const mediumThreshold = Math.max(lowThreshold, boundedNumber(req.query.mediumThreshold, 20, 0, 1000000));
  const scope = String(req.query.scope || "all").trim().toLowerCase();
  const category = String(req.query.category || "").trim();
  const search = String(req.query.search || "").trim().toLowerCase();

  const catalogProducts = db.prepare(`
    SELECT id AS product_id, name AS product_name, category, price, stock, 'catalog' AS origin
    FROM products
    WHERE vendor_id = ?
    ORDER BY stock ASC, name ASC
  `).all(req.user.id);

  let products = [];
  if (scope === "catalog") {
    products = catalogProducts;
  } else if (scope === "dataset") {
    let query = "SELECT product_id, product_name, category, price, stock, 'dataset' AS origin FROM analytics_products WHERE 1=1";
    const params = [];
    if (category) {
      query += " AND lower(category) = lower(?)";
      params.push(category);
    }
    if (search) {
      query += " AND (lower(product_name) LIKE ? OR lower(product_id) LIKE ?)";
      params.push(`%${search}%`, `%${search}%`);
    }
    query += " ORDER BY stock ASC, product_name ASC LIMIT 100";
    products = db.prepare(query).all(...params);
  } else {
    if (catalogProducts.length > 0) {
      products = catalogProducts;
    } else {
      let query = "SELECT product_id, product_name, category, price, stock, 'dataset' AS origin FROM analytics_products WHERE 1=1";
      const params = [];
      if (category) {
        query += " AND lower(category) = lower(?)";
        params.push(category);
      }
      query += " ORDER BY stock ASC, product_name ASC LIMIT 50";
      products = db.prepare(query).all(...params);
    }
  }

  const enrichedProducts = products.map((product) => ({
    ...product,
    status: product.stock <= 0 ? "out_of_stock" : product.stock <= lowThreshold ? "low_stock" : product.stock <= mediumThreshold ? "medium_stock" : "healthy_stock",
  }));

  const counts = enrichedProducts.reduce((summary, product) => {
    summary[product.status] = (summary[product.status] || 0) + 1;
    summary.totalStock += product.stock;
    return summary;
  }, { out_of_stock: 0, low_stock: 0, medium_stock: 0, healthy_stock: 0, totalStock: 0 });

  res.json({
    dataSource: scope === "catalog" ? "live_catalog" : (scope === "dataset" ? "historical_dataset" : (catalogProducts.length ? "live_catalog" : "historical_sample")),
    thresholds: { lowThreshold, mediumThreshold },
    summary: {
      totalProducts: enrichedProducts.length,
      totalStock: counts.totalStock,
      outOfStock: counts.out_of_stock || 0,
      lowStock: counts.low_stock || 0,
      mediumStock: counts.medium_stock || 0,
      healthyStock: counts.healthy_stock || 0,
      requiringRestock: (counts.out_of_stock || 0) + (counts.low_stock || 0)
    },
    products: enrichedProducts
  });
});

router.get("/historical-summary", (req, res) => {
  const products = db.prepare("SELECT COUNT(*) AS totalProducts FROM analytics_products").get();
  const customers = db.prepare("SELECT COUNT(*) AS totalCustomers FROM analytics_customers").get();
  const sales = db.prepare("SELECT COUNT(*) AS totalOrders, COALESCE(SUM(total_amount), 0) AS totalRevenue FROM analytics_orders").get();

  res.json({
    totalProducts: products.totalProducts,
    totalCustomers: customers.totalCustomers,
    totalOrders: sales.totalOrders,
    totalRevenue: sales.totalRevenue,
  });
});

router.get("/customers", (req, res) => {
  const highThreshold = boundedNumber(req.query.highSpendThreshold, 50000, 1000, 1000000);
  const mediumThreshold = boundedNumber(req.query.mediumSpendThreshold, 20000, 100, highThreshold);

  const customers = db.prepare(`
    SELECT c.customer_id, c.customer_name, c.email, COUNT(o.order_id) AS orderCount,
           COALESCE(SUM(o.total_amount), 0) AS totalSpending,
           COALESCE(AVG(o.total_amount), 0) AS averageOrderValue,
           MAX(o.order_date) AS lastOrderDate
    FROM analytics_customers c
    LEFT JOIN analytics_orders o ON o.customer_id = c.customer_id
    GROUP BY c.customer_id
    ORDER BY totalSpending DESC, orderCount DESC, c.customer_name ASC
  `).all();

  const categorized = customers.map((c) => {
    let tier = "Low Value";
    let tierCode = "low";
    if (c.totalSpending >= highThreshold) {
      tier = "High Value";
      tierCode = "high";
    } else if (c.totalSpending >= mediumThreshold) {
      tier = "Medium Value";
      tierCode = "medium";
    }
    return {
      ...c,
      tier,
      tierCode,
      segment: tier
    };
  });

  const tierSummary = {
    high: { count: 0, totalSpend: 0, orders: 0 },
    medium: { count: 0, totalSpend: 0, orders: 0 },
    low: { count: 0, totalSpend: 0, orders: 0 },
  };

  categorized.forEach((c) => {
    tierSummary[c.tierCode].count += 1;
    tierSummary[c.tierCode].totalSpend += c.totalSpending;
    tierSummary[c.tierCode].orders += c.orderCount;
  });

  const totalRevenue = categorized.reduce((sum, c) => sum + c.totalSpending, 0);
  const totalOrders = categorized.reduce((sum, c) => sum + (c.orderCount || 0), 0);

  res.json({
    summary: {
      totalCustomers: customers.length,
      totalSpend: totalRevenue,
      averageOrderValue: totalOrders ? Math.round(totalRevenue / totalOrders) : 0,
      averageOrdersPerCustomer: customers.length ? (totalOrders / customers.length).toFixed(1) : 0,
      highThreshold,
      mediumThreshold,
      tiers: {
        high: {
          label: "High Value (VIP)",
          threshold: `>= ₹${highThreshold.toLocaleString("en-IN")}`,
          count: tierSummary.high.count,
          totalSpend: tierSummary.high.totalSpend,
          spendPct: totalRevenue ? Math.round((tierSummary.high.totalSpend / totalRevenue) * 100) : 0,
          avgSpend: tierSummary.high.count ? Math.round(tierSummary.high.totalSpend / tierSummary.high.count) : 0,
          orders: tierSummary.high.orders
        },
        medium: {
          label: "Medium Value (Regular)",
          threshold: `₹${mediumThreshold.toLocaleString("en-IN")} - ₹${highThreshold.toLocaleString("en-IN")}`,
          count: tierSummary.medium.count,
          totalSpend: tierSummary.medium.totalSpend,
          spendPct: totalRevenue ? Math.round((tierSummary.medium.totalSpend / totalRevenue) * 100) : 0,
          avgSpend: tierSummary.medium.count ? Math.round(tierSummary.medium.totalSpend / tierSummary.medium.count) : 0,
          orders: tierSummary.medium.orders
        },
        low: {
          label: "Low Value (Starter)",
          threshold: `< ₹${mediumThreshold.toLocaleString("en-IN")}`,
          count: tierSummary.low.count,
          totalSpend: tierSummary.low.totalSpend,
          spendPct: totalRevenue ? Math.round((tierSummary.low.totalSpend / totalRevenue) * 100) : 0,
          avgSpend: tierSummary.low.count ? Math.round(tierSummary.low.totalSpend / tierSummary.low.count) : 0,
          orders: tierSummary.low.orders
        }
      }
    },
    segmentationMethod: "Customers are categorized into 3 tiers based on historical spend: High Value (>= ₹50,000), Medium Value (₹20,000 - ₹50,000), and Low Value (< ₹20,000).",
    customers: categorized,
    mostActiveCustomers: categorized.slice(0, 100),
  });
});

router.get("/top-products", (req, res) => {
  const limit = boundedNumber(req.query.limit, 10, 1, 100);
  const category = String(req.query.category || "").trim();
  const products = category
    ? db.prepare(`
      SELECT p.product_id, p.product_name, p.category, SUM(oi.quantity) AS unitsSold,
             SUM(oi.quantity * oi.unit_price) AS revenue
      FROM analytics_order_items oi
      JOIN analytics_products p ON p.product_id = oi.product_id
      WHERE lower(p.category) = lower(?)
      GROUP BY p.product_id
      ORDER BY unitsSold DESC, revenue DESC, p.product_name ASC
      LIMIT ?
    `).all(category, limit)
    : db.prepare(`
      SELECT p.product_id, p.product_name, p.category, SUM(oi.quantity) AS unitsSold,
             SUM(oi.quantity * oi.unit_price) AS revenue
      FROM analytics_order_items oi
      JOIN analytics_products p ON p.product_id = oi.product_id
      GROUP BY p.product_id
      ORDER BY unitsSold DESC, revenue DESC, p.product_name ASC
      LIMIT ?
    `).all(limit);

  res.json({ category: category || null, limit, recommendationRule: "Products are ranked by historical units sold, then historical revenue.", products });
});

router.get("/sales", (req, res) => {
  if (!salesTimeseriesCache) {
    const summary = db.prepare(`SELECT COUNT(*) AS totalOrders, COALESCE(SUM(total_amount), 0) AS totalRevenue, COALESCE(AVG(total_amount), 0) AS averageOrderValue FROM analytics_orders`).get();
    const totalProductsSold = db.prepare("SELECT COALESCE(SUM(quantity), 0) AS total FROM analytics_order_items").get().total;
    const topProducts = db.prepare(`SELECT p.product_id, p.product_name, p.category, SUM(oi.quantity) AS unitsSold, SUM(oi.quantity * oi.unit_price) AS revenue FROM analytics_order_items oi JOIN analytics_products p ON p.product_id = oi.product_id GROUP BY oi.product_id ORDER BY unitsSold DESC, revenue DESC LIMIT 10`).all();
    const byCategory = db.prepare(`SELECT p.category, SUM(oi.quantity) AS unitsSold, SUM(oi.quantity * oi.unit_price) AS revenue FROM analytics_order_items oi JOIN analytics_products p ON p.product_id = oi.product_id GROUP BY p.category ORDER BY revenue DESC`).all();

    const salesByDate = db.prepare(`
      SELECT o.order_date AS date,
             SUM(o.total_amount) AS revenue,
             COUNT(DISTINCT o.order_id) AS orders,
             COALESCE(SUM(oi.quantity), 0) AS purchases,
             ROUND(COALESCE(AVG(o.total_amount), 0), 2) AS aov
      FROM analytics_orders o
      LEFT JOIN analytics_order_items oi ON oi.order_id = o.order_id
      GROUP BY o.order_date
      ORDER BY o.order_date ASC
    `).all();

    const revenueByPeriod = {
      day30: salesByDate.slice(-30),
      day90: salesByDate.slice(-90),
      year: salesByDate,
      week: db.prepare("SELECT CASE strftime('%w', o.order_date) WHEN '0' THEN 'Sunday' WHEN '1' THEN 'Monday' WHEN '2' THEN 'Tuesday' WHEN '3' THEN 'Wednesday' WHEN '4' THEN 'Thursday' WHEN '5' THEN 'Friday' ELSE 'Saturday' END AS period, SUM(oi.quantity * oi.unit_price) AS revenue, COUNT(DISTINCT o.order_id) AS orders, COALESCE(SUM(oi.quantity), 0) AS purchases FROM analytics_orders o JOIN analytics_order_items oi ON oi.order_id = o.order_id GROUP BY strftime('%w', o.order_date) ORDER BY CAST(strftime('%w', o.order_date) AS INTEGER) ASC").all(),
      month: db.prepare("SELECT CASE strftime('%m', o.order_date) WHEN '01' THEN 'Jan' WHEN '02' THEN 'Feb' WHEN '03' THEN 'Mar' WHEN '04' THEN 'Apr' WHEN '05' THEN 'May' WHEN '06' THEN 'Jun' WHEN '07' THEN 'Jul' WHEN '08' THEN 'Aug' WHEN '09' THEN 'Sep' WHEN '10' THEN 'Oct' WHEN '11' THEN 'Nov' ELSE 'Dec' END AS period, SUM(oi.quantity * oi.unit_price) AS revenue, COUNT(DISTINCT o.order_id) AS orders, COALESCE(SUM(oi.quantity), 0) AS purchases FROM analytics_orders o JOIN analytics_order_items oi ON oi.order_id = o.order_id GROUP BY strftime('%m', o.order_date) ORDER BY strftime('%m', o.order_date) ASC").all(),
    };

    salesTimeseriesCache = {
      summary: { ...summary, totalProductsSold },
      topProducts,
      topCategories: byCategory,
      revenueByCategory: byCategory,
      salesByDate,
      revenueByPeriod
    };
  }

  res.json(salesTimeseriesCache);
});

router.get("/frequent-patterns", (req, res) => {
  const { minimumSupport } = supportOptions(req.query);
  const result = frequentPatterns(minimumSupport);
  res.json({ minimumSupport, ...result });
});

router.get("/association-rules", (req, res) => {
  const { minimumSupport, minimumConfidence } = supportOptions(req.query);
  const result = associationRules(minimumSupport, minimumConfidence);
  res.json({ minimumSupport, minimumConfidence, ...result });
});

router.get("/recommendations", (req, res) => {
  const { minimumSupport, minimumConfidence } = supportOptions(req.query);
  const result = associationRules(minimumSupport, minimumConfidence);
  const topSelling = db.prepare(`
    SELECT p.product_id, p.product_name, p.category, p.price, SUM(oi.quantity) AS unitsSold
    FROM analytics_order_items oi JOIN analytics_products p ON p.product_id = oi.product_id
    GROUP BY p.product_id ORDER BY unitsSold DESC, p.product_name ASC LIMIT 12
  `).all().map((product) => ({ ...product, reason: `Top selling in ${product.category}` }));
  const category = String(req.query.category || "").trim();
  const topInCategory = category ? db.prepare(`
    SELECT p.product_id, p.product_name, p.category, p.price, SUM(oi.quantity) AS unitsSold
    FROM analytics_order_items oi JOIN analytics_products p ON p.product_id = oi.product_id
    WHERE lower(p.category) = lower(?) GROUP BY p.product_id
    ORDER BY unitsSold DESC, p.product_name ASC LIMIT 12
  `).all(category).map((product) => ({ ...product, reason: `Top selling in ${product.category}` })) : [];

  const ruleRecommendations = result.rules.slice(0, 15).map((rule) => ({
    recommendedProduct: rule.consequent,
    basedOnProduct: rule.antecedent,
    absoluteSupport: rule.absoluteSupport,
    relativeSupport: rule.relativeSupport,
    confidence: rule.confidence,
    reason: `Frequently purchased with ${rule.antecedent} (${rule.absoluteSupport} orders).`,
  }));

  const fallbackRecommendations = topSelling.slice(0, 8).map((p, idx) => {
    const paired = topSelling[(idx + 1) % topSelling.length];
    return {
      recommendedProduct: p.product_name,
      basedOnProduct: paired.product_name,
      absoluteSupport: p.unitsSold,
      relativeSupport: p.unitsSold / 5000,
      confidence: 0.85,
      reason: `Bestseller in ${p.category} (${p.unitsSold} units sold).`,
    };
  });

  const finalRecommendations = ruleRecommendations.length >= 6 ? ruleRecommendations : [...ruleRecommendations, ...fallbackRecommendations].slice(0, 15);

  res.json({
    minimumSupport,
    minimumConfidence,
    transactionCount: result.transactionCount,
    topSelling,
    topInCategory,
    recommendations: finalRecommendations,
    categoryAffinity: result.categoryRules?.slice(0, 8) || []
  });
});

router.get("/validation", (req, res) => {
  try {
    if (validationCache) return res.json(validationCache);
    const orders = datasetRows("orders_1.xlsx");
    const customers = datasetRows("customers_1.xlsx");
    const products = datasetRows("products_1.xlsx");
    const items = datasetRows("order_items_1.xlsx");
    const calculated = {
      orders: db.prepare("SELECT COUNT(*) AS value FROM analytics_orders").get().value,
      revenue: db.prepare("SELECT COALESCE(SUM(total_amount), 0) AS value FROM analytics_orders").get().value,
      productsSold: db.prepare("SELECT COALESCE(SUM(quantity), 0) AS value FROM analytics_order_items").get().value,
      customers: db.prepare("SELECT COUNT(*) AS value FROM analytics_customers").get().value,
      products: db.prepare("SELECT COUNT(*) AS value FROM analytics_products").get().value,
    };
    const expected = {
      orders: orders.length,
      revenue: orders.reduce((sum, row) => sum + Number(row.total_amount || 0), 0),
      productsSold: items.reduce((sum, row) => sum + Number(row.quantity || 0), 0),
      customers: customers.length,
      products: products.length
    };
    const labels = { orders: "Orders", revenue: "Revenue", productsSold: "Products Sold", customers: "Customers", products: "Historical Products" };
    const checks = Object.keys(labels).map((key) => {
      const difference = calculated[key] - expected[key];
      const tolerance = key === "revenue" ? 0.01 : 0;
      return { metric: key, label: labels[key], calculated: calculated[key], expected: expected[key], difference, status: Math.abs(difference) <= tolerance ? "passed" : "failed" };
    });
    validationCache = { status: checks.every((check) => check.status === "passed") ? "passed" : "failed", checks };
    res.json(validationCache);
  } catch (error) {
    res.status(500).json({ error: "Unable to validate the historical dataset." });
  }
});

// Comprehensive Demand Forecast
router.get("/forecast", (req, res) => {
  const lowThreshold = boundedNumber(req.query.lowThreshold, 5, 0, 1000000);
  const mediumThreshold = Math.max(lowThreshold, boundedNumber(req.query.mediumThreshold, 20, 0, 1000000));
  const forecastPeriod = boundedNumber(req.query.days || req.query.forecastDays, 30, 1, 365);
  const scope = String(req.query.scope || "all").trim().toLowerCase();
  const categoryFilter = String(req.query.category || "").trim();
  const searchQuery = String(req.query.search || "").trim().toLowerCase();
  const limit = boundedNumber(req.query.limit, 250, 1, 10000);

  // 1. Fetch vendor's live catalog
  const catalogProducts = db.prepare(`
    SELECT id AS product_id, name AS product_name, category, price, stock, 'catalog' AS origin
    FROM products
    WHERE vendor_id = ?
    ORDER BY stock ASC, name ASC
  `).all(req.user.id);

  // 2. Fetch recorded vendor sales
  const liveSales = db.prepare(`
    SELECT product_id, SUM(quantity) AS unitsSold, MIN(date(sold_at)) AS firstSaleDate, MAX(date(sold_at)) AS lastSaleDate
    FROM sales
    WHERE vendor_id = ?
    GROUP BY product_id
  `).all(req.user.id).map((row) => ({ ...row, observedDays: observedDays(row.firstSaleDate, row.lastSaleDate) }));
  const liveSalesByProduct = new Map(liveSales.map((row) => [String(row.product_id), row]));

  // 3. Cached historical products
  const historical = getHistoricalProducts();
  const history = historical.list;
  const historyById = historical.byId;
  const historyByName = historical.byName;
  const categoryTotals = historical.categoryTotals;

  // Decide which products to include
  let targetProducts = [];

  if (scope === "catalog") {
    targetProducts = catalogProducts;
  } else if (scope === "dataset") {
    let datasetList = history;
    if (categoryFilter) {
      datasetList = datasetList.filter(p => p.category.toLowerCase() === categoryFilter.toLowerCase());
    }
    if (searchQuery) {
      datasetList = datasetList.filter(p => p.product_name.toLowerCase().includes(searchQuery) || String(p.product_id).toLowerCase().includes(searchQuery));
    }
    const sorted = [...datasetList].sort((a, b) => (b.unitsSold || 0) - (a.unitsSold || 0));
    targetProducts = sorted.slice(0, limit).map(p => ({ ...p, origin: 'dataset' }));
  } else {
    // Combined
    let datasetList = history;
    if (categoryFilter) {
      datasetList = datasetList.filter(p => p.category.toLowerCase() === categoryFilter.toLowerCase());
    }
    if (searchQuery) {
      datasetList = datasetList.filter(p => p.product_name.toLowerCase().includes(searchQuery) || String(p.product_id).toLowerCase().includes(searchQuery));
    }
    const sortedDataset = [...datasetList].sort((a, b) => (b.unitsSold || 0) - (a.unitsSold || 0));
    targetProducts = [
      ...catalogProducts,
      ...sortedDataset.slice(0, Math.max(80, limit)).map(p => ({ ...p, origin: 'dataset' }))
    ];
  }

  const forecasts = targetProducts.map((product) => {
    const isCatalog = product.origin === 'catalog';
    const recorded = isCatalog ? liveSalesByProduct.get(String(product.product_id)) : null;
    const exactId = historyById.get(String(product.product_id));
    const exactName = historyByName.get(normalizedName(product.product_name));
    const exact = exactId || exactName;
    const fallback = categoryTotals.get(categoryKey(product.category));

    const historicalSales = Number(
      recorded?.unitsSold ?? (exact ? exact.unitsSold : (fallback ? Math.round(fallback.units / fallback.products) : 0))
    );
    const periods = recorded?.observedDays || exact?.observedDays || fallback?.days || 365;
    const averageDailySales = periods > 0 ? historicalSales / periods : 0;
    const predictedDemand = Math.max(1, Math.round(averageDailySales * forecastPeriod));
    const shortage = Math.max(predictedDemand - product.stock, 0);
    const recommendedRestock = shortage;
    const runoutDays = averageDailySales > 0 ? Math.floor(product.stock / averageDailySales) : 999;
    const stockCoveragePct = Math.round((product.stock / Math.max(1, predictedDemand)) * 100);
    const revenueAtRisk = Math.round(shortage * (product.price || 0));

    let forecastBasis = "category-average history";
    let forecastBasisLabel = "Category average";
    if (recorded) {
      forecastBasis = "recorded vendor sales";
      forecastBasisLabel = "Your recorded sales";
    } else if (exact && (exact.unitsSold > 0 || !isCatalog)) {
      forecastBasis = "matched dataset history";
      forecastBasisLabel = "Historical Dataset (Exact Match)";
    } else if (fallback) {
      forecastBasis = "category-average history";
      forecastBasisLabel = `Category average (${product.category})`;
    }

    return {
      product_id: product.product_id,
      product_name: product.product_name,
      category: product.category,
      price: product.price,
      stock: product.stock,
      origin: product.origin || 'dataset',
      historicalSales,
      observedDays: periods,
      orderCount: exact?.orderCount || (historicalSales > 0 ? Math.ceil(historicalSales / 2) : 0),
      averageDailySales,
      predictedDemand,
      thirtyDayDemand: Math.max(1, Math.round(averageDailySales * 30)),
      stockRequirement: predictedDemand,
      shortage,
      recommendedRestock,
      runoutDays,
      stockCoveragePct,
      revenueAtRisk,
      forecastBasis,
      forecastBasisLabel,
      status: forecastStatus(product.stock, predictedDemand, lowThreshold, mediumThreshold)
    };
  });

  res.json({
    dataSource: scope === "catalog" ? "live_catalog" : (scope === "dataset" ? "historical_dataset" : "combined"),
    forecastPeriodDays: forecastPeriod,
    thresholds: { lowThreshold, mediumThreshold },
    totalProductsCount: history.length,
    catalogCount: catalogProducts.length,
    categories: historical.categories,
    forecasts,
    alertCount: forecasts.filter((item) => item.status !== "healthy").length
  });
});

router.get("/forecast/product-detail", (req, res) => {
  const productId = String(req.query.productId || "").trim();
  if (!productId) return res.status(400).json({ error: "productId is required" });
  const monthlySales = getMonthlyProductSales(productId);
  res.json({ productId, monthlySales });
});

router.get("/sentiment", (req, res) => {
  res.json({ available: false, message: "No review data available in dataset.", products: [] });
});

router.get("/similar-products", (req, res) => {
  const productId = String(req.query.productId || "").trim();
  if (!productId) return res.status(400).json({ error: "productId is required" });
  const product = db.prepare("SELECT product_id, product_name, category, price FROM analytics_products WHERE product_id = ?").get(productId);
  if (!product) return res.status(404).json({ error: "Historical product not found" });
  const tokens = new Set(normalizedName(product.product_name).split(" ").filter(Boolean));
  const similarProducts = db.prepare("SELECT product_id, product_name, category, price FROM analytics_products WHERE product_id != ?").all(productId)
    .map((candidate) => {
      const overlap = normalizedName(candidate.product_name).split(" ").filter((token) => tokens.has(token)).length;
      const sameCategory = candidate.category.toLowerCase() === product.category.toLowerCase();
      return { ...candidate, score: (sameCategory ? 2 : 0) + overlap, reason: sameCategory ? `Similar category: ${candidate.category}` : "Similar product name" };
    })
    .filter((candidate) => candidate.score > 0).sort((a, b) => b.score - a.score || a.product_name.localeCompare(b.product_name)).slice(0, 6);
  res.json({ product, similarProducts });
});

module.exports = router;

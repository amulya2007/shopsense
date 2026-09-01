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

  // Get vendor's actual catalog products
  const catalogProducts = db.prepare(`
    SELECT id AS product_id, name AS product_name, category, price, stock, 'catalog' AS origin
    FROM products
    WHERE vendor_id = ?
    ORDER BY stock ASC, name ASC
  `).all(req.user.id);

  // Get accurate total count for vendor's catalog
  const actualCatalogCount = catalogProducts.length;

  let products = [];
  let actualTotalCount = 0; // This will be the accurate total
  
  if (scope === "catalog") {
    products = catalogProducts;
    actualTotalCount = catalogProducts.length;
  } else if (scope === "dataset") {
    // For dataset scope, get the ACTUAL total count before filtering
    let countQuery = "SELECT COUNT(*) AS total FROM analytics_products WHERE 1=1";
    const countParams = [];
    if (category) {
      countQuery += " AND lower(category) = lower(?)";
      countParams.push(category);
    }
    if (search) {
      countQuery += " AND (lower(product_name) LIKE ? OR lower(product_id) LIKE ?)";
      countParams.push(`%${search}%`, `%${search}%`);
    }
    actualTotalCount = db.prepare(countQuery).get(...countParams).total;
    
    // Get products for display (limited)
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
    // "all" scope - prioritize catalog if exists
    if (catalogProducts.length > 0) {
      products = catalogProducts;
      actualTotalCount = catalogProducts.length;
    } else {
      // Fallback to dataset sample
      let countQuery = "SELECT COUNT(*) AS total FROM analytics_products WHERE 1=1";
      const countParams = [];
      if (category) {
        countQuery += " AND lower(category) = lower(?)";
        countParams.push(category);
      }
      actualTotalCount = db.prepare(countQuery).get(...countParams).total;
      
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
    status: product.stock <= 0 ? "out_of_stock" : product.stock <= lowThreshold ? "low_stock" : "healthy_stock",
  }));

  // Calculate status counts from the ACTUAL catalog, not limited/filtered products
  let statusCounts = { out_of_stock: 0, low_stock: 0, healthy_stock: 0, totalStock: 0 };
  
  if (scope === "catalog" || (scope === "all" && catalogProducts.length > 0)) {
    // For catalog scope, count ALL catalog products accurately
    statusCounts = catalogProducts.reduce((summary, product) => {
      const status = product.stock <= 0 ? "out_of_stock" : product.stock <= lowThreshold ? "low_stock" : "healthy_stock";
      summary[status] = (summary[status] || 0) + 1;
      summary.totalStock += product.stock;
      return summary;
    }, { out_of_stock: 0, low_stock: 0, healthy_stock: 0, totalStock: 0 });
  } else {
    // For dataset scope, use the enriched products (they're already limited)
    statusCounts = enrichedProducts.reduce((summary, product) => {
      summary[product.status] = (summary[product.status] || 0) + 1;
      summary.totalStock += product.stock;
      return summary;
    }, { out_of_stock: 0, low_stock: 0, healthy_stock: 0, totalStock: 0 });
  }

  res.json({
    dataSource: scope === "catalog" ? "live_catalog" : (scope === "dataset" ? "historical_dataset" : (catalogProducts.length ? "live_catalog" : "historical_sample")),
    thresholds: { lowThreshold, mediumThreshold },
    summary: {
      totalProducts: actualTotalCount, // Accurate total count
      displayedProducts: enrichedProducts.length, // How many are shown in the list
      totalStock: statusCounts.totalStock,
      outOfStock: statusCounts.out_of_stock || 0,
      lowStock: statusCounts.low_stock || 0,
      healthyStock: statusCounts.healthy_stock || 0, // Now includes medium stock
      requiringRestock: (statusCounts.out_of_stock || 0) + (statusCounts.low_stock || 0)
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

// =========================================================================
// ADVANCED REPORTING APIS, BENCHMARKING & CSV EXPORT
// =========================================================================

function escapeCsvField(val) {
  if (val === null || val === undefined) return '""';
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return `"${str}"`;
}

// 1. Reporting: Sales / Revenue Over Time
router.get("/reporting/sales-over-time", (req, res) => {
  try {
    const timeframe = String(req.query.timeframe || "30d").trim().toLowerCase();
    const scope = String(req.query.scope || (req.user.role === "vendor" ? "vendor" : "marketplace")).trim().toLowerCase();
    const vendorId = req.user.role === "admin" && req.query.vendorId ? Number(req.query.vendorId) : req.user.id;

    if (scope === "vendor") {
      let salesQuery = "";
      if (timeframe === "month") {
        // Aggregate by calendar month - returns all months chronologically
        salesQuery = `
          SELECT strftime('%Y-%m', sold_at) AS date,
                 strftime('%Y-%m', sold_at) AS label,
                 COALESCE(SUM(amount), 0) AS revenue,
                 COUNT(id) AS orders,
                 COALESCE(SUM(quantity), 0) AS unitsSold,
                 ROUND(COALESCE(AVG(amount), 0), 2) AS aov
          FROM sales
          WHERE vendor_id = ?
          GROUP BY strftime('%Y-%m', sold_at)
          ORDER BY strftime('%Y-%m', sold_at) ASC
        `;
      } else if (timeframe === "week") {
        // Get 7 days (Monday to Sunday) of aggregated data
        // Uses a calendar-based approach to ensure all 7 days are represented
        salesQuery = `
          WITH days AS (
            SELECT 0 AS day_offset, 'Monday' AS day_name
            UNION SELECT 1, 'Tuesday'
            UNION SELECT 2, 'Wednesday'
            UNION SELECT 3, 'Thursday'
            UNION SELECT 4, 'Friday'
            UNION SELECT 5, 'Saturday'
            UNION SELECT 6, 'Sunday'
          )
          SELECT 
            days.day_name AS label,
            days.day_offset AS date,
            COALESCE(SUM(s.amount), 0) AS revenue,
            COALESCE(COUNT(s.id), 0) AS orders,
            COALESCE(SUM(s.quantity), 0) AS unitsSold,
            ROUND(COALESCE(AVG(s.amount), 0), 2) AS aov
          FROM days
          LEFT JOIN sales s ON 
            s.vendor_id = ? AND
            ((CAST(strftime('%w', s.sold_at) AS INTEGER) + 6) % 7) = days.day_offset
          GROUP BY days.day_offset, days.day_name
          ORDER BY days.day_offset ASC
        `;
      } else {
        // Day view - show hourly aggregation across all sales to reveal hourly patterns
        salesQuery = `
          WITH hours AS (
            SELECT 0 AS hour UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 
            UNION SELECT 4 UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 
            UNION SELECT 8 UNION SELECT 9 UNION SELECT 10 UNION SELECT 11 
            UNION SELECT 12 UNION SELECT 13 UNION SELECT 14 UNION SELECT 15 
            UNION SELECT 16 UNION SELECT 17 UNION SELECT 18 UNION SELECT 19 
            UNION SELECT 20 UNION SELECT 21 UNION SELECT 22 UNION SELECT 23
          )
          SELECT 
            hours.hour AS hour,
            printf('%02d:00', hours.hour) AS label,
            COALESCE(SUM(s.amount), 0) AS revenue,
            COALESCE(COUNT(s.id), 0) AS orders,
            COALESCE(SUM(s.quantity), 0) AS unitsSold,
            ROUND(COALESCE(AVG(s.amount), 0), 2) AS aov
          FROM hours
          LEFT JOIN sales s ON 
            s.vendor_id = ? AND
            CAST(strftime('%H', s.sold_at) AS INTEGER) = hours.hour
          GROUP BY hours.hour
          ORDER BY hours.hour ASC
        `;
      }

      const rawData = db.prepare(salesQuery).all(vendorId);
      const totalRevenue = rawData.reduce((sum, r) => sum + Number(r.revenue || 0), 0);
      const totalOrders = rawData.reduce((sum, r) => sum + Number(r.orders || 0), 0);
      const totalUnits = rawData.reduce((sum, r) => sum + Number(r.unitsSold || 0), 0);
      const aov = totalOrders > 0 ? Math.round((totalRevenue / totalOrders) * 100) / 100 : 0;

      return res.json({
        scope: "vendor",
        timeframe,
        vendorId,
        summary: {
          totalRevenue,
          totalOrders,
          totalUnitsSold: totalUnits,
          averageOrderValue: aov
        },
        data: rawData
      });
    }

    // Marketplace scope
    const salesData = getHistoricalProducts(); // ensure cache
    if (!salesTimeseriesCache) {
      // Trigger cache population
      db.prepare("SELECT COUNT(*) FROM analytics_orders").get();
    }
    // Pull from analytics_orders
    let marketplaceData = [];
    if (timeframe === "month") {
      marketplaceData = db.prepare(`
        SELECT CASE strftime('%m', o.order_date)
                 WHEN '01' THEN 'Jan' WHEN '02' THEN 'Feb' WHEN '03' THEN 'Mar'
                 WHEN '04' THEN 'Apr' WHEN '05' THEN 'May' WHEN '06' THEN 'Jun'
                 WHEN '07' THEN 'Jul' WHEN '08' THEN 'Aug' WHEN '09' THEN 'Sep'
                 WHEN '10' THEN 'Oct' WHEN '11' THEN 'Nov' ELSE 'Dec' END AS label,
               strftime('%m', o.order_date) AS date,
               COALESCE(SUM(oi.quantity * oi.unit_price), 0) AS revenue,
               COUNT(DISTINCT o.order_id) AS orders,
               COALESCE(SUM(oi.quantity), 0) AS unitsSold,
               ROUND(COALESCE(AVG(o.total_amount), 0), 2) AS aov
        FROM analytics_orders o
        JOIN analytics_order_items oi ON oi.order_id = o.order_id
        GROUP BY strftime('%m', o.order_date)
        ORDER BY strftime('%m', o.order_date) ASC
      `).all();
    } else if (timeframe === "week") {
      marketplaceData = db.prepare(`
        SELECT date(o.order_date, '-' || ((CAST(strftime('%w', o.order_date) AS INTEGER) + 6) % 7) || ' days') AS date,
               date(o.order_date, '-' || ((CAST(strftime('%w', o.order_date) AS INTEGER) + 6) % 7) || ' days') AS label,
               COALESCE(SUM(oi.quantity * oi.unit_price), 0) AS revenue,
               COUNT(DISTINCT o.order_id) AS orders,
               COALESCE(SUM(oi.quantity), 0) AS unitsSold,
               ROUND(COALESCE(AVG(o.total_amount), 0), 2) AS aov
        FROM analytics_orders o
        JOIN analytics_order_items oi ON oi.order_id = o.order_id
        GROUP BY date(o.order_date, '-' || ((CAST(strftime('%w', o.order_date) AS INTEGER) + 6) % 7) || ' days')
        ORDER BY date ASC
      `).all();
    } else {
      const daySlice = timeframe === "90d" ? -90 : timeframe === "year" ? -365 : -30;
      const allDaily = db.prepare(`
        SELECT o.order_date AS date,
               strftime('%m-%d', o.order_date) AS label,
               COALESCE(SUM(o.total_amount), 0) AS revenue,
               COUNT(DISTINCT o.order_id) AS orders,
               COALESCE(SUM(oi.quantity), 0) AS unitsSold,
               ROUND(COALESCE(AVG(o.total_amount), 0), 2) AS aov
        FROM analytics_orders o
        LEFT JOIN analytics_order_items oi ON oi.order_id = o.order_id
        GROUP BY o.order_date
        ORDER BY o.order_date ASC
      `).all();
      marketplaceData = allDaily.slice(daySlice);
    }

    const totalRevenue = marketplaceData.reduce((sum, r) => sum + Number(r.revenue || 0), 0);
    const totalOrders = marketplaceData.reduce((sum, r) => sum + Number(r.orders || 0), 0);
    const totalUnits = marketplaceData.reduce((sum, r) => sum + Number(r.unitsSold || 0), 0);
    const aov = totalOrders > 0 ? Math.round((totalRevenue / totalOrders) * 100) / 100 : 0;

    res.json({
      scope: "marketplace",
      timeframe,
      summary: {
        totalRevenue,
        totalOrders,
        totalUnitsSold: totalUnits,
        averageOrderValue: aov
      },
      data: marketplaceData
    });
  } catch (error) {
    console.error("Sales over time error:", error);
    res.status(500).json({ error: "Failed to load sales over time data." });
  }
});

// 2. Reporting: Category Performance
router.get("/reporting/category-performance", (req, res) => {
  try {
    const scope = String(req.query.scope || "marketplace").trim().toLowerCase();
    const vendorId = req.user.role === "admin" && req.query.vendorId ? Number(req.query.vendorId) : req.user.id;

    if (scope === "vendor") {
      const categories = db.prepare(`
        SELECT p.category,
               COALESCE(SUM(s.amount), 0) AS revenue,
               COALESCE(SUM(s.quantity), 0) AS unitsSold,
               COUNT(s.id) AS orderCount,
               COUNT(DISTINCT p.id) AS productCount
        FROM products p
        LEFT JOIN sales s ON s.product_id = p.id AND s.vendor_id = p.vendor_id
        WHERE p.vendor_id = ?
        GROUP BY p.category
        ORDER BY revenue DESC, unitsSold DESC
      `).all(vendorId);

      const totalRevenue = categories.reduce((s, c) => s + Number(c.revenue || 0), 0);
      const totalUnits = categories.reduce((s, c) => s + Number(c.unitsSold || 0), 0);

      const enriched = categories.map((c) => ({
        ...c,
        revenueSharePct: totalRevenue > 0 ? Math.round((c.revenue / totalRevenue) * 1000) / 10 : 0
      }));

      return res.json({
        scope: "vendor",
        vendorId,
        summary: {
          totalCategories: enriched.length,
          totalRevenue,
          totalUnitsSold: totalUnits
        },
        categories: enriched
      });
    }

    // Marketplace scope
    const categories = db.prepare(`
      SELECT p.category,
             COALESCE(SUM(oi.quantity * oi.unit_price), 0) AS revenue,
             COALESCE(SUM(oi.quantity), 0) AS unitsSold,
             COUNT(DISTINCT oi.order_id) AS orderCount,
             COUNT(DISTINCT p.product_id) AS productCount
      FROM analytics_products p
      JOIN analytics_order_items oi ON oi.product_id = p.product_id
      GROUP BY p.category
      ORDER BY revenue DESC
    `).all();

    const totalRevenue = categories.reduce((s, c) => s + Number(c.revenue || 0), 0);
    const totalUnits = categories.reduce((s, c) => s + Number(c.unitsSold || 0), 0);

    const enriched = categories.map((c) => ({
      ...c,
      revenueSharePct: totalRevenue > 0 ? Math.round((c.revenue / totalRevenue) * 1000) / 10 : 0
    }));

    res.json({
      scope: "marketplace",
      summary: {
        totalCategories: enriched.length,
        totalRevenue,
        totalUnitsSold: totalUnits
      },
      categories: enriched
    });
  } catch (error) {
    console.error("Category performance error:", error);
    res.status(500).json({ error: "Failed to load category performance data." });
  }
});

// 3. Reporting: Top-Selling Products
router.get("/reporting/top-products", (req, res) => {
  try {
    const limit = boundedNumber(req.query.limit, 10, 1, 100);
    const category = String(req.query.category || "").trim();
    const scope = String(req.query.scope || "marketplace").trim().toLowerCase();
    const vendorId = req.user.role === "admin" && req.query.vendorId ? Number(req.query.vendorId) : req.user.id;

    if (scope === "vendor") {
      let query = `
        SELECT p.id AS product_id,
               p.name AS product_name,
               p.category,
               p.price,
               p.stock,
               COALESCE(SUM(s.quantity), 0) AS unitsSold,
               COALESCE(SUM(s.amount), 0) AS revenue,
               COUNT(s.id) AS orderCount
        FROM products p
        LEFT JOIN sales s ON s.product_id = p.id AND s.vendor_id = p.vendor_id
        WHERE p.vendor_id = ?
      `;
      const params = [vendorId];
      if (category) {
        query += " AND lower(p.category) = lower(?)";
        params.push(category);
      }
      query += " GROUP BY p.id ORDER BY unitsSold DESC, revenue DESC LIMIT ?";
      params.push(limit);

      const products = db.prepare(query).all(...params);
      return res.json({
        scope: "vendor",
        limit,
        category: category || null,
        products
      });
    }

    // Marketplace scope
    let query = `
      SELECT p.product_id,
             p.product_name,
             p.category,
             p.price,
             p.stock,
             COALESCE(SUM(oi.quantity), 0) AS unitsSold,
             COALESCE(SUM(oi.quantity * oi.unit_price), 0) AS revenue,
             COUNT(DISTINCT oi.order_id) AS orderCount
      FROM analytics_products p
      JOIN analytics_order_items oi ON oi.product_id = p.product_id
      WHERE 1=1
    `;
    const params = [];
    if (category) {
      query += " AND lower(p.category) = lower(?)";
      params.push(category);
    }
    query += " GROUP BY p.product_id ORDER BY unitsSold DESC, revenue DESC LIMIT ?";
    params.push(limit);

    const products = db.prepare(query).all(...params);
    res.json({
      scope: "marketplace",
      limit,
      category: category || null,
      products
    });
  } catch (error) {
    console.error("Top products error:", error);
    res.status(500).json({ error: "Failed to load top products." });
  }
});

// 4. Reporting: Executive Summary
router.get("/reporting/summary", (req, res) => {
  try {
    const scope = String(req.query.scope || (req.user.role === "vendor" ? "vendor" : "marketplace")).trim().toLowerCase();
    const vendorId = req.user.role === "admin" && req.query.vendorId ? Number(req.query.vendorId) : req.user.id;

    if (scope === "vendor") {
      const salesRow = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) AS totalRevenue,
               COUNT(id) AS totalOrders,
               COALESCE(SUM(quantity), 0) AS totalUnitsSold
        FROM sales WHERE vendor_id = ?
      `).get(vendorId);

      const productCount = db.prepare("SELECT COUNT(*) AS c FROM products WHERE vendor_id = ?").get(vendorId).c;
      const topCat = db.prepare(`
        SELECT p.category, SUM(s.amount) AS revenue
        FROM sales s JOIN products p ON s.product_id = p.id
        WHERE s.vendor_id = ?
        GROUP BY p.category ORDER BY revenue DESC LIMIT 1
      `).get(vendorId);

      const topProd = db.prepare(`
        SELECT p.id AS product_id, p.name AS product_name, SUM(s.quantity) AS unitsSold, SUM(s.amount) AS revenue
        FROM sales s JOIN products p ON s.product_id = p.id
        WHERE s.vendor_id = ?
        GROUP BY p.id ORDER BY revenue DESC, unitsSold DESC LIMIT 1
      `).get(vendorId);

      const aov = salesRow.totalOrders > 0 ? Math.round((salesRow.totalRevenue / salesRow.totalOrders) * 100) / 100 : 0;

      return res.json({
        scope: "vendor",
        vendorId,
        totalRevenue: salesRow.totalRevenue,
        totalOrders: salesRow.totalOrders,
        totalUnitsSold: salesRow.totalUnitsSold,
        totalProducts: productCount,
        averageOrderValue: aov,
        topCategory: topCat ? { name: topCat.category, revenue: topCat.revenue } : null,
        topProduct: topProd || null
      });
    }

    // Marketplace scope
    const orderSummary = db.prepare(`
      SELECT COUNT(*) AS totalOrders,
             COALESCE(SUM(total_amount), 0) AS totalRevenue,
             COALESCE(AVG(total_amount), 0) AS averageOrderValue
      FROM analytics_orders
    `).get();

    const unitsRow = db.prepare("SELECT COALESCE(SUM(quantity), 0) AS totalUnitsSold FROM analytics_order_items").get();
    const productCount = db.prepare("SELECT COUNT(*) AS c FROM analytics_products").get().c;
    const customerCount = db.prepare("SELECT COUNT(*) AS c FROM analytics_customers").get().c;

    const topCat = db.prepare(`
      SELECT p.category, SUM(oi.quantity * oi.unit_price) AS revenue
      FROM analytics_order_items oi JOIN analytics_products p ON oi.product_id = p.product_id
      GROUP BY p.category ORDER BY revenue DESC LIMIT 1
    `).get();

    const topProd = db.prepare(`
      SELECT p.product_id, p.product_name, SUM(oi.quantity) AS unitsSold, SUM(oi.quantity * oi.unit_price) AS revenue
      FROM analytics_order_items oi JOIN analytics_products p ON oi.product_id = p.product_id
      GROUP BY p.product_id ORDER BY unitsSold DESC, revenue DESC LIMIT 1
    `).get();

    res.json({
      scope: "marketplace",
      totalRevenue: orderSummary.totalRevenue,
      totalOrders: orderSummary.totalOrders,
      totalUnitsSold: unitsRow.totalUnitsSold,
      totalProducts: productCount,
      totalCustomers: customerCount,
      averageOrderValue: Math.round(orderSummary.averageOrderValue * 100) / 100,
      topCategory: topCat ? {
        name: topCat.category,
        revenue: topCat.revenue,
        revenueSharePct: orderSummary.totalRevenue ? Math.round((topCat.revenue / orderSummary.totalRevenue) * 1000) / 10 : 0
      } : null,
      topProduct: topProd || null
    });
  } catch (error) {
    console.error("Executive summary error:", error);
    res.status(500).json({ error: "Failed to load summary." });
  }
});

// 5. Benchmarking: Vendor vs Marketplace Average
router.get("/benchmark", (req, res) => {
  try {
    const vendorId = req.user.role === "admin" && req.query.vendorId ? Number(req.query.vendorId) : req.user.id;
    const vendor = db.prepare("SELECT id, full_name, business_name, email FROM vendors WHERE id = ?").get(vendorId);
    if (!vendor) return res.status(404).json({ error: "Vendor not found" });

    // Vendor metrics
    const vendorRevenue = Number(db.prepare("SELECT COALESCE(SUM(amount), 0) AS v FROM sales WHERE vendor_id = ?").get(vendorId).v || 0);
    const vendorOrders = Number(db.prepare("SELECT COUNT(*) AS v FROM sales WHERE vendor_id = ?").get(vendorId).v || 0);
    const vendorUnits = Number(db.prepare("SELECT COALESCE(SUM(quantity), 0) AS v FROM sales WHERE vendor_id = ?").get(vendorId).v || 0);
    const vendorProducts = Number(db.prepare("SELECT COUNT(*) AS v FROM products WHERE vendor_id = ?").get(vendorId).v || 0);

    // Marketplace totals across approved vendors
    const vendorCount = Number(db.prepare("SELECT COUNT(*) AS c FROM vendors WHERE status = 'approved'").get().c || 1);
    const totalRevenue = Number(db.prepare("SELECT COALESCE(SUM(amount), 0) AS r FROM sales").get().r || 0);
    const totalOrders = Number(db.prepare("SELECT COUNT(*) AS o FROM sales").get().o || 0);
    const totalUnits = Number(db.prepare("SELECT COALESCE(SUM(quantity), 0) AS u FROM sales").get().u || 0);
    const totalProducts = Number(db.prepare("SELECT COUNT(*) AS p FROM products").get().p || 0);

    const marketplaceAvg = {
      revenue: Math.round((totalRevenue / Math.max(1, vendorCount)) * 100) / 100,
      orders: Math.round((totalOrders / Math.max(1, vendorCount)) * 10) / 10,
      unitsSold: Math.round((totalUnits / Math.max(1, vendorCount)) * 10) / 10,
      productCount: Math.round((totalProducts / Math.max(1, vendorCount)) * 10) / 10,
    };

    function compare(label, vendorVal, avgVal, isCurrency = false) {
      const diff = Math.round((vendorVal - avgVal) * 100) / 100;
      let pct = 0;
      if (avgVal > 0) {
        pct = Number((((vendorVal - avgVal) / avgVal) * 100).toFixed(1));
      } else if (vendorVal > 0) {
        pct = 100.0;
      }
      const status = pct > 0 ? "above" : pct < 0 ? "below" : "equal";
      const formattedDiff = `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;
      return {
        label,
        vendorValue: vendorVal,
        marketplaceAverage: avgVal,
        difference: diff,
        percentageDifference: pct,
        status,
        formattedDiff,
        currency: isCurrency
      };
    }

    const revenueComp = compare("Total Revenue", vendorRevenue, marketplaceAvg.revenue, true);
    const ordersComp = compare("Total Orders", vendorOrders, marketplaceAvg.orders, false);
    const unitsComp = compare("Units Sold", vendorUnits, marketplaceAvg.unitsSold, false);
    const productsComp = compare("Products Listed", vendorProducts, marketplaceAvg.productCount, false);

    const aboveCount = [revenueComp, ordersComp, unitsComp, productsComp].filter((c) => c.status === "above").length;
    let overallPerformance = "At Market Average";
    if (aboveCount >= 3) overallPerformance = "Top Performer (Above Average)";
    else if (aboveCount >= 2) overallPerformance = "Competitive (Above Average in key areas)";
    else if (revenueComp.status === "below") overallPerformance = "Growth Opportunity (Below Average)";

    const insights = [];
    if (revenueComp.status === "above") {
      insights.push(`Your revenue (₹${vendorRevenue.toLocaleString("en-IN")}) is ${revenueComp.formattedDiff} above the marketplace average.`);
    } else if (revenueComp.status === "below") {
      insights.push(`Your revenue (₹${vendorRevenue.toLocaleString("en-IN")}) is ${revenueComp.formattedDiff.replace("+", "")} below the marketplace average.`);
    } else {
      insights.push("Your revenue is on par with the marketplace average.");
    }

    if (productsComp.status === "below") {
      insights.push(`Listing more products (currently ${vendorProducts} vs avg ${marketplaceAvg.productCount}) can help expand your category reach and order volume.`);
    } else if (productsComp.status === "above") {
      insights.push(`Strong product catalog depth with ${vendorProducts} products listed (marketplace average: ${marketplaceAvg.productCount}).`);
    }

    if (unitsComp.status === "above") {
      insights.push(`High unit sales volume (${vendorUnits} units sold vs marketplace avg ${marketplaceAvg.unitsSold}).`);
    }

    res.json({
      vendor: {
        id: vendor.id,
        fullName: vendor.full_name,
        businessName: vendor.business_name,
        email: vendor.email
      },
      marketplace: {
        totalVendors: vendorCount,
        totalRevenue,
        totalOrders,
        totalUnitsSold: totalUnits,
        totalProducts
      },
      benchmarks: {
        revenue: revenueComp,
        orders: ordersComp,
        unitsSold: unitsComp,
        productCount: productsComp
      },
      overallPerformance,
      insights
    });
  } catch (error) {
    console.error("Benchmark calculation error:", error);
    res.status(500).json({ error: "Failed to calculate vendor benchmark metrics." });
  }
});

// 6. CSV Export: Sales Report
router.get("/export/sales", (req, res) => {
  try {
    const scope = String(req.query.scope || (req.user.role === "vendor" ? "vendor" : "marketplace")).trim().toLowerCase();
    const vendorId = req.user.role === "admin" && req.query.vendorId ? Number(req.query.vendorId) : req.user.id;

    let rows = [];
    if (scope === "vendor") {
      rows = db.prepare(`
        SELECT s.sold_at AS date,
               p.name AS product,
               p.category,
               s.quantity,
               p.price,
               s.amount AS revenue,
               v.business_name AS vendor
        FROM sales s
        JOIN products p ON s.product_id = p.id
        JOIN vendors v ON s.vendor_id = v.id
        WHERE s.vendor_id = ?
        ORDER BY s.sold_at DESC
      `).all(vendorId);

      // If vendor has no sales, fall back to empty array with headers
    } else {
      // Marketplace sales export
      rows = db.prepare(`
        SELECT o.order_date AS date,
               p.product_name AS product,
               p.category,
               oi.quantity,
               oi.unit_price AS price,
               (oi.quantity * oi.unit_price) AS revenue,
               'ShopSense Marketplace' AS vendor
        FROM analytics_order_items oi
        JOIN analytics_orders o ON oi.order_id = o.order_id
        JOIN analytics_products p ON oi.product_id = p.product_id
        ORDER BY o.order_date DESC
        LIMIT 5000
      `).all();
    }

    const headers = ["Date", "Product", "Category", "Quantity", "Price", "Revenue", "Vendor"];
    const csvLines = [headers.join(",")];

    rows.forEach((row) => {
      const line = [
        escapeCsvField(row.date),
        escapeCsvField(row.product),
        escapeCsvField(row.category),
        row.quantity !== undefined ? row.quantity : 0,
        row.price !== undefined ? Number(row.price).toFixed(2) : "0.00",
        row.revenue !== undefined ? Number(row.revenue).toFixed(2) : "0.00",
        escapeCsvField(row.vendor)
      ];
      csvLines.push(line.join(","));
    });

    const csvContent = csvLines.join("\r\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="sales_report.csv"');
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.send(csvContent);
  } catch (error) {
    console.error("Sales CSV export error:", error);
    res.status(500).json({ error: "Failed to generate sales CSV export." });
  }
});

// 7. CSV Export: Products Report
router.get("/export/products", (req, res) => {
  try {
    const scope = String(req.query.scope || (req.user.role === "vendor" ? "vendor" : "marketplace")).trim().toLowerCase();
    const vendorId = req.user.role === "admin" && req.query.vendorId ? Number(req.query.vendorId) : req.user.id;

    let rows = [];
    if (scope === "vendor") {
      rows = db.prepare(`
        SELECT p.id AS product_id,
               p.name AS product_name,
               p.category,
               p.price,
               p.stock,
               COALESCE(SUM(s.quantity), 0) AS units_sold,
               COALESCE(SUM(s.amount), 0) AS revenue,
               v.business_name AS vendor
        FROM products p
        JOIN vendors v ON p.vendor_id = v.id
        LEFT JOIN sales s ON s.product_id = p.id AND s.vendor_id = p.vendor_id
        WHERE p.vendor_id = ?
        GROUP BY p.id
        ORDER BY units_sold DESC, revenue DESC
      `).all(vendorId);
    } else {
      rows = db.prepare(`
        SELECT p.product_id,
               p.product_name,
               p.category,
               p.price,
               p.stock,
               COALESCE(SUM(oi.quantity), 0) AS units_sold,
               COALESCE(SUM(oi.quantity * oi.unit_price), 0) AS revenue,
               'ShopSense Marketplace' AS vendor
        FROM analytics_products p
        LEFT JOIN analytics_order_items oi ON oi.product_id = p.product_id
        GROUP BY p.product_id
        ORDER BY units_sold DESC, revenue DESC
        LIMIT 5000
      `).all();
    }

    const headers = ["ProductID", "Name", "Category", "Price", "Stock", "UnitsSold", "Revenue", "Vendor"];
    const csvLines = [headers.join(",")];

    rows.forEach((row) => {
      const line = [
        escapeCsvField(row.product_id),
        escapeCsvField(row.product_name),
        escapeCsvField(row.category),
        row.price !== undefined ? Number(row.price).toFixed(2) : "0.00",
        row.stock !== undefined ? row.stock : 0,
        row.units_sold !== undefined ? row.units_sold : 0,
        row.revenue !== undefined ? Number(row.revenue).toFixed(2) : "0.00",
        escapeCsvField(row.vendor)
      ];
      csvLines.push(line.join(","));
    });

    const csvContent = csvLines.join("\r\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="products_report.csv"');
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.send(csvContent);
  } catch (error) {
    console.error("Products CSV export error:", error);
    res.status(500).json({ error: "Failed to generate products CSV export." });
  }
});

module.exports = router;


const http = require("http");
const { signToken } = require("./middleware/auth");

// Import the app without listen
const express = require("express");
const cors = require("cors");
const path = require("path");
require("./db");

const authRoutes = require("./routes/auth");
const vendorRoutes = require("./routes/vendor");
const adminRoutes = require("./routes/admin");
const analyticsRoutes = require("./routes/analytics");

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/vendor", vendorRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/analytics", analyticsRoutes);

const server = app.listen(0, async () => {
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`Test server running on ${baseUrl}`);

  const vendor1Token = signToken({ id: 1, email: "vendor@demo.com", role: "vendor", name: "Demo Vendor" });
  const vendor2Token = signToken({ id: 2, email: "amulya@gmail.com", role: "vendor", name: "Amulya" });
  const adminToken = signToken({ id: 1, email: "admin@demo.com", role: "admin", name: "System Admin" });

  let passed = 0;
  let failed = 0;

  async function testEndpoint(name, url, token, validator) {
    try {
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      const contentType = res.headers.get("content-type") || "";
      let data;
      if (contentType.includes("text/csv")) {
        data = await res.text();
      } else {
        data = await res.json();
      }
      const err = validator(res.status, data, res.headers);
      if (err) {
        console.error(`❌ [FAIL] ${name}: ${err}`);
        failed++;
      } else {
        console.log(`✅ [PASS] ${name}`);
        passed++;
      }
    } catch (e) {
      console.error(`❌ [FAIL] ${name} threw exception:`, e.message);
      failed++;
    }
  }

  console.log("\n--- Testing Milestone 3 Reporting APIs ---");
  
  await testEndpoint(
    "GET /api/analytics/reporting/sales-over-time (Marketplace 30d)",
    `${baseUrl}/api/analytics/reporting/sales-over-time?timeframe=30d&scope=marketplace`,
    vendor1Token,
    (status, data) => {
      if (status !== 200) return `Expected 200, got ${status}`;
      if (!data.summary || typeof data.summary.totalRevenue !== "number") return "Missing summary.totalRevenue";
      if (!Array.isArray(data.data) || data.data.length === 0) return "Missing or empty data array";
      if (typeof data.data[0].revenue !== "number") return "data[0].revenue is not a number";
    }
  );

  await testEndpoint(
    "GET /api/analytics/reporting/sales-over-time (Vendor 30d)",
    `${baseUrl}/api/analytics/reporting/sales-over-time?timeframe=30d&scope=vendor`,
    vendor1Token,
    (status, data) => {
      if (status !== 200) return `Expected 200, got ${status}`;
      if (data.scope !== "vendor") return "Expected scope=vendor";
      if (!data.summary || typeof data.summary.totalRevenue !== "number") return "Missing summary";
      if (!Array.isArray(data.data)) return "Missing data array";
    }
  );

  await testEndpoint(
    "GET /api/analytics/reporting/sales-over-time (Month timeframe)",
    `${baseUrl}/api/analytics/reporting/sales-over-time?timeframe=month&scope=marketplace`,
    vendor1Token,
    (status, data) => {
      if (status !== 200) return `Expected 200, got ${status}`;
      if (!Array.isArray(data.data) || data.data.length === 0) return "Expected month array";
    }
  );

  await testEndpoint(
    "GET /api/analytics/reporting/category-performance (Marketplace)",
    `${baseUrl}/api/analytics/reporting/category-performance?scope=marketplace`,
    vendor1Token,
    (status, data) => {
      if (status !== 200) return `Expected 200, got ${status}`;
      if (!Array.isArray(data.categories) || data.categories.length === 0) return "Expected categories array";
      if (typeof data.categories[0].revenueSharePct !== "number") return "Missing revenueSharePct";
    }
  );

  await testEndpoint(
    "GET /api/analytics/reporting/category-performance (Vendor)",
    `${baseUrl}/api/analytics/reporting/category-performance?scope=vendor`,
    vendor1Token,
    (status, data) => {
      if (status !== 200) return `Expected 200, got ${status}`;
      if (data.scope !== "vendor") return "Expected scope=vendor";
      if (!Array.isArray(data.categories)) return "Expected categories array";
    }
  );

  await testEndpoint(
    "GET /api/analytics/reporting/top-products (Marketplace limit=5)",
    `${baseUrl}/api/analytics/reporting/top-products?limit=5&scope=marketplace`,
    vendor1Token,
    (status, data) => {
      if (status !== 200) return `Expected 200, got ${status}`;
      if (!Array.isArray(data.products) || data.products.length !== 5) return `Expected 5 products, got ${data.products?.length}`;
      if (!data.products[0].product_name) return "Missing product_name";
    }
  );

  await testEndpoint(
    "GET /api/analytics/reporting/top-products (Vendor)",
    `${baseUrl}/api/analytics/reporting/top-products?limit=5&scope=vendor`,
    vendor1Token,
    (status, data) => {
      if (status !== 200) return `Expected 200, got ${status}`;
      if (!Array.isArray(data.products)) return "Expected products array";
    }
  );

  await testEndpoint(
    "GET /api/analytics/reporting/summary (Marketplace)",
    `${baseUrl}/api/analytics/reporting/summary?scope=marketplace`,
    vendor1Token,
    (status, data) => {
      if (status !== 200) return `Expected 200, got ${status}`;
      if (typeof data.totalRevenue !== "number") return "Missing totalRevenue";
      if (typeof data.averageOrderValue !== "number") return "Missing averageOrderValue";
      if (!data.topCategory) return "Missing topCategory";
      if (!data.topProduct) return "Missing topProduct";
    }
  );

  await testEndpoint(
    "GET /api/analytics/reporting/summary (Vendor)",
    `${baseUrl}/api/analytics/reporting/summary?scope=vendor`,
    vendor1Token,
    (status, data) => {
      if (status !== 200) return `Expected 200, got ${status}`;
      if (typeof data.totalRevenue !== "number") return "Missing totalRevenue";
      if (typeof data.totalOrders !== "number") return "Missing totalOrders";
    }
  );

  console.log("\n--- Testing Milestone 3 Benchmarking API ---");

  await testEndpoint(
    "GET /api/analytics/benchmark (Vendor 1)",
    `${baseUrl}/api/analytics/benchmark`,
    vendor1Token,
    (status, data) => {
      if (status !== 200) return `Expected 200, got ${status}`;
      if (!data.vendor || data.vendor.id !== 1) return `Expected vendor.id=1, got ${data.vendor?.id}`;
      if (!data.benchmarks) return "Missing benchmarks object";
      const { revenue, orders, unitsSold, productCount } = data.benchmarks;
      if (!revenue || typeof revenue.percentageDifference !== "number") return "Missing revenue benchmark";
      if (!orders || typeof orders.percentageDifference !== "number") return "Missing orders benchmark";
      if (!unitsSold || typeof unitsSold.percentageDifference !== "number") return "Missing unitsSold benchmark";
      if (!productCount || typeof productCount.percentageDifference !== "number") return "Missing productCount benchmark";
      if (!Array.isArray(data.insights)) return "Missing insights array";
      console.log(`   Benchmark Summary for Vendor 1: Revenue diff = ${revenue.formattedDiff}, Orders diff = ${orders.formattedDiff}, Overall = ${data.overallPerformance}`);
    }
  );

  await testEndpoint(
    "GET /api/analytics/benchmark (Vendor 2 Isolation Check)",
    `${baseUrl}/api/analytics/benchmark`,
    vendor2Token,
    (status, data) => {
      if (status !== 200) return `Expected 200, got ${status}`;
      if (!data.vendor || data.vendor.id !== 2) return `Expected vendor.id=2, got ${data.vendor?.id}`;
      console.log(`   Benchmark Summary for Vendor 2: Revenue diff = ${data.benchmarks.revenue.formattedDiff}, Orders diff = ${data.benchmarks.orders.formattedDiff}`);
    }
  );

  console.log("\n--- Testing Milestone 3 CSV Export APIs ---");

  await testEndpoint(
    "GET /api/analytics/export/sales (CSV headers & content)",
    `${baseUrl}/api/analytics/export/sales`,
    vendor1Token,
    (status, data, headers) => {
      if (status !== 200) return `Expected 200, got ${status}`;
      const disposition = headers.get("content-disposition") || "";
      if (!disposition.includes('filename="sales_report.csv"')) return `Invalid Content-Disposition: ${disposition}`;
      const lines = data.trim().split("\r\n");
      if (lines.length < 2) return `Expected CSV header + at least 1 row, got ${lines.length} lines`;
      if (!lines[0].includes("Date,Product,Category,Quantity,Price,Revenue,Vendor")) {
        return `Unexpected CSV header: ${lines[0]}`;
      }
      console.log(`   Sales CSV exported with ${lines.length - 1} records. Header: ${lines[0]}`);
    }
  );

  await testEndpoint(
    "GET /api/analytics/export/products (CSV headers & content)",
    `${baseUrl}/api/analytics/export/products`,
    vendor1Token,
    (status, data, headers) => {
      if (status !== 200) return `Expected 200, got ${status}`;
      const disposition = headers.get("content-disposition") || "";
      if (!disposition.includes('filename="products_report.csv"')) return `Invalid Content-Disposition: ${disposition}`;
      const lines = data.trim().split("\r\n");
      if (lines.length < 2) return `Expected CSV header + at least 1 row, got ${lines.length} lines`;
      if (!lines[0].includes("ProductID,Name,Category,Price,Stock,UnitsSold,Revenue,Vendor")) {
        return `Unexpected CSV header: ${lines[0]}`;
      }
      console.log(`   Products CSV exported with ${lines.length - 1} records. Header: ${lines[0]}`);
    }
  );

  console.log("\n--- Testing Security & Error Handling ---");

  await testEndpoint(
    "GET /api/analytics/benchmark without token (401 Unauthorized)",
    `${baseUrl}/api/analytics/benchmark`,
    null,
    (status) => {
      if (status !== 401) return `Expected 401, got ${status}`;
    }
  );

  await testEndpoint(
    "GET /api/analytics/export/sales with invalid token (401 Unauthorized)",
    `${baseUrl}/api/analytics/export/sales`,
    "invalid_jwt_token_12345",
    (status) => {
      if (status !== 401) return `Expected 401, got ${status}`;
    }
  );

  server.close(() => {
    console.log(`\n========================================`);
    console.log(`Total tests passed: ${passed}`);
    console.log(`Total tests failed: ${failed}`);
    console.log(`========================================\n`);
    process.exit(failed > 0 ? 1 : 0);
  });
});

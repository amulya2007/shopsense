const http = require("http");
const express = require("express");
const db = require("./db");
const { signToken } = require("./middleware/auth");

const authRoutes = require("./routes/auth");
const vendorRoutes = require("./routes/vendor");
const adminRoutes = require("./routes/admin");
const analyticsRoutes = require("./routes/analytics");
const aiRoutes = require("./routes/ai");

const app = express();
app.use(express.json());
app.use("/api/auth", authRoutes);
app.use("/api/vendor", vendorRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/ai", aiRoutes);

let server;
let baseUrl;

function makeRequest(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
    };

    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch {
          json = data;
        }
        resolve({ status: res.statusCode, headers: res.headers, data: json });
      });
    });

    req.on("error", reject);
    if (body) {
      req.write(typeof body === "string" ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  server = app.listen(0);
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
  console.log(`Test server running on ${baseUrl}\n`);

  let passed = 0;
  let failed = 0;

  function assert(condition, name, details = "") {
    if (condition) {
      console.log(`✅ [PASS] ${name}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${name} ${details ? `\n   Details: ${details}` : ""}`);
      failed++;
    }
  }

  try {
    const vendor1 = db.prepare("SELECT * FROM vendors WHERE email = 'vendor@demo.com'").get();
    const token = signToken({ id: vendor1.id, role: "vendor", email: vendor1.email, name: vendor1.full_name });
    const authHeaders = { Authorization: `Bearer ${token}` };

    console.log("--- Testing AI RAG Status & Vector Index ---");
    const statusRes = await makeRequest("GET", "/api/ai/status");
    assert(statusRes.status === 200, "GET /api/ai/status returns 200");
    assert(statusRes.data.vectorStoreReady === true, "Vector store is initialized and ready");
    assert(statusRes.data.indexedProducts >= 10000, `Indexed products count >= 10000 (actual: ${statusRes.data.indexedProducts})`);

    console.log("\n--- Testing RAG AI Shopping Assistant Queries ---");

    // 1. Electronics question
    const q1 = await makeRequest("POST", "/api/ai/shopping-assistant", {
      question: "What products are available in Electronics?"
    });
    assert(q1.status === 200, "Query: 'What products are available in Electronics?' returns 200");
    assert(typeof q1.data.answer === "string" && q1.data.answer.length > 20, "Returns grounded text answer");
    assert(Array.isArray(q1.data.products) && q1.data.products.length > 0, "Returns retrieved product list");
    assert(Array.isArray(q1.data.sources) && q1.data.sources.length === q1.data.products.length, "Returns transparent source citations");
    console.log(`   Sample response snippet: "${q1.data.answer.slice(0, 100)}..."`);
    console.log(`   Retrieved products: ${q1.data.products.map(p => p.name).join(", ")}`);

    // 2. Budget constraint question
    const q2 = await makeRequest("POST", "/api/ai/shopping-assistant", {
      question: "Show me products under 50000"
    });
    assert(q2.status === 200, "Query: 'Show me products under 50000' returns 200");
    const allUnder50k = q2.data.products.every(p => p.price <= 50000);
    assert(allUnder50k, "All retrieved products adhere to price <= 50000");

    // 3. Laptop / Video editing question
    const q3 = await makeRequest("POST", "/api/ai/shopping-assistant", {
      question: "Which laptop is suitable for video editing?"
    });
    assert(q3.status === 200, "Query: 'Which laptop is suitable for video editing?' returns 200");
    assert(q3.data.products.length > 0, "Retrieved relevant laptop/computing products");

    // 4. In stock question
    const q4 = await makeRequest("POST", "/api/ai/shopping-assistant", {
      question: "Which products are currently in stock?"
    });
    assert(q4.status === 200, "Query: 'Which products are currently in stock?' returns 200");
    const allInStock = q4.data.products.every(p => p.stock > 0);
    assert(allInStock, "All retrieved products are in stock (stock > 0)");

    // 5. Cheapest product query
    const q5 = await makeRequest("POST", "/api/ai/shopping-assistant", {
      question: "What is the cheapest product in Audio?"
    });
    assert(q5.status === 200, "Query: 'What is the cheapest product in Audio?' returns 200");
    assert(q5.data.products.length > 0, "Retrieved lowest price audio options");

    // 6. Validation on empty question
    const qErr = await makeRequest("POST", "/api/ai/shopping-assistant", {
      question: ""
    });
    assert(qErr.status === 400, "POST /api/ai/shopping-assistant with empty question returns 400 Bad Request");

    console.log("\n--- Verifying Existing Reporting, Benchmarking, CSV & Analytics APIs ---");
    const salesOverTime = await makeRequest("GET", "/api/analytics/reporting/sales-over-time", null, authHeaders);
    assert(salesOverTime.status === 200, "GET /api/analytics/reporting/sales-over-time is functional");

    const benchmark = await makeRequest("GET", "/api/analytics/benchmark", null, authHeaders);
    assert(benchmark.status === 200, "GET /api/analytics/benchmark is functional");

    const exportSales = await makeRequest("GET", "/api/analytics/export/sales", null, authHeaders);
    assert(exportSales.status === 200 && exportSales.headers["content-type"].includes("text/csv"), "GET /api/analytics/export/sales is functional");

    const inventory = await makeRequest("GET", "/api/analytics/inventory", null, authHeaders);
    assert(inventory.status === 200, "GET /api/analytics/inventory is functional");

    const customers = await makeRequest("GET", "/api/analytics/customers", null, authHeaders);
    assert(customers.status === 200, "GET /api/analytics/customers is functional");

    console.log("\n========================================");
    console.log(`Total tests passed: ${passed}`);
    console.log(`Total tests failed: ${failed}`);
    console.log("========================================");
  } catch (err) {
    console.error("Test runner error:", err);
  } finally {
    if (server) server.close();
  }
}

runTests();

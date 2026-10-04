const db = require("../db");
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const ragService = require("./ragService");

const demoVendorId = db
  .prepare("SELECT vendor_id FROM products WHERE name = ?")
  .get("Smart Fitness Band")?.vendor_id;
const otherVendorId = db
  .prepare("SELECT id FROM vendors WHERE id != ? ORDER BY id LIMIT 1")
  .get(demoVendorId)?.id;

describe("RAG shopping question retrieval", () => {
  it("recognizes fitness as Sports products and fitness-specific products", () => {
    const { products } = ragService.retrieveProducts(
      "What fitness products do you have?",
      6,
      "",
      demoVendorId
    );
    const names = products.map((product) => product.name);

    assert.ok(names.includes("Flex Yoga Mat"));
    assert.ok(names.includes("Neoprene Dumbbell Pair"));
    assert.ok(names.includes("Smart Fitness Band"));
  });

  it("applies price limits expressed with rupees and comma separators", () => {
    const { products } = ragService.retrieveProducts(
      "Show me products under ₹1,000",
      6,
      "",
      demoVendorId
    );

    assert.ok(products.length > 0);
    assert.ok(products.every((product) => product.price <= 1000));
  });

  it("applies hyphenated stock filters together with price limits", () => {
    const { products } = ragService.retrieveProducts(
      "Show out-of-stock products under ₹200,000",
      6,
      "",
      demoVendorId
    );

    assert.ok(products.length > 0);
    assert.ok(products.every((product) => product.stock === 0 && product.price <= 200000));
  });

  it("does not return a laptop backpack for a laptop query", () => {
    const { products } = ragService.retrieveProducts(
      "Do you have a laptop?",
      6,
      "",
      demoVendorId
    );

    assert.ok(!products.some((product) => product.name === "Everyday Laptop Backpack"));
  });

  it("ranks highest-priced products for common ranking phrasing", () => {
    const expected = db
      .prepare("SELECT id FROM products WHERE vendor_id = ? ORDER BY price DESC, id ASC LIMIT 1")
      .get(demoVendorId);
    const { products } = ragService.retrieveProducts(
      "Which is the highest priced product?",
      1,
      "",
      demoVendorId
    );

    assert.equal(products.length, 1);
    assert.equal(products[0].id, String(expected.id));
  });

  it("keeps price-range results inside both bounds", () => {
    const { products } = ragService.retrieveProducts(
      "Find products between ₹1,000 and ₹2,000",
      6,
      "",
      demoVendorId
    );

    assert.ok(products.length > 0);
    assert.ok(products.every((product) => product.price >= 1000 && product.price <= 2000));
  });

  it("understands category and use-case paraphrases without confusing home gym with home products", () => {
    const workoutProducts = ragService.retrieveProducts(
      "Got anything for my workout?",
      20,
      "",
      demoVendorId
    ).products;
    const kitchenProducts = ragService.retrieveProducts(
      "Any kitchenware available?",
      20,
      "",
      demoVendorId
    ).products;
    const skincareProducts = ragService.retrieveProducts(
      "Show skincare items",
      20,
      "",
      demoVendorId
    ).products;

    assert.ok(workoutProducts.some((product) => product.name === "Flex Yoga Mat"));
    assert.ok(workoutProducts.some((product) => product.name === "Neoprene Dumbbell Pair"));
    assert.ok(!workoutProducts.some((product) =>
      ["Bamboo Cutting Board", "Ceramic Coffee Mug Set", "Modern LED Desk Lamp"].includes(product.name)
    ));
    assert.ok(kitchenProducts.length > 0);
    assert.ok(kitchenProducts.every((product) => product.category === "Home & Kitchen"));
    assert.ok(skincareProducts.length > 0);
    assert.ok(skincareProducts.every((product) => product.category === "Beauty"));
  });

  it("parses shorthand price amounts and applies them as hard limits", () => {
    const { products } = ragService.retrieveProducts(
      "Find something below Rs 1.5k",
      20,
      "",
      demoVendorId
    );

    assert.ok(products.length > 0);
    assert.ok(products.every((product) => product.price <= 1500));
  });

  it("orders inventory queries using actual stock values", () => {
    const expected = db
      .prepare("SELECT id FROM products WHERE vendor_id = ? ORDER BY stock ASC, price ASC LIMIT 1")
      .get(demoVendorId);
    const { products } = ragService.retrieveProducts(
      "Which item has the least stock?",
      1,
      "",
      demoVendorId
    );

    assert.equal(products.length, 1);
    assert.equal(products[0].id, String(expected.id));
  });

  it("answers product-count questions with the exact vendor-scoped count", async () => {
    const expected = db
      .prepare("SELECT COUNT(*) AS count FROM products WHERE vendor_id = ?")
      .get(demoVendorId).count;
    const result = await ragService.answerShoppingQuestion(
      "How many products do I have?",
      [],
      demoVendorId
    );

    assert.match(result.answer, new RegExp(`\\b${expected} matching products?\\b`));
  });

  it("uses a configured Gemini provider to synthesize an answer from retrieved vendor products", async () => {
    const originalFetch = global.fetch;
    const originalGeminiKey = process.env.GEMINI_API_KEY;
    const originalOpenAiKey = process.env.OPENAI_API_KEY;
    let requestUrl;
    let requestBody;
    process.env.GEMINI_API_KEY = "test-gemini-key";
    delete process.env.OPENAI_API_KEY;
    global.fetch = async (url, options) => {
      requestUrl = String(url);
      requestBody = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: "These fitness items are in your catalog." }] } }]
        })
      };
    };

    try {
      const result = await ragService.answerShoppingQuestion(
        "What fitness products do you have?",
        [],
        demoVendorId
      );

      assert.equal(result.answer, "These fitness items are in your catalog.");
      assert.match(requestUrl, /models\/gemini-2\.5-flash:generateContent/);
      assert.ok(requestBody.contents[0].parts[0].text.includes("Flex Yoga Mat"));
      assert.equal(ragService.getLlmProvider(), "Gemini");
    } finally {
      global.fetch = originalFetch;
      if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = originalGeminiKey;
      if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = originalOpenAiKey;
    }
  });

  it("falls back from a failed Gemini request to OpenAI", async () => {
    const originalFetch = global.fetch;
    const originalGeminiKey = process.env.GEMINI_API_KEY;
    const originalOpenAiKey = process.env.OPENAI_API_KEY;
    const requestUrls = [];
    process.env.GEMINI_API_KEY = "test-gemini-key";
    process.env.OPENAI_API_KEY = "test-openai-key";
    global.fetch = async (url) => {
      requestUrls.push(String(url));
      if (String(url).includes("generativelanguage.googleapis.com")) {
        return { ok: false, status: 503 };
      }
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "Here are the matching catalog items." } }]
        })
      };
    };

    try {
      const result = await ragService.answerShoppingQuestion(
        "What fitness products do you have?",
        [],
        demoVendorId
      );

      assert.equal(result.answer, "Here are the matching catalog items.");
      assert.equal(requestUrls.length, 2);
      assert.ok(requestUrls[1].includes("api.openai.com/v1/chat/completions"));
    } finally {
      global.fetch = originalFetch;
      if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = originalGeminiKey;
      if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = originalOpenAiKey;
    }
  });

  it("only reports low-stock items with positive stock within the alert threshold", () => {
    const { products } = ragService.retrieveProducts(
      "What is almost out of stock?",
      20,
      "",
      demoVendorId
    );

    assert.ok(products.length > 0);
    assert.ok(products.every((product) => product.stock > 0 && product.stock <= 5));
  });

  it("requires a vendor scope instead of searching a shared catalog", () => {
    assert.throws(
      () => ragService.retrieveProducts("Show me products", 6),
      /valid vendor ID is required/i
    );
  });

  it("never retrieves another vendor's products", () => {
    assert.ok(otherVendorId, "the test database must contain a second vendor");
    const { products } = ragService.retrieveProducts(
      "Show me products",
      20,
      "",
      otherVendorId
    );

    assert.ok(products.every((product) => product.vendorId === otherVendorId));
    assert.ok(!products.some((product) => product.vendorId === demoVendorId));
  });

  it("keeps two populated vendor indexes isolated", () => {
    assert.ok(otherVendorId, "the test database must contain a second vendor");
    const sentinelName = "RAG Isolation Sentinel Camera";
    const savepoint = "rag_vendor_isolation_test";

    db.exec(`SAVEPOINT ${savepoint}`);
    try {
      const inserted = db.prepare(`
        INSERT INTO products (vendor_id, name, category, price, stock)
        VALUES (?, ?, 'Electronics', 1234, 5)
      `).run(otherVendorId, sentinelName);
      ragService.buildVectorStore(otherVendorId);

      const otherVendorProducts = ragService.retrieveProducts(
        sentinelName,
        6,
        "",
        otherVendorId
      ).products;
      const currentVendorProducts = ragService.retrieveProducts(
        sentinelName,
        6,
        "",
        demoVendorId
      ).products;

      assert.ok(otherVendorProducts.some((product) => product.id === String(inserted.lastInsertRowid)));
      assert.ok(currentVendorProducts.every((product) => product.id !== String(inserted.lastInsertRowid)));
    } finally {
      db.exec(`ROLLBACK TO ${savepoint}`);
      db.exec(`RELEASE ${savepoint}`);
      ragService.buildVectorStore(otherVendorId);
    }
  });

  it("keeps vendor vector-store counts separate", () => {
    assert.ok(otherVendorId, "the test database must contain a second vendor");
    const ownCount = db
      .prepare("SELECT COUNT(*) AS count FROM products WHERE vendor_id = ?")
      .get(demoVendorId).count;
    const otherCount = db
      .prepare("SELECT COUNT(*) AS count FROM products WHERE vendor_id = ?")
      .get(otherVendorId).count;

    assert.equal(ragService.getVectorStoreCount(demoVendorId), ownCount);
    assert.equal(ragService.getVectorStoreCount(otherVendorId), otherCount);
  });
});

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

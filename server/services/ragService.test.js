const db = require("../db");
const ragService = require("./ragService");

const demoVendorId = db
  .prepare("SELECT vendor_id FROM products WHERE name = ?")
  .get("Smart Fitness Band")?.vendor_id;

describe("RAG shopping question retrieval", () => {
  test("recognizes fitness as Sports products and fitness-specific products", () => {
    const { products } = ragService.retrieveProducts(
      "What fitness products do you have?",
      6,
      "",
      demoVendorId
    );
    const names = products.map((product) => product.name);

    expect(names).toContain("Flex Yoga Mat");
    expect(names).toContain("Neoprene Dumbbell Pair");
    expect(names).toContain("Smart Fitness Band");
  });

  test("applies price limits expressed with rupees and comma separators", () => {
    const { products } = ragService.retrieveProducts(
      "Show me products under ₹1,000",
      6,
      "",
      demoVendorId
    );

    expect(products.length).toBeGreaterThan(0);
    expect(products.every((product) => product.price <= 1000)).toBe(true);
  });

  test("applies hyphenated stock filters together with price limits", () => {
    const { products } = ragService.retrieveProducts(
      "Show out-of-stock products under ₹200,000",
      6,
      "",
      demoVendorId
    );

    expect(products.length).toBeGreaterThan(0);
    expect(products.every((product) => product.stock === 0 && product.price <= 200000)).toBe(true);
  });

  test("does not return a laptop backpack for a laptop query", () => {
    const { products } = ragService.retrieveProducts(
      "Do you have a laptop?",
      6,
      "",
      demoVendorId
    );

    expect(products.map((product) => product.name)).not.toContain("Everyday Laptop Backpack");
  });

  test("ranks highest-priced products for common ranking phrasing", () => {
    const expected = db
      .prepare("SELECT id FROM products WHERE vendor_id = ? ORDER BY price DESC, id ASC LIMIT 1")
      .get(demoVendorId);
    const { products } = ragService.retrieveProducts(
      "Which is the highest priced product?",
      1,
      "",
      demoVendorId
    );

    expect(products).toHaveLength(1);
    expect(products[0].id).toBe(String(expected.id));
  });

  test("keeps price-range results inside both bounds", () => {
    const { products } = ragService.retrieveProducts(
      "Find products between ₹1,000 and ₹2,000",
      6,
      "",
      demoVendorId
    );

    expect(products.length).toBeGreaterThan(0);
    expect(products.every((product) => product.price >= 1000 && product.price <= 2000)).toBe(true);
  });
});

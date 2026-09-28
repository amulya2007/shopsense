const express = require("express");
const router = express.Router();
const ragService = require("../services/ragService");
const { requireAuth } = require("../middleware/auth");

/**
 * POST /api/ai/generate-description
 * Generate a professional product description from name + category.
 * Requires vendor or admin JWT — API keys stay on the server.
 *
 * Body: { "name": string, "category": string, "hints": optional string }
 * Response: { "description": string, "provider": string }
 */
router.post("/generate-description", requireAuth(["vendor", "admin"]), async (req, res) => {
  try {
    const { name, category, hints } = req.body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "Product name is required." });
    }
    if (!category || typeof category !== "string" || !category.trim()) {
      return res.status(400).json({ error: "Product category is required." });
    }
    if (name.trim().length > 200) {
      return res.status(400).json({ error: "Product name is too long (max 200 characters)." });
    }

    const safeHints = hints && typeof hints === "string" ? hints.trim().slice(0, 300) : "";

    const description = await ragService.generateProductDescription(
      name.trim(),
      category.trim(),
      safeHints
    );

    // Report which provider was actually used
    const geminiKey = process.env.GEMINI_API_KEY || process.env.LLM_API_KEY;
    const openAiKey = process.env.OPENAI_API_KEY;
    const hasGemini = Boolean(geminiKey && geminiKey !== "your_key_here");
    const hasOpenAI = Boolean(openAiKey && openAiKey !== "your_key_here");
    const provider  = hasGemini ? "ShopSense AI" : hasOpenAI ? "OpenAI" : "Local";

    res.json({ description, provider });
  } catch (error) {
    console.error("Description generation error:", error);
    res.status(500).json({
      error: "Failed to generate description. You can write it manually."
    });
  }
});

router.post("/generate-seo-content", requireAuth(["vendor", "admin"]), async (req, res) => {
  try {
    const { name, category, hints } = req.body;
    if (typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "Product name is required." });
    }
    if (typeof category !== "string" || !category.trim()) {
      return res.status(400).json({ error: "Product category is required." });
    }
    if (name.trim().length > 200 || category.trim().length > 100) {
      return res.status(400).json({ error: "Product name or category is too long." });
    }
    if (hints !== undefined && typeof hints !== "string") {
      return res.status(400).json({ error: "Product hints must be text." });
    }

    const result = await ragService.generateSeoContent(
      name.trim(),
      category.trim(),
      typeof hints === "string" ? hints.trim().slice(0, 1000) : ""
    );
    return res.json(result);
  } catch (error) {
    console.error("SEO content generation error:", error);
    return res.status(500).json({
      error: "Failed to generate SEO content. Please try again or complete the fields manually."
    });
  }
});

/**
 * POST /api/ai/shopping-assistant
 * RAG-powered shopping assistant endpoint.
 *
 * Body:
 *   { "question": string, "conversationHistory": optional array }
 *
 * Vendor requests are always scoped to the vendor ID in the JWT. Admins may
 * provide a vendorId explicitly when inspecting a vendor's catalog.
 *
 * conversationHistory format (lightweight, last 2–4 turns is sufficient):
 *   [
 *     { "role": "assistant", "products": [{ "name": "...", "category": "..." }] }
 *   ]
 */
router.post("/shopping-assistant", requireAuth(["vendor", "admin"]), async (req, res) => {
  try {
    const { question, conversationHistory } = req.body;

    if (!question || typeof question !== "string" || !question.trim()) {
      return res.status(400).json({
        error: "Please provide a valid question in the request body."
      });
    }

    if (question.trim().length > 500) {
      return res.status(400).json({
        error: "Question is too long. Please keep it under 500 characters."
      });
    }

    // Accept optional conversation history for follow-up context
    const history = Array.isArray(conversationHistory) ? conversationHistory.slice(-4) : [];

    // Never trust a browser-supplied vendor ID for vendor accounts. The vendor
    // ID is the authenticated vendor's primary key in the signed JWT.
    let vendorId;
    if (req.user.role === "vendor") {
      vendorId = Number(req.user.id);
    } else {
      const requestedVendorId = req.body.vendorId;
      vendorId = Number(requestedVendorId);
      if (!Number.isInteger(vendorId) || vendorId <= 0) {
        return res.status(400).json({
          error: "vendorId is required when an administrator uses the shopping assistant."
        });
      }
    }

    const result = await ragService.answerShoppingQuestion(question, history, vendorId);

    // ONLY show live catalog products (products that exist in vendor's actual catalog)
    // Dataset products are NOT shown as they can't be viewed/purchased
    const liveProducts = result.products.filter(
      p => p.origin === "live_catalog" && p.vendorId === vendorId
    );
    const liveProductIds = new Set(liveProducts.map((product) => String(product.id)));
    const answer = liveProducts.length === 0 &&
      ragService.getVendorProductCount(vendorId) === 0
      ? "Your vendor catalog currently has no products available."
      : result.answer;
    
    res.json({
      answer,
      products: liveProducts.slice(0, 6), // Show only catalog products
      sources: result.sources.filter((source) => liveProductIds.has(String(source.productId)))
    });
  } catch (error) {
    console.error("AI Shopping Assistant error:", error);
    res.status(500).json({
      error: error.message || "Failed to process shopping assistant request."
    });
  }
});

/**
 * GET /api/ai/status
 * Authenticated vendor-scoped vector index status
 */
router.get("/status", requireAuth(["vendor", "admin"]), (req, res) => {
  const vendorId = req.user.role === "vendor" ? Number(req.user.id) : null;
  const count = vendorId === null
    ? ragService.getVectorStoreCount()
    : ragService.getVectorStoreCount(vendorId);
  const hasGemini  = Boolean(process.env.GEMINI_API_KEY  && process.env.GEMINI_API_KEY  !== "your_key_here");
  const hasOpenAI  = Boolean(process.env.OPENAI_API_KEY  && process.env.OPENAI_API_KEY  !== "your_key_here");
  const hasLlmKey  = hasGemini || hasOpenAI ||
                     Boolean(process.env.LLM_API_KEY && process.env.LLM_API_KEY !== "your_key_here");

  const provider = hasGemini ? "ShopSense AI" : hasOpenAI ? "OpenAI" : "Grounded Catalog RAG (Local)";

  res.json({
    status:               "online",
    vectorStoreReady:     count > 0,
    indexedProducts:      count,
    llmProviderConfigured: hasLlmKey,
    provider
  });
});

/**
 * POST /api/ai/refresh-index
 * Rebuild each vendor's isolated vector index.
 * Restricted to administrators because this refreshes all vendor indexes.
 */
router.post("/refresh-index", requireAuth(["admin"]), (req, res) => {
  try {
    console.log("🔄 Manually refreshing RAG vector store...");
    const count = ragService.buildAllVectorStores();
    console.log(`✅ Vendor-scoped vector stores refreshed: ${count} products indexed`);
    res.json({
      success:        true,
      message:        `Vendor-scoped vector indexes successfully refreshed with ${count} products.`,
      indexedProducts: count
    });
  } catch (error) {
    console.error("❌ RAG refresh error:", error);
    res.status(500).json({
      error: "Failed to refresh vector index: " + error.message
    });
  }
});

// Simple public mock chat endpoint
router.get('/chat', (req, res) => {
  const query = String(req.query.q || '').trim();
  if (!query) return res.status(400).json({ error: 'Missing q query param' });
  res.json({ answer: `Mock response for "${query}"` });
});

module.exports = router;

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
    const provider  = hasGemini ? "Google Gemini" : hasOpenAI ? "OpenAI" : "Local";

    res.json({ description, provider });
  } catch (error) {
    console.error("Description generation error:", error);
    res.status(500).json({
      error: "Failed to generate description. You can write it manually."
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
 * conversationHistory format (lightweight, last 2–4 turns is sufficient):
 *   [
 *     { "role": "assistant", "products": [{ "name": "...", "category": "..." }] }
 *   ]
 */
router.post("/shopping-assistant", async (req, res) => {
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

    const result = await ragService.answerShoppingQuestion(question, history);

    // ONLY show live catalog products (products that exist in vendor's actual catalog)
    // Dataset products are NOT shown as they can't be viewed/purchased
    const liveProducts = result.products.filter(p => p.origin === "live_catalog");
    
    res.json({
      answer:   result.answer,
      products: liveProducts.slice(0, 6), // Show only catalog products
      sources:  result.sources
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
 * Health & vector index status
 */
router.get("/status", (req, res) => {
  const count = ragService.getVectorStoreCount();
  const hasGemini  = Boolean(process.env.GEMINI_API_KEY  && process.env.GEMINI_API_KEY  !== "your_key_here");
  const hasOpenAI  = Boolean(process.env.OPENAI_API_KEY  && process.env.OPENAI_API_KEY  !== "your_key_here");
  const hasLlmKey  = hasGemini || hasOpenAI ||
                     Boolean(process.env.LLM_API_KEY && process.env.LLM_API_KEY !== "your_key_here");

  const provider = hasGemini ? "Google Gemini" : hasOpenAI ? "OpenAI" : "Grounded Catalog RAG (Local)";

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
 * Rebuild the vector store from the SQLite database on demand.
 * PUBLIC endpoint - no auth required for development convenience
 */
router.post("/refresh-index", (req, res) => {
  try {
    console.log("🔄 Manually refreshing RAG vector store...");
    const count = ragService.buildVectorStore();
    console.log(`✅ Vector store refreshed: ${count} products indexed`);
    res.json({
      success:        true,
      message:        `Vector store index successfully refreshed with ${count} products.`,
      indexedProducts: count
    });
  } catch (error) {
    console.error("❌ RAG refresh error:", error);
    res.status(500).json({
      error: "Failed to refresh vector index: " + error.message
    });
  }
});

module.exports = router;

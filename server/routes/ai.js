const express = require("express");
const router = express.Router();
const ragService = require("../services/ragService");

/**
 * POST /api/ai/shopping-assistant
 * RAG-powered shopping assistant endpoint
 */
router.post("/shopping-assistant", async (req, res) => {
  try {
    const { question } = req.body;

    if (!question || typeof question !== "string" || !question.trim()) {
      return res.status(400).json({
        error: "Please provide a valid question in the request body."
      });
    }

    const result = await ragService.answerShoppingQuestion(question);

    res.json({
      answer: result.answer,
      products: result.products,
      sources: result.sources
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
 * Health & Vector Index status
 */
router.get("/status", (req, res) => {
  const count = ragService.getVectorStoreCount();
  const hasLlmKey = Boolean(
    (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== "your_key_here") ||
    (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== "your_key_here") ||
    (process.env.LLM_API_KEY && process.env.LLM_API_KEY !== "your_key_here")
  );

  res.json({
    status: "online",
    vectorStoreReady: count > 0,
    indexedProducts: count,
    llmProviderConfigured: hasLlmKey,
    provider: hasLlmKey ? (process.env.GEMINI_API_KEY ? "Google Gemini" : "OpenAI") : "Grounded Catalog RAG (Local)"
  });
});

/**
 * POST /api/ai/refresh-index
 * Rebuild / refresh the vector store from SQLite database
 */
router.post("/refresh-index", (req, res) => {
  try {
    const count = ragService.buildVectorStore();
    res.json({
      success: true,
      message: `Vector store index successfully refreshed with ${count} products.`,
      indexedProducts: count
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to refresh vector index: " + error.message
    });
  }
});

module.exports = router;

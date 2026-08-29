const express = require("express");
const router = express.Router();
const ragService = require("../services/ragService");

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

    res.json({
      answer:   result.answer,
      products: result.products,
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
 */
router.post("/refresh-index", (req, res) => {
  try {
    const count = ragService.buildVectorStore();
    res.json({
      success:        true,
      message:        `Vector store index successfully refreshed with ${count} products.`,
      indexedProducts: count
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to refresh vector index: " + error.message
    });
  }
});

module.exports = router;

const express = require("express");
const router = express.Router();
const ragService = require("../services/ragService");
const { requireAuth } = require("../middleware/auth");

async function forwardToPythonAi(req, res, route, body) {
  const baseUrl = (process.env.AI_SERVICE_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");
  try {
    const response = await fetch(`${baseUrl}${route}`, {
      method: req.method,
      headers: {
        Authorization: req.headers.authorization,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20000),
    });
    const result = await response.json();
    if (!response.ok) {
      const message = result.detail || result.error || "The Python AI service could not process the request.";
      return res.status(response.status).json({ error: message });
    }
    return res.json(result);
  } catch (error) {
    console.error("Python AI service request failed:", error);
    const isTimeout = error.name === "TimeoutError" || error.name === "AbortError";
    return res.status(isTimeout ? 504 : 503).json({
      error: isTimeout
        ? "The Python AI service timed out. Please try again."
        : "The Python AI service is unavailable. Start the FastAPI service and try again.",
    });
  }
}

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

    res.json({ description, provider: "Local (grounded)" });
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

    // Accept optional conversation history for follow-up context.
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

  return forwardToPythonAi(req, res, "/ai/shopping-assistant", {
    question: question.trim(),
    conversationHistory: history,
    vendorId,
  });
});

/**
 * GET /api/ai/status
 * Authenticated vendor-scoped vector index status
 */
router.get("/status", requireAuth(["vendor", "admin"]), (req, res) => {
  return forwardToPythonAi(req, res, "/ai/status");
});

/**
 * POST /api/ai/refresh-index
 * Rebuild each vendor's isolated vector index.
 * Restricted to administrators because this refreshes all vendor indexes.
 */
router.post("/refresh-index", requireAuth(["admin"]), (req, res) => {
  return forwardToPythonAi(req, res, "/ai/refresh-index", {});
});

// Simple public mock chat endpoint
router.get('/chat', (req, res) => {
  const query = String(req.query.q || '').trim();
  if (!query) return res.status(400).json({ error: 'Missing q query param' });
  res.json({ answer: `Mock response for "${query}"` });
});

module.exports = router;

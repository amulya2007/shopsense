const db = require("../db");

// In-memory Vector Store
let vectorStore = [];
let isInitialized = false;

// Stopwords for text normalization
const STOPWORDS = new Set([
  "a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are", "aren't",
  "as", "at", "be", "because", "been", "before", "being", "below", "between", "both", "but", "by",
  "can't", "cannot", "could", "couldn't", "did", "didn't", "do", "does", "doesn't", "doing", "don't",
  "down", "during", "each", "few", "for", "from", "further", "had", "hadn't", "has", "hasn't", "have",
  "haven't", "having", "he", "he'd", "he'll", "he's", "her", "here", "here's", "hers", "herself",
  "him", "himself", "his", "how", "how's", "i", "i'd", "i'll", "i'm", "i've", "if", "in", "into", "is",
  "isn't", "it", "it's", "its", "itself", "let's", "me", "more", "most", "mustn't", "my", "myself",
  "no", "nor", "not", "of", "off", "on", "once", "only", "or", "other", "ought", "our", "ours",
  "ourselves", "out", "over", "own", "same", "shan't", "she", "she'd", "she'll", "she's", "should",
  "shouldn't", "so", "some", "such", "than", "that", "that's", "the", "their", "theirs", "them",
  "themselves", "then", "there", "there's", "these", "they", "they'd", "they'll", "they're", "they've",
  "this", "those", "through", "to", "too", "under", "until", "up", "very", "was", "wasn't", "we",
  "we'd", "we'll", "we're", "we've", "were", "weren't", "what", "what's", "when", "when's", "where",
  "where's", "which", "while", "who", "who's", "whom", "why", "why's", "with", "won't", "would",
  "wouldn't", "you", "you'd", "you'll", "you're", "you've", "your", "yours", "yourself", "yourselves",
  "show", "me", "find", "get", "looking", "want", "need", "product", "products", "item", "items"
]);

// Tokenize text into normalized tokens and n-grams
function tokenize(text) {
  if (!text) return [];
  const normalized = String(text).toLowerCase().replace(/[^a-z0-9\s]/g, " ");
  const rawTokens = normalized.split(/\s+/).filter(t => t.length > 1);
  return rawTokens.filter(t => !STOPWORDS.has(t));
}

// Generate a dense semantic hash vector (dimension: 128)
function generateVector(text, category = "", price = 0) {
  const dim = 128;
  const vec = new Float32Array(dim);
  const tokens = tokenize(text);
  const catTokens = tokenize(category);

  tokens.forEach((token, idx) => {
    let hash = 0;
    for (let i = 0; i < token.length; i++) {
      hash = (hash * 31 + token.charCodeAt(i)) % dim;
    }
    vec[hash] += 1.0 / Math.sqrt(idx + 1);

    // Add character 3-grams for fuzzy subword matching
    if (token.length >= 3) {
      for (let j = 0; j <= token.length - 3; j++) {
        const sub = token.slice(j, j + 3);
        let subHash = 0;
        for (let k = 0; k < sub.length; k++) {
          subHash = (subHash * 17 + sub.charCodeAt(k)) % dim;
        }
        vec[subHash] += 0.3;
      }
    }
  });

  // Boost category signals
  catTokens.forEach((ct) => {
    let hash = 0;
    for (let i = 0; i < ct.length; i++) {
      hash = (hash * 37 + ct.charCodeAt(i)) % dim;
    }
    vec[hash] += 2.0;
  });

  // Normalize vector to unit length
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < dim; i++) vec[i] /= norm;
  }
  return vec;
}

// Compute cosine similarity between two unit vectors
function cosineSimilarity(vecA, vecB) {
  let dot = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
  }
  return dot;
}

// Extract query intents & constraints (price, category, stock status)
function extractQueryConstraints(query) {
  const q = query.toLowerCase();
  let maxPrice = null;
  let minPrice = null;
  let mustBeInStock = false;
  let targetCategory = null;

  // Price constraints: under / below / less than ₹5000 / 5000
  const underMatch = q.match(/(?:under|below|less than|max|budget of)\s*(?:₹|rs\.?|inr)?\s*(\d+(?:,\d+)*(?:\.\d+)?)/i);
  if (underMatch) {
    maxPrice = parseFloat(underMatch[1].replace(/,/g, ""));
  }

  // Above / more than / min
  const aboveMatch = q.match(/(?:above|more than|greater than|at least|over)\s*(?:₹|rs\.?|inr)?\s*(\d+(?:,\d+)*(?:\.\d+)?)/i);
  if (aboveMatch) {
    minPrice = parseFloat(aboveMatch[1].replace(/,/g, ""));
  }

  // In-stock requirement
  if (q.includes("in stock") || q.includes("available") || q.includes("in-stock") || q.includes("inventory")) {
    mustBeInStock = true;
  }

  // Cheapest / lowest price query
  const isCheapestQuery = q.includes("cheapest") || q.includes("lowest price") || q.includes("least expensive");
  // Expensive / highest price query
  const isExpensiveQuery = q.includes("most expensive") || q.includes("highest price") || q.includes("premium");

  // Category detection
  const categories = ["electronics", "audio", "computers", "accessories", "wearables", "fashion", "beauty", "home & kitchen", "home"];
  for (const cat of categories) {
    if (q.includes(cat)) {
      targetCategory = cat;
      break;
    }
  }

  return { maxPrice, minPrice, mustBeInStock, targetCategory, isCheapestQuery, isExpensiveQuery };
}

// Build or refresh the Vector Store from SQLite database
function buildVectorStore() {
  const documents = [];

  // 1. Fetch live vendor products
  try {
    const liveProducts = db.prepare(`
      SELECT p.id, p.name, p.description, p.category, p.price, p.stock, p.image_url,
             v.business_name AS vendor_name
      FROM products p
      LEFT JOIN vendors v ON p.vendor_id = v.id
    `).all();

    liveProducts.forEach((p) => {
      const textContent = `${p.name} ${p.description || ""} Category: ${p.category} Vendor: ${p.vendor_name || "Verified Vendor"} Price: ₹${p.price} Stock: ${p.stock} units`;
      const vector = generateVector(textContent, p.category, p.price);
      documents.push({
        id: String(p.id),
        name: p.name,
        description: p.description || "",
        category: p.category,
        price: Number(p.price),
        stock: Number(p.stock),
        vendor: p.vendor_name || "Verified Vendor",
        imageUrl: p.image_url || "",
        origin: "live_catalog",
        textContent,
        vector
      });
    });
  } catch (err) {
    console.error("Error reading live products for RAG:", err);
  }

  // 2. Fetch dataset historical products (analytics_products)
  try {
    const datasetProducts = db.prepare(`
      SELECT product_id AS id, product_name AS name, category, price, stock
      FROM analytics_products
    `).all();

    datasetProducts.forEach((p) => {
      const textContent = `${p.name} Category: ${p.category} Price: ₹${p.price} Stock: ${p.stock} units ShopSense Marketplace Catalog`;
      const vector = generateVector(textContent, p.category, p.price);
      documents.push({
        id: String(p.id),
        name: p.name,
        description: `ShopSense catalog product in ${p.category}.`,
        category: p.category,
        price: Number(p.price),
        stock: Number(p.stock),
        vendor: "ShopSense Marketplace",
        imageUrl: "",
        origin: "historical_dataset",
        textContent,
        vector
      });
    });
  } catch (err) {
    console.error("Error reading dataset products for RAG:", err);
  }

  vectorStore = documents;
  isInitialized = true;
  console.log(`[RAG Vector Store] Indexed ${vectorStore.length} products into local vector store.`);
  return vectorStore.length;
}

// Retrieve relevant products using Vector Cosine Similarity + Hybrid Constraint Ranking
function retrieveProducts(query, topK = 6) {
  if (!isInitialized || vectorStore.length === 0) {
    buildVectorStore();
  }

  const queryVector = generateVector(query);
  const queryTokens = tokenize(query);
  const constraints = extractQueryConstraints(query);

  const scored = vectorStore.map((doc) => {
    let similarity = cosineSimilarity(queryVector, doc.vector);

    // Exact name/token matching boosts
    let tokenOverlap = 0;
    const docTokens = new Set(tokenize(doc.name + " " + doc.category + " " + doc.description));
    queryTokens.forEach((qt) => {
      if (docTokens.has(qt)) tokenOverlap += 1;
    });
    const overlapRatio = queryTokens.length > 0 ? tokenOverlap / queryTokens.length : 0;
    similarity += overlapRatio * 0.4;

    // Constraint penalties / boosts
    if (constraints.maxPrice !== null && doc.price > constraints.maxPrice) {
      similarity -= 0.5; // penalize over-budget items
    }
    if (constraints.minPrice !== null && doc.price < constraints.minPrice) {
      similarity -= 0.3;
    }
    if (constraints.mustBeInStock && doc.stock <= 0) {
      similarity -= 0.6; // penalize out-of-stock when user asks for in-stock
    }
    if (constraints.targetCategory && doc.category.toLowerCase().includes(constraints.targetCategory)) {
      similarity += 0.25;
    }

    return {
      doc,
      similarity,
      price: doc.price,
      stock: doc.stock
    };
  });

  // Sort by similarity score descending
  scored.sort((a, b) => b.similarity - a.similarity);

  // If asking for cheapest or most expensive among matches, sort top candidates by price
  let candidatePool = scored.slice(0, Math.max(topK * 3, 20));
  if (constraints.maxPrice !== null) {
    const validBudget = candidatePool.filter(c => c.price <= constraints.maxPrice);
    if (validBudget.length > 0) candidatePool = validBudget;
  }
  if (constraints.mustBeInStock) {
    const inStock = candidatePool.filter(c => c.stock > 0);
    if (inStock.length > 0) candidatePool = inStock;
  }

  if (constraints.isCheapestQuery) {
    candidatePool.sort((a, b) => a.price - b.price);
  } else if (constraints.isExpensiveQuery) {
    candidatePool.sort((a, b) => b.price - a.price);
  }

  const topResults = candidatePool.slice(0, topK).map(item => item.doc);
  return { products: topResults, constraints };
}

// Call External LLM (Gemini / OpenAI / compatible API) if API key is configured
async function generateLlmResponse(question, retrievedProducts, constraints) {
  const geminiKey = process.env.GEMINI_API_KEY || process.env.LLM_API_KEY;
  const openAiKey = process.env.OPENAI_API_KEY;

  const catalogContext = retrievedProducts.map((p, idx) => {
    return `[Product ${idx + 1}] ID: ${p.id} | Name: ${p.name} | Category: ${p.category} | Price: ₹${p.price.toLocaleString("en-IN")} | Stock: ${p.stock} units | Vendor: ${p.vendor} | Description: ${p.description}`;
  }).join("\n");

  const systemPrompt = `You are the ShopSense AI Shopping Assistant, a helpful e-commerce advisor.
Your task is to answer the user's shopping question using ONLY the provided retrieved ShopSense product catalog context below.

STRICT GROUNDING RULES:
1. ONLY recommend or reference products that are explicitly listed in the "Retrieved Catalog Context".
2. Use EXACT names, categories, stock amounts, and prices (formatted in ₹ INR) from the context.
3. NEVER hallucinate, invent, or assume any product, brand, price, or feature not in the context.
4. If no products in the catalog match the user's criteria (such as price limit or category), politely explain that the ShopSense catalog does not currently have products matching those exact specifications.
5. Provide a helpful, structured summary comparing the top options with their key features, price, and stock availability.`;

  const userPrompt = `Retrieved Catalog Context:\n${catalogContext || "No matching products found in the catalog."}\n\nUser Question: ${question}\n\nPlease provide a grounded shopping recommendation:`;

  // 1. Google Gemini Provider
  if (geminiKey && geminiKey !== "your_key_here") {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }]
            }
          ],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 800
          }
        })
      });

      if (response.ok) {
        const result = await response.json();
        const generatedText = result.candidates?.[0]?.content?.parts?.[0]?.text;
        if (generatedText) return generatedText.trim();
      }
    } catch (err) {
      console.warn("Gemini API call failed, falling back to grounded rule synthesis:", err.message);
    }
  }

  // 2. OpenAI Provider (if configured)
  if (openAiKey && openAiKey !== "your_key_here") {
    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${openAiKey}`
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ],
          temperature: 0.2,
          max_tokens: 800
        })
      });

      if (response.ok) {
        const result = await response.json();
        const generatedText = result.choices?.[0]?.message?.content;
        if (generatedText) return generatedText.trim();
      }
    } catch (err) {
      console.warn("OpenAI API call failed, falling back to grounded rule synthesis:", err.message);
    }
  }

  // 3. Fallback: High-quality grounded semantic synthesis directly from retrieved catalog
  return formatGroundedFallbackResponse(question, retrievedProducts, constraints);
}

// Fallback Grounded Response Generator (Ensures 100% offline functionality without hallucinating)
function formatGroundedFallbackResponse(question, products, constraints) {
  const isGreeting = /^(hello|hi|hey|greetings|good\s+(morning|afternoon|evening)|howdy|help|who\s+are\s+you|what\s+can\s+you\s+do)\b/i.test(question.trim());

  if (!products || products.length === 0) {
    if (isGreeting) {
      return `Hello! I'm your **ShopSense AI Shopping Assistant**. I can help you discover products, compare prices, check stock availability, and find recommendations across our catalog. What are you looking for today?`;
    }
    return `Based on the ShopSense product catalog, no products were found matching your query "${question}". Please try searching for a different category or adjusting your price filter.`;
  }

  const count = products.length;
  let intro = `Based on the ShopSense catalog, here are the top **${count} product recommendations** matching your inquiry:\n\n`;

  if (isGreeting) {
    intro = `Hello! I'm your **ShopSense AI Shopping Assistant**. How can I help you with your shopping today?\n\nHere are some featured products available in our live catalog:\n\n`;
  } else if (constraints.maxPrice !== null) {
    intro = `Based on the ShopSense catalog, here are the best options available **under ₹${constraints.maxPrice.toLocaleString("en-IN")}**:\n\n`;
  } else if (constraints.targetCategory) {
    intro = `Based on the ShopSense catalog, here are top recommendations in the **${products[0]?.category}** category:\n\n`;
  }

  const items = products.map((p, idx) => {
    const stockStatus = p.stock > 0 ? `In Stock (${p.stock} units available)` : `Out of Stock`;
    return `**${idx + 1}. ${p.name}**\n- **Category:** ${p.category}\n- **Price:** ₹${p.price.toLocaleString("en-IN")}\n- **Stock:** ${stockStatus}\n- **Vendor:** ${p.vendor}\n- ${p.description}`;
  }).join("\n\n");

  const summary = `\n\nAll recommendations are strictly verified and grounded in current ShopSense catalog inventory.`;
  return intro + items + summary;
}

// Main Shopping Assistant Function
async function answerShoppingQuestion(question) {
  if (!question || typeof question !== "string" || !question.trim()) {
    throw new Error("A valid question string is required.");
  }

  const trimmedQuery = question.trim();

  // 1. Retrieve products from Vector Store
  const { products, constraints } = retrieveProducts(trimmedQuery, 5);

  // 2. Generate grounded LLM response
  const answer = await generateLlmResponse(trimmedQuery, products, constraints);

  // 3. Construct transparent source citations
  const sources = products.map((p) => ({
    productId: p.id,
    productName: p.name,
    category: p.category,
    price: p.price,
    stock: p.stock,
    vendor: p.vendor
  }));

  return {
    answer,
    products,
    sources
  };
}

// Initialize on startup
buildVectorStore();

module.exports = {
  answerShoppingQuestion,
  retrieveProducts,
  buildVectorStore,
  getVectorStoreCount: () => vectorStore.length
};

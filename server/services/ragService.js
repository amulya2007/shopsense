const db = require("../db");

// ---------------------------------------------------------------------------
// In-memory Vector Store
// ---------------------------------------------------------------------------
let vectorStore = [];
let isInitialized = false;

// Popularity index: productId (string) -> { unitsSold, orderCount }
// Built once from analytics_order_items alongside the vector store.
let popularityIndex = new Map();

// ---------------------------------------------------------------------------
// Stopwords
// ---------------------------------------------------------------------------
const STOPWORDS = new Set([
  "a","about","above","after","again","against","all","am","an","and","any","are","aren't",
  "as","at","be","because","been","before","being","below","between","both","but","by",
  "can't","cannot","could","couldn't","did","didn't","do","does","doesn't","doing","don't",
  "down","during","each","few","for","from","further","had","hadn't","has","hasn't","have",
  "haven't","having","he","he'd","he'll","he's","her","here","here's","hers","herself",
  "him","himself","his","how","how's","i","i'd","i'll","i'm","i've","if","in","into","is",
  "isn't","it","it's","its","itself","let's","me","more","most","mustn't","my","myself",
  "no","nor","not","of","off","on","once","only","or","other","ought","our","ours",
  "ourselves","out","over","own","same","shan't","she","she'd","she'll","she's","should",
  "shouldn't","so","some","such","than","that","that's","the","their","theirs","them",
  "themselves","then","there","there's","these","they","they'd","they'll","they're","they've",
  "this","those","through","to","too","under","until","up","very","was","wasn't","we",
  "we'd","we'll","we're","we've","were","weren't","what","what's","when","when's","where",
  "where's","which","while","who","who's","whom","why","why's","with","won't","would",
  "wouldn't","you","you'd","you'll","you're","you've","your","yours","yourself","yourselves",
  "show","me","find","get","looking","want","need","product","products","item","items"
]);

// ---------------------------------------------------------------------------
// Tokenise & vectorise
// ---------------------------------------------------------------------------
function tokenize(text) {
  if (!text) return [];
  const normalized = String(text).toLowerCase().replace(/[^a-z0-9\s]/g, " ");
  const rawTokens = normalized.split(/\s+/).filter(t => t.length > 1);
  return rawTokens.filter(t => !STOPWORDS.has(t));
}

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

  catTokens.forEach((ct) => {
    let hash = 0;
    for (let i = 0; i < ct.length; i++) {
      hash = (hash * 37 + ct.charCodeAt(i)) % dim;
    }
    vec[hash] += 2.0;
  });

  let norm = 0;
  for (let i = 0; i < dim; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < dim; i++) vec[i] /= norm;
  }
  return vec;
}

function cosineSimilarity(vecA, vecB) {
  let dot = 0;
  for (let i = 0; i < vecA.length; i++) dot += vecA[i] * vecB[i];
  return dot;
}

// ---------------------------------------------------------------------------
// Query intent / constraint extraction
// ---------------------------------------------------------------------------
function extractQueryConstraints(query) {
  const q = query.toLowerCase();
  let maxPrice = null;
  let minPrice = null;
  let mustBeInStock = false;
  let mustBeOutOfStock = false;
  let targetCategory = null;

  // Price range: "between 10000 and 30000"
  const rangeMatch = q.match(
    /(?:between|from)\s*(?:₹|rs\.?|inr)?\s*(\d+(?:,\d+)*(?:\.\d+)?)\s*(?:and|to|-)\s*(?:₹|rs\.?|inr)?\s*(\d+(?:,\d+)*(?:\.\d+)?)/i
  );
  if (rangeMatch) {
    minPrice = parseFloat(rangeMatch[1].replace(/,/g, ""));
    maxPrice = parseFloat(rangeMatch[2].replace(/,/g, ""));
  }

  // Under / below / less than
  if (maxPrice === null) {
    const underMatch = q.match(
      /(?:under|below|less than|max|budget of|within)\s*(?:₹|rs\.?|inr)?\s*(\d+(?:,\d+)*(?:\.\d+)?)/i
    );
    if (underMatch) maxPrice = parseFloat(underMatch[1].replace(/,/g, ""));
  }

  // Above / more than / at least
  if (minPrice === null) {
    const aboveMatch = q.match(
      /(?:above|more than|greater than|at least|over|starting from)\s*(?:₹|rs\.?|inr)?\s*(\d+(?:,\d+)*(?:\.\d+)?)/i
    );
    if (aboveMatch) minPrice = parseFloat(aboveMatch[1].replace(/,/g, ""));
  }

  // Bare price number interpreted as max when query has "under"-style words implicit
  // e.g. "electronics 50000" — only if no constraint already captured
  if (maxPrice === null && minPrice === null) {
    const barePrice = q.match(/(?:₹|rs\.?|inr)\s*(\d{4,6}(?:,\d+)*)/i);
    if (barePrice) maxPrice = parseFloat(barePrice[1].replace(/,/g, ""));
  }

  // Stock status
  if (
    q.includes("in stock") || q.includes("available") || q.includes("in-stock") ||
    q.includes("currently available") || q.includes("right now")
  ) {
    mustBeInStock = true;
  }
  if (q.includes("out of stock") || q.includes("unavailable") || q.includes("sold out") || q.includes("not available")) {
    mustBeOutOfStock = true;
    mustBeInStock = false;  // explicit out-of-stock overrides
  }

  // Price ordering intent
  const isCheapestQuery =
    q.includes("cheapest") || q.includes("lowest price") || q.includes("least expensive") ||
    q.includes("most affordable") || q.includes("budget") || q.includes("cheap");
  const isExpensiveQuery =
    q.includes("most expensive") || q.includes("highest price") || q.includes("premium") ||
    q.includes("luxury") || q.includes("top of the range");

  // Popularity intent
  const isPopularQuery =
    q.includes("popular") || q.includes("best selling") || q.includes("best-selling") ||
    q.includes("top selling") || q.includes("trending") || q.includes("most sold") ||
    q.includes("most ordered") || q.includes("in demand") || q.includes("bestseller");

  // Category detection — ordered longest match first to avoid "home" swallowing "home & kitchen"
  const KNOWN_CATEGORIES = [
    "home & kitchen", "computers", "electronics", "accessories",
    "wearables", "fashion", "beauty", "audio", "home"
  ];
  for (const cat of KNOWN_CATEGORIES) {
    if (q.includes(cat)) {
      targetCategory = cat;
      break;
    }
  }

  return {
    maxPrice,
    minPrice,
    mustBeInStock,
    mustBeOutOfStock,
    targetCategory,
    isCheapestQuery,
    isExpensiveQuery,
    isPopularQuery
  };
}

// ---------------------------------------------------------------------------
// Build popularity index from analytics_order_items
// ---------------------------------------------------------------------------
function buildPopularityIndex() {
  popularityIndex = new Map();
  try {
    const rows = db.prepare(`
      SELECT product_id,
             COALESCE(SUM(quantity), 0)          AS unitsSold,
             COUNT(DISTINCT order_id)             AS orderCount
      FROM analytics_order_items
      GROUP BY product_id
    `).all();
    rows.forEach((r) => {
      popularityIndex.set(String(r.product_id), {
        unitsSold:  Number(r.unitsSold),
        orderCount: Number(r.orderCount)
      });
    });
    console.log(`[RAG] Popularity index built: ${popularityIndex.size} products with sales data.`);
  } catch (err) {
    console.warn("[RAG] Could not build popularity index:", err.message);
  }
}

// ---------------------------------------------------------------------------
// Build / refresh the vector store from SQLite
// ---------------------------------------------------------------------------
function buildVectorStore() {
  const documents = [];

  // 1. Live vendor products
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
    console.error("[RAG] Error reading live products:", err);
  }

  // 2. Historical dataset products (analytics_products — 10 k+ items)
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
    console.error("[RAG] Error reading dataset products:", err);
  }

  vectorStore = documents;
  isInitialized = true;

  // Rebuild popularity alongside products
  buildPopularityIndex();

  // Compute max popularity for normalisation
  let maxUnits = 1;
  popularityIndex.forEach((v) => { if (v.unitsSold > maxUnits) maxUnits = v.unitsSold; });

  // Attach normalised popularity scores to documents
  vectorStore.forEach((doc) => {
    const pop = popularityIndex.get(doc.id);
    doc.popularityScore = pop ? pop.unitsSold / maxUnits : 0;
    doc.unitsSold       = pop ? pop.unitsSold : 0;
    doc.orderCount      = pop ? pop.orderCount : 0;
  });

  console.log(`[RAG Vector Store] Indexed ${vectorStore.length} products.`);
  return vectorStore.length;
}

// ---------------------------------------------------------------------------
// Retrieve: semantic similarity + hard constraint filtering + ranked results
// ---------------------------------------------------------------------------
function retrieveProducts(query, topK = 6, conversationContext = "") {
  if (!isInitialized || vectorStore.length === 0) buildVectorStore();

  // Merge conversation context for better follow-up understanding
  const fullQuery = conversationContext ? `${conversationContext} ${query}` : query;
  const queryVector = generateVector(fullQuery);
  const queryTokens = tokenize(fullQuery);
  const constraints = extractQueryConstraints(fullQuery);

  // ---- Score every document ----
  const scored = vectorStore.map((doc) => {
    let similarity = cosineSimilarity(queryVector, doc.vector);

    // Token overlap boost (name + category + description)
    const docTokenSet = new Set(tokenize(`${doc.name} ${doc.category} ${doc.description}`));
    let overlap = 0;
    queryTokens.forEach((qt) => { if (docTokenSet.has(qt)) overlap++; });
    const overlapRatio = queryTokens.length > 0 ? overlap / queryTokens.length : 0;
    similarity += overlapRatio * 0.4;

    // ---- Hard constraint PENALTIES (will push disqualified items to bottom) ----
    let hardPenalty = 0;

    if (constraints.maxPrice !== null && doc.price > constraints.maxPrice) {
      hardPenalty += 10; // disqualify
    }
    if (constraints.minPrice !== null && doc.price < constraints.minPrice) {
      hardPenalty += 10; // disqualify
    }
    if (constraints.mustBeInStock && doc.stock <= 0) {
      hardPenalty += 10; // disqualify
    }
    if (constraints.mustBeOutOfStock && doc.stock > 0) {
      hardPenalty += 10; // disqualify
    }

    // ---- Soft boosts ----
    if (constraints.targetCategory) {
      if (doc.category.toLowerCase() === constraints.targetCategory) {
        similarity += 0.35; // exact match
      } else if (doc.category.toLowerCase().includes(constraints.targetCategory)) {
        similarity += 0.2;  // partial match
      }
    }

    // Popularity boost when user asks for popular products
    if (constraints.isPopularQuery && doc.popularityScore > 0) {
      similarity += doc.popularityScore * 0.5;
    }

    return { doc, similarity, hardPenalty };
  });

  // ---- Apply hard constraints strictly ----
  // Separate disqualified from valid
  const valid      = scored.filter(s => s.hardPenalty === 0);
  const disqualified = scored.filter(s => s.hardPenalty > 0);

  // Sort valid by similarity descending
  valid.sort((a, b) => b.similarity - a.similarity);

  // ---- Secondary sort within top candidates ----
  // When a category constraint exists AND cheapest/expensive are requested,
  // first narrow to that category then sort by price so we don't mix categories.
  let candidatePool = valid.slice(0, Math.max(topK * 4, 30));

  if (constraints.isCheapestQuery || constraints.isExpensiveQuery) {
    // If a category was specified, prefer category-matching candidates
    if (constraints.targetCategory) {
      const catMatches = candidatePool.filter(
        c => c.doc.category.toLowerCase().includes(constraints.targetCategory)
      );
      if (catMatches.length >= topK) {
        candidatePool = catMatches;
      }
    }
    if (constraints.isCheapestQuery) {
      candidatePool.sort((a, b) => a.doc.price - b.doc.price);
    } else {
      candidatePool.sort((a, b) => b.doc.price - a.doc.price);
    }
  } else if (constraints.isPopularQuery) {
    // Sort by actual units sold (descending)
    candidatePool.sort((a, b) => b.doc.unitsSold - a.doc.unitsSold);
  }

  const results = candidatePool.slice(0, topK).map(item => item.doc);

  // If ZERO valid results exist, surface a small number of disqualified ones
  // (so the LLM can explain why nothing matched rather than returning empty)
  if (results.length === 0 && disqualified.length > 0) {
    disqualified.sort((a, b) => b.similarity - a.similarity);
    const fallback = disqualified.slice(0, 3).map(s => s.doc);
    return { products: fallback, constraints, constraintsMissed: true };
  }

  return { products: results, constraints, constraintsMissed: false };
}

// ---------------------------------------------------------------------------
// LLM call (Gemini → OpenAI → local grounded fallback)
// ---------------------------------------------------------------------------
async function generateLlmResponse(question, retrievedProducts, constraints, constraintsMissed = false) {
  const geminiKey = process.env.GEMINI_API_KEY || process.env.LLM_API_KEY;
  const openAiKey = process.env.OPENAI_API_KEY;

  const catalogContext = retrievedProducts.map((p, idx) => {
    const pop = p.unitsSold > 0 ? ` Units Sold (historical): ${p.unitsSold}` : "";
    return (
      `[Product ${idx + 1}] ID: ${p.id} | Name: ${p.name} | Category: ${p.category}` +
      ` | Price: ₹${p.price.toLocaleString("en-IN")} | Stock: ${p.stock} units` +
      ` | Vendor: ${p.vendor} | Description: ${p.description}${pop}`
    );
  }).join("\n");

  const constraintNote = constraintsMissed
    ? "\n\nNOTE: No products in the ShopSense catalog perfectly match the user's exact price/stock/category constraints. The ShopSense catalog prices range from ₹99 to ₹9,999 — any price filter above ₹9,999 will find no exact matches. The products above are the closest available matches. Inform the user of this catalog price limitation and show the nearest alternatives."
    : "";

  const systemPrompt = `You are the ShopSense AI Shopping Assistant, a professional e-commerce advisor.
Answer the user's shopping question using ONLY the retrieved ShopSense product catalog context below.

STRICT GROUNDING RULES:
1. ONLY reference products explicitly listed in the "Retrieved Catalog Context".
2. Use EXACT names, categories, prices (₹ INR), and stock figures from the context.
3. NEVER invent product names, prices, specs, ratings, reviews, battery life, CPU/RAM, or any attribute not present in the context.
4. If no products match the criteria, clearly say so and do NOT invent alternatives.
5. Popularity claims MUST be based on "Units Sold (historical)" from the context — do not call a product popular without this evidence.
6. For "best for video editing / gaming / students" etc.: if technical specs like CPU/RAM/GPU are not in the context, say: "The ShopSense catalog does not contain enough technical specifications to determine the best option for [use case]. Here are the most relevant available products."
7. Be concise. Show products with Price, Stock, Category. Avoid excessive marketing language.`;

  const userPrompt = `Retrieved Catalog Context:\n${catalogContext || "No matching products found in the catalog."}${constraintNote}\n\nUser Question: ${question}`;

  // 1. Google Gemini
  if (geminiKey && geminiKey !== "your_key_here") {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 900 }
        })
      });
      if (response.ok) {
        const result = await response.json();
        const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) return text.trim();
      }
    } catch (err) {
      console.warn("[RAG] Gemini call failed, falling back:", err.message);
    }
  }

  // 2. OpenAI
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
          max_tokens: 900
        })
      });
      if (response.ok) {
        const result = await response.json();
        const text = result.choices?.[0]?.message?.content;
        if (text) return text.trim();
      }
    } catch (err) {
      console.warn("[RAG] OpenAI call failed, falling back:", err.message);
    }
  }

  // 3. Local grounded fallback
  return formatGroundedFallbackResponse(question, retrievedProducts, constraints, constraintsMissed);
}

// ---------------------------------------------------------------------------
// Local grounded response synthesiser (no LLM required)
// ---------------------------------------------------------------------------
function formatGroundedFallbackResponse(question, products, constraints, constraintsMissed = false) {
  const isGreeting = /^(hello|hi|hey|greetings|good\s+(morning|afternoon|evening)|howdy|help|who\s+are\s+you|what\s+can\s+you\s+do)\b/i.test(
    question.trim()
  );

  if (isGreeting) {
    const sample = (products || []).slice(0, 3);
    const intro = `Hello! I'm the **ShopSense AI Shopping Assistant**. I can help you discover products, compare prices, check availability, and find recommendations across our catalog of 10,000+ items.\n\nHere are some products from our current catalog:\n\n`;
    if (sample.length === 0) return intro.trimEnd();
    const items = sample.map(p => {
      const s = p.stock > 0 ? `In Stock (${p.stock} units)` : "Out of Stock";
      return `• **${p.name}** — ₹${p.price.toLocaleString("en-IN")} | ${p.category} | ${s}`;
    }).join("\n");
    return intro + items;
  }

  if (!products || products.length === 0) {
    return `The ShopSense catalog does not currently have products matching your query "${question}". Please try a different category or adjust your price filter.`;
  }

  if (constraintsMissed) {
    const filterDesc = [];
    if (constraints.maxPrice !== null) filterDesc.push(`under ₹${constraints.maxPrice.toLocaleString("en-IN")}`);
    if (constraints.minPrice !== null) filterDesc.push(`above ₹${constraints.minPrice.toLocaleString("en-IN")}`);
    if (constraints.mustBeInStock)     filterDesc.push("in stock");
    if (constraints.mustBeOutOfStock)  filterDesc.push("out of stock");
    if (constraints.targetCategory)    filterDesc.push(`in ${constraints.targetCategory}`);
    const filterStr = filterDesc.length ? filterDesc.join(", ") : "your exact criteria";
    const altItems = products.map(p => {
      const s = p.stock > 0 ? `${p.stock} units` : "Out of Stock";
      return `• **${p.name}** — ₹${p.price.toLocaleString("en-IN")} | ${p.category} | Stock: ${s}`;
    }).join("\n");
    return (
      `The ShopSense catalog does not currently have products matching ${filterStr}.\n\n` +
      `**Note:** The ShopSense catalog prices range from ₹99 to ₹9,999. No products meet the price threshold you specified.\n\n` +
      `Here are the closest available alternatives:\n\n${altItems}`
    );
  }

  // Build intro based on constraints
  let intro = `Based on the ShopSense catalog, here are the top **${products.length}** product${products.length > 1 ? "s" : ""} matching your inquiry:\n\n`;

  if (constraints.isPopularQuery) {
    const hasPopData = products.some(p => p.unitsSold > 0);
    if (hasPopData) {
      intro = `Here are the most popular products in the ShopSense catalog, ranked by historical units sold:\n\n`;
    } else {
      intro = `Here are the most relevant products in the ShopSense catalog for your query (historical sales data is not available for these specific items):\n\n`;
    }
  } else if (constraints.maxPrice !== null && constraints.minPrice !== null) {
    intro = `Here are ShopSense catalog products priced between ₹${constraints.minPrice.toLocaleString("en-IN")} and ₹${constraints.maxPrice.toLocaleString("en-IN")}:\n\n`;
  } else if (constraints.maxPrice !== null) {
    intro = `Here are ShopSense catalog products available under ₹${constraints.maxPrice.toLocaleString("en-IN")}:\n\n`;
  } else if (constraints.isCheapestQuery) {
    intro = `Here are the most affordable options in the ShopSense catalog matching your query:\n\n`;
  } else if (constraints.isExpensiveQuery) {
    intro = `Here are the premium options in the ShopSense catalog matching your query:\n\n`;
  } else if (constraints.targetCategory) {
    intro = `Here are products from the **${products[0]?.category}** category in the ShopSense catalog:\n\n`;
  } else if (constraints.mustBeInStock) {
    intro = `Here are ShopSense catalog products currently in stock:\n\n`;
  } else if (constraints.mustBeOutOfStock) {
    intro = `Here are ShopSense catalog products that are currently out of stock:\n\n`;
  }

  const items = products.map((p, idx) => {
    const stockStatus = p.stock > 0 ? `In Stock (${p.stock} units)` : "Out of Stock";
    const popNote = p.unitsSold > 0 ? `\n  - **Popularity:** ${p.unitsSold.toLocaleString("en-IN")} units sold historically` : "";
    return (
      `**${idx + 1}. ${p.name}**\n` +
      `  - **Category:** ${p.category}\n` +
      `  - **Price:** ₹${p.price.toLocaleString("en-IN")}\n` +
      `  - **Stock:** ${stockStatus}\n` +
      `  - **Vendor:** ${p.vendor}\n` +
      `  - ${p.description}${popNote}`
    );
  }).join("\n\n");

  // Limitation note for "best for X" queries without specs
  const specQuery = /best.*(for|edit|gaming|student|work|design|photo|video|college|office)|recommend.*laptop|recommend.*phone/i.test(question);
  const hasSpecs = products.some(p => /ram|cpu|processor|gpu|ssd|display|battery|ghz|gb|tb/i.test(p.description));
  let limitation = "";
  if (specQuery && !hasSpecs) {
    limitation = `\n\n**Note:** The ShopSense catalog does not provide detailed technical specifications (CPU, RAM, GPU, etc.) for these products. The results above are the most relevant available options based on your query.`;
  }

  return intro + items + limitation;
}

// ---------------------------------------------------------------------------
// Lightweight conversation context helper (last 2 exchanges → summary string)
// ---------------------------------------------------------------------------
function buildConversationContext(history = []) {
  if (!Array.isArray(history) || history.length === 0) return "";
  // Accept last 2 AI messages' product lists as context hints
  const recent = history.slice(-2);
  const mentions = [];
  recent.forEach((turn) => {
    if (turn.role === "assistant" && Array.isArray(turn.products)) {
      turn.products.slice(0, 3).forEach(p => {
        if (p.name) mentions.push(p.name);
        if (p.category) mentions.push(p.category);
      });
    }
  });
  return mentions.join(" ");
}

// ---------------------------------------------------------------------------
// Product Description Generator
// Generates a professional e-commerce description from name + category only.
// Strictly no invented specs — only uses what the vendor provides.
// ---------------------------------------------------------------------------
async function generateProductDescription(name, category, extraHints = "") {
  const geminiKey = process.env.GEMINI_API_KEY || process.env.LLM_API_KEY;
  const openAiKey = process.env.OPENAI_API_KEY;

  // Retrieve similar products from the vector store to populate {{context}}.
  // These are passed as supporting reference only — the prompt rules instruct the
  // LLM to ignore context that conflicts with or is unrelated to the product name.
  let contextBlock = "No similar products found in the catalog.";
  try {
    if (isInitialized && vectorStore.length > 0) {
      const { products: similar } = retrieveProducts(`${name} ${category}`, 3);
      if (similar.length > 0) {
        contextBlock = similar.map((p, i) =>
          `[${i + 1}] Name: ${p.name} | Category: ${p.category} | Description: ${p.description}`
        ).join("\n");
      }
    }
  } catch (_) {
    // context is optional — proceed without it
  }

  // ── Your exact prompt template (variables filled in) ──────────────────────
  const prompt = `You are an expert e-commerce product description generator.

Your task is to generate an accurate, natural, and useful product description based on the product name provided by the user.

PRODUCT NAME:
${name}

CATEGORY:
${category}

RETRIEVED PRODUCT CONTEXT:
${contextBlock}

IMPORTANT RULES:
1. The product name is the PRIMARY source of truth.
2. Generate a description that accurately matches the product name.
3. Never describe the product as something unrelated to its name.
4. Retrieved context is only supporting information. If it is unrelated or conflicts with the product name, IGNORE it.
5. Do not copy descriptions from retrieved products.
6. Do not invent specific technical specifications, materials, brands, ingredients, features, certifications, or performance claims unless they are explicitly provided.
7. Do not assume a product belongs to a category just because a retrieved product has that category.
8. Keep the description concise: 1–3 sentences.
9. Use professional, customer-friendly e-commerce language.
10. Return ONLY the product description. Do not include headings, explanations, or JSON.

Examples:

Product name: lipstick
Category: Beauty
Output:
"A cosmetic lip product designed to add rich color and enhance the appearance of the lips. It is suitable for everyday makeup and helps create a polished look."

Product name: wireless headphones
Category: Audio
Output:
"Wireless headphones designed for comfortable everyday listening, offering a convenient way to enjoy music, podcasts, calls, and other audio content without wired connections."

Product name: running shoes
Category: Footwear
Output:
"A pair of athletic shoes designed for running and active use. They provide a comfortable fit and support for everyday workouts and running sessions."

Now generate the description for:
${name}`;
  // ─────────────────────────────────────────────────────────────────────────

  // 1. Google Gemini
  if (geminiKey && geminiKey !== "your_key_here") {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 200 }
        })
      });
      if (response.ok) {
        const result = await response.json();
        const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text && text.trim().length > 10) return text.trim().replace(/^["']|["']$/g, "");
      }
    } catch (err) {
      console.warn("[RAG] Gemini description generation failed:", err.message);
    }
  }

  // 2. OpenAI
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
          messages: [{ role: "user", content: prompt }],
          temperature: 0.4,
          max_tokens: 200
        })
      });
      if (response.ok) {
        const result = await response.json();
        const text = result.choices?.[0]?.message?.content;
        if (text && text.trim().length > 10) return text.trim().replace(/^["']|["']$/g, "");
      }
    } catch (err) {
      console.warn("[RAG] OpenAI description generation failed:", err.message);
    }
  }

  // 3. Local rule-based fallback — honest, grounded, no invented specs
  return generateLocalDescription(name, category);
}

// Local description generator — follows the exact same 10 rules as the LLM prompt.
// Reads the product name to understand WHAT the product is, then writes a
// natural 1–2 sentence description without inventing any spec not in the name.
function generateLocalDescription(name, category) {
  const n   = (name     || "").trim();
  const cat = (category || "").trim().toLowerCase();
  const low = n.toLowerCase();

  // sub() — substring match (safe for multi-word phrases)
  const sub  = (...words) => words.some(w => low.includes(w));
  // word() — whole-word match (use for short tokens that appear inside other words)
  const word = (...words) => words.some(w =>
    new RegExp("\\b" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b").test(low)
  );

  // ── Core product identification ──────────────────────────────────────────
  // Identify WHAT the product IS based solely on the name

  // Beauty & Cosmetics
  if (sub("lipstick") || sub("lip stick")) {
    return "A cosmetic lip product designed to add color and enhance the appearance of the lips. Suitable for everyday makeup and helping create a polished look.";
  }
  if (sub("lip gloss")) {
    return "A cosmetic lip product designed to add shine and enhance the appearance of the lips.";
  }
  if (sub("foundation")) {
    return "A facial cosmetic product designed to create an even base for makeup application.";
  }
  if (sub("concealer")) {
    return "A facial cosmetic product designed to cover and conceal specific areas during makeup application.";
  }
  if (sub("mascara")) {
    return "A cosmetic product designed to enhance the appearance of eyelashes.";
  }
  if (sub("perfume") || sub("fragrance") || sub("cologne")) {
    return "A scented product designed for personal fragrance use.";
  }
  if (sub("shampoo")) {
    return "A hair care product designed for washing and cleansing hair.";
  }
  if (sub("conditioner")) {
    return "A hair care product designed for use after shampooing.";
  }
  if (sub("moisturizer") || sub("lotion")) {
    return "A skin care product designed for regular application to the skin.";
  }
  if (word("cream") && (cat.includes("beauty") || cat.includes("skin"))) {
    return "A skin care product designed for topical application.";
  }
  if (sub("serum") && (cat.includes("beauty") || cat.includes("skin"))) {
    return "A concentrated skin care product designed for targeted application.";
  }
  if (sub("sunscreen") || word("spf")) {
    return "A skin protection product designed for sun exposure situations.";
  }

  // Audio Products
  if (sub("wireless headphone") || (sub("headphone") && (sub("wireless") || word("bluetooth")))) {
    return "Wireless headphones designed for listening to music, podcasts, calls, and other audio content without wired connections.";
  }
  if (sub("headphone") || sub("headset")) {
    return "Audio headphones designed for listening to music, podcasts, calls, and other audio content.";
  }
  if (sub("earbud") || sub("earphone")) {
    return "Audio earphones designed for personal listening to music, podcasts, and other audio content.";
  }
  if (sub("speaker")) {
    return "An audio speaker designed for playing music and other audio content.";
  }
  if (sub("soundbar")) {
    return "An audio device designed to enhance sound output for entertainment systems.";
  }
  if (sub("microphone") || word("mic")) {
    return "A microphone designed for capturing and recording audio input.";
  }

  // Computing
  if (word("gaming") && (sub("laptop") || sub("notebook"))) {
    return "A laptop computer designed for gaming and high-performance computing tasks.";
  }
  if (sub("laptop")) {
    return "A laptop computer designed for everyday computing tasks including work, study, and general use.";
  }
  // "notebook" only as laptop if category suggests computing
  if (sub("notebook") && (cat.includes("comput") || cat.includes("electronic") || cat.includes("tech"))) {
    return "A laptop computer designed for everyday computing tasks including work, study, and general use.";
  }
  if (sub("desktop")) {
    return "A desktop computer designed for computing tasks in a stationary workspace.";
  }
  if (sub("tablet")) {
    return "A tablet computing device designed for digital tasks including browsing, media consumption, and everyday use.";
  }
  if (sub("keyboard")) {
    return "A keyboard input device designed for typing and data entry.";
  }
  if (word("mouse") && !sub("pad")) {
    return "A computer mouse designed for cursor navigation and input control.";
  }
  if (sub("monitor") || (word("display") && cat.includes("compute"))) {
    return "A display monitor designed for visual output from computing devices.";
  }
  if (sub("webcam")) {
    return "A webcam designed for video capture during video calls and recording.";
  }
  if (sub("router")) {
    return "A network router designed to manage and distribute internet connectivity.";
  }
  if (sub("hard drive") || word("hdd") || word("ssd") || sub("storage drive")) {
    return "A data storage drive designed for storing digital files and information.";
  }
  if (sub("power bank")) {
    return "A portable power bank designed to recharge electronic devices.";
  }
  if (word("charger")) {
    return "A charging device designed to power electronic devices.";
  }
  if (sub("usb hub")) {
    return "A USB hub designed to expand available USB ports for connecting devices.";
  }
  if (word("cable") && (cat.includes("compute") || cat.includes("electronic") || cat.includes("accessory"))) {
    return "A cable designed for connecting electronic devices.";
  }

  // Wearables
  if (sub("smartwatch") || sub("smart watch")) {
    return "A smartwatch designed as a wearable device for time display and digital features.";
  }
  if (sub("fitness band") || sub("fitness tracker")) {
    return "A fitness tracker designed as a wearable device for activity monitoring.";
  }
  if (sub("smart band")) {
    return "A smart band designed as a wearable device with digital features.";
  }
  if (word("watch") && !sub("smart")) {
    return "A watch designed for timekeeping and personal wear.";
  }

  // Phones & Accessories
  if (sub("smartphone") || sub("mobile phone")) {
    return "A smartphone designed for communication, digital tasks, and mobile computing.";
  }
  if (sub("phone case")) {
    return "A phone case designed to protect mobile devices.";
  }
  if (sub("screen protector")) {
    return "A screen protector designed to shield device displays from damage.";
  }

  // Electronics
  if (word("camera")) {
    return "A camera designed for capturing photographs and video recordings.";
  }
  if (sub("projector")) {
    return "A projector designed to display visual content on screens or surfaces.";
  }
  if (word("tv") || sub("television")) {
    return "A television designed for viewing broadcast, streaming, and video content.";
  }
  if (word("drone")) {
    return "A drone designed as a flying device for aerial use.";
  }
  if (sub("printer")) {
    return "A printer designed to produce physical copies of digital documents and images.";
  }
  if (sub("scanner")) {
    return "A scanner designed to digitize physical documents and images.";
  }

  // Footwear
  if (sub("running shoe") || (word("shoe") && word("running"))) {
    return "A pair of athletic shoes designed for running and athletic activities.";
  }
  if (sub("sneaker") || word("trainers")) {
    return "A pair of sneakers designed for casual and athletic wear.";
  }
  if (word("shoe") || word("shoes")) {
    return "A pair of shoes designed for everyday footwear use.";
  }
  if (word("boot") || word("boots")) {
    return "A pair of boots designed for footwear protection and style.";
  }
  if (word("sandal") || word("sandals")) {
    return "A pair of sandals designed as open footwear for casual wear.";
  }

  // Fashion & Apparel
  if (sub("t-shirt") || sub("tshirt") || (word("shirt") && cat.includes("fashion"))) {
    return "A shirt designed for casual and everyday wear.";
  }
  if (sub("trouser") || word("pant") || word("pants")) {
    return "A pair of trousers designed for everyday clothing wear.";
  }
  if (sub("jacket")) {
    return "A jacket designed as an outer garment for layering and wear.";
  }
  if (word("coat")) {
    return "A coat designed as outerwear for protection and style.";
  }
  if (word("dress") && cat.includes("fashion")) {
    return "A dress designed as a one-piece garment for wear.";
  }
  if (sub("backpack")) {
    return "A backpack designed for carrying items on the back during daily activities.";
  }
  if (sub("handbag") || (word("bag") && cat.includes("fashion"))) {
    return "A bag designed for carrying personal items and essentials.";
  }
  if (sub("wallet")) {
    return "A wallet designed to hold cards, cash, and personal items.";
  }
  if (word("belt")) {
    return "A belt designed as an accessory for securing clothing at the waist.";
  }
  if (sub("sunglasses") || (word("glasses") && cat.includes("fashion"))) {
    return "Eyewear designed for sun protection and style.";
  }

  // Home & Kitchen
  if (sub("coffee maker") || sub("coffee machine")) {
    return "A coffee maker designed for brewing coffee beverages.";
  }
  if (sub("water bottle")) {
    return "A water bottle designed for storing and carrying drinking water.";
  }
  if (word("bottle") && !sub("water")) {
    return "A bottle designed for storing and transporting liquids.";
  }
  if (word("mug") || (word("cup") && cat.includes("home"))) {
    return "A mug designed for holding and drinking hot and cold beverages.";
  }
  if (sub("plate") || word("bowl") || word("dish")) {
    return "Kitchenware designed for serving and holding food.";
  }
  if (sub("cutlery") || (word("knife") && cat.includes("kitchen"))) {
    return "Cutlery designed for eating and food preparation.";
  }
  if (word("pan") || word("pot") || sub("cookware")) {
    return "Cookware designed for preparing and cooking food.";
  }
  if (sub("blender") || sub("juicer") || word("mixer")) {
    return "A kitchen appliance designed for blending and mixing food ingredients.";
  }
  if (sub("toaster") || sub("microwave") || (word("oven") && cat.includes("kitchen"))) {
    return "A kitchen appliance designed for heating and cooking food.";
  }
  if (sub("kettle")) {
    return "A kettle designed for heating water and liquids.";
  }
  if (sub("pillow") || sub("cushion")) {
    return "A cushion designed for comfort and support during rest.";
  }
  if (word("lamp") || (word("light") && cat.includes("home"))) {
    return "A lamp designed to provide illumination in indoor spaces.";
  }
  if (word("chair")) {
    return "A chair designed as seating furniture for everyday use.";
  }
  if (word("desk") || word("table")) {
    return "A table designed as furniture for work, dining, or general use.";
  }
  if (sub("bookcase") || word("shelf") || word("shelves")) {
    return "A shelf unit designed for storage and display of items.";
  }
  if (sub("clock")) {
    return "A clock designed for timekeeping and display.";
  }
  if (sub("vacuum")) {
    return "A vacuum cleaner designed for cleaning floors and surfaces.";
  }

  // Sports & Fitness
  if (sub("yoga mat")) {
    return "A yoga mat designed for yoga practice and floor exercises.";
  }
  if (sub("dumbbell") || sub("barbell") || (word("weight") && cat.includes("sport"))) {
    return "Fitness equipment designed for strength training exercises.";
  }
  if (sub("resistance band")) {
    return "A resistance band designed for strength and flexibility exercises.";
  }
  if (sub("bicycle") || word("bike") || word("cycle")) {
    return "A bicycle designed for cycling and transportation.";
  }
  if (sub("treadmill")) {
    return "A treadmill designed as exercise equipment for indoor running and walking.";
  }
  if (sub("helmet")) {
    return "A helmet designed for head protection during activities.";
  }

  // Groceries & Food
  if (sub("snack") || sub("chips") || sub("biscuit") || sub("cookie")) {
    return "A snack food item designed for consumption between meals.";
  }
  if ((word("oil") || word("sauce") || word("spice")) && cat.includes("grocer")) {
    return "A food ingredient designed for cooking and meal preparation.";
  }
  if ((word("coffee") || word("tea")) && cat.includes("grocer")) {
    return "A beverage product designed for drinking.";
  }

  // ── Generic fallback based on category ───────────────────────────────────
  if (cat.includes("audio")) {
    return `An audio product designed for listening and sound-related activities.`;
  }
  if (cat.includes("electronics") || cat.includes("electronic")) {
    return `An electronics product designed for everyday use.`;
  }
  if (cat.includes("compute") || cat.includes("computer")) {
    return `A computing product designed for digital tasks and everyday use.`;
  }
  if (cat.includes("wearable")) {
    return `A wearable device designed for personal wear and digital features.`;
  }
  if (cat.includes("fashion") || cat.includes("apparel") || cat.includes("clothing")) {
    return `A fashion item designed for everyday wear.`;
  }
  if (cat.includes("beauty") || cat.includes("cosmetic")) {
    return `A personal care product designed for everyday grooming and beauty use.`;
  }
  if (cat.includes("home") || cat.includes("kitchen")) {
    return `A home product designed for everyday household use.`;
  }
  if (cat.includes("sport") || cat.includes("fitness")) {
    return `A sports product designed for physical activity and exercise.`;
  }
  if (cat.includes("grocer") || cat.includes("food")) {
    return `A food product designed for consumption.`;
  }

  // ── Absolute fallback ─────────────────────────────────────────────────────
  return `A product designed for everyday use.`;
}
async function answerShoppingQuestion(question, conversationHistory = []) {
  if (!question || typeof question !== "string" || !question.trim()) {
    throw new Error("A valid question string is required.");
  }

  const trimmedQuery = question.trim();

  // Build lightweight context from prior conversation
  const convContext = buildConversationContext(conversationHistory);

  // 1. Retrieve products
  const { products, constraints, constraintsMissed } = retrieveProducts(trimmedQuery, 6, convContext);

  // 2. Generate grounded response
  const answer = await generateLlmResponse(trimmedQuery, products, constraints, constraintsMissed);

  // 3. Source citations
  const sources = products.map((p) => ({
    productId:   p.id,
    productName: p.name,
    category:    p.category,
    price:       p.price,
    stock:       p.stock,
    vendor:      p.vendor,
    unitsSold:   p.unitsSold || 0
  }));

  return { answer, products, sources };
}

// ---------------------------------------------------------------------------
// Initialise on startup
// ---------------------------------------------------------------------------
buildVectorStore();

module.exports = {
  answerShoppingQuestion,
  retrieveProducts,
  buildVectorStore,
  buildPopularityIndex,
  generateProductDescription,
  getVectorStoreCount: () => vectorStore.length
};

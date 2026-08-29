# ShopSense — Vendor Marketplace Console

A full-stack vendor marketplace management platform: vendors register and manage their product catalog; admins review applications and manage vendor accounts.

Rebuilt with a distinct visual identity (deep teal / amber "ledger" theme, Sora + Inter + IBM Plex Mono typography).

## Technology Stack

- **Backend:** Node.js, Express, SQLite (via `better-sqlite3`), JWT auth, bcrypt
- **Frontend:** React 19, Vite, React Router, Tailwind CSS, lucide-react icons
- **AI & RAG Engine:** In-memory Vector Store with dense semantic embeddings, hybrid cosine similarity retrieval, Google Gemini / OpenAI LLM integration with grounded catalog fallback

## Project Structure

```
server/              Express API (port 4000)
  db/                SQLite database + auto-seed on startup
  services/          RAG service & vector store engine (ragService.js)
  routes/            auth.js, vendor.js, admin.js, analytics.js, ai.js
  middleware/        JWT auth guard (auth.js)
client/              React app (port 5173, proxies /api -> :4000)
  src/
    pages/           Login, Register, vendor/*, admin/*
    components/      Shell (sidebar layout), StatCard, StatusBadge, ProtectedRoute
    context/         AuthContext (JWT + user session)
    lib/             axios API client
```

## Getting Started

### 1. Backend Setup

```bash
cd server
npm install
npm run dev
```

Starts the API on `http://localhost:4000` and creates `shopsense.db` on first run, seeded with:

- **Admin:** `admin@demo.com` / `admin123`
- **Vendor (approved):** `vendor@demo.com` / `vendor123`

### 2. Frontend Setup

```bash
cd client
npm install
npm run dev
```

Starts the app on `http://localhost:5173`. API calls to `/api/*` are proxied to the backend automatically.

Sign in with either demo account above, or register a new vendor (it will land in "pending" status until an admin approves it from the Admin → Vendor management screen).

---

## Core Features

### Vendor Features
- **Dashboard:** Sales, revenue, transactions, products-listed statistics, and recent products overview.
- **My Catalog:** Full CRUD operations for products (list, edit, adjust stock, delete).
- **Add/Edit Product:** Name, description, category, price, stock, image URL, with autocomplete suggestions drawn from catalog history.
- **Insights:** Deep BI analytics, demand projection, 3-tier customer segmentation, and market basket association rules.
- **AI Shopping Assistant:** Interactive RAG-powered shopping advisor for querying catalog products with vector-based semantic retrieval.
- **Profile:** Edit account info, change password, and view approval status.

### Admin Features
- **Dashboard:** Total, pending, approved, and suspended vendor metrics with recent registrations table.
- **Vendor Management:** Filter by status, approve, suspend, or reset any vendor account.

---

## Inventory & Customer Insights

The Vendor sidebar includes **Insights**, importing historical transaction data into SQLite analytics tables alongside live vendor products:

- Live catalog inventory stock statuses and configurable low/medium stock thresholds
- 3-tier customer segmentation (High, Medium, Low value tiers)
- Frequent product-pair patterns with absolute and relative support
- Association rules and cross-selling product recommendations with configurable support/confidence
- 30-day demand projection based on daily sales trends with category-average fallbacks
- Dataset import validation comparing database totals with source data files

### Analytics API Endpoints

All endpoints require a valid Vendor or Admin JWT:

- `GET /api/analytics/inventory?lowThreshold=5&mediumThreshold=20`
- `GET /api/analytics/historical-summary`
- `GET /api/analytics/customers`
- `GET /api/analytics/sales`
- `GET /api/analytics/top-products?category=Electronics&limit=5`
- `GET /api/analytics/frequent-patterns?minSupport=0.01`
- `GET /api/analytics/association-rules?minSupport=0.01&minConfidence=0.2`
- `GET /api/analytics/recommendations?minSupport=0.01&minConfidence=0.2`
- `GET /api/analytics/forecast?lowThreshold=5&mediumThreshold=20`
- `GET /api/analytics/validation`

---

## Advanced Analytics & Reporting

Production-grade reporting, vendor benchmarking against marketplace aggregates, and direct CSV data exports.

### 1. Reporting APIs

Frontend-ready BI endpoints with timeframe filtering (`30d`, `90d`, `year`, `month`, `week`) and scope selection (`vendor` live sales or `marketplace` dataset):

- `GET /api/analytics/reporting/sales-over-time`
  - Parameters: `timeframe` (default `30d`), `scope` (`vendor` or `marketplace`)
  - Returns chronologically ordered sales timeseries with `revenue`, `orders`, `unitsSold`, and `aov`.
- `GET /api/analytics/reporting/category-performance`
  - Parameters: `scope` (`vendor` or `marketplace`)
  - Returns revenue, units sold, order count, product count, and `revenueSharePct` across categories.
- `GET /api/analytics/reporting/top-products`
  - Parameters: `limit` (1–100, default 10), `category` (optional filter), `scope` (`vendor` or `marketplace`)
  - Returns bestselling products ranked by volume and revenue.
- `GET /api/analytics/reporting/summary`
  - Parameters: `scope` (`vendor` or `marketplace`)
  - Returns executive KPIs: `totalRevenue`, `totalOrders`, `totalUnitsSold`, `totalProducts`, `averageOrderValue`, `topCategory`, and `topProduct`.

### 2. Vendor Benchmarking API

- `GET /api/analytics/benchmark`
  - Compares the authenticated vendor against the marketplace average across all approved vendors for:
    - **Total Revenue** (₹)
    - **Total Orders**
    - **Units Sold**
    - **Products Listed**
  - Computes exact percentage differences (`+X.X%` above or `-X.X%` below marketplace average).
  - Provides categorized overall performance rating and strategic insights.
  - Enforces strict vendor isolation (vendors only see their own metrics and anonymized marketplace averages).

### 3. CSV Export APIs

- `GET /api/analytics/export/sales`
  - Exports real sales records as a downloadable CSV.
  - Columns: `Date,Product,Category,Quantity,Price,Revenue,Vendor`.
  - Sets `Content-Type: text/csv; charset=utf-8` and `Content-Disposition: attachment; filename="sales_report.csv"`.
- `GET /api/analytics/export/products`
  - Exports product catalog performance metrics as a downloadable CSV.
  - Columns: `ProductID,Name,Category,Price,Stock,UnitsSold,Revenue,Vendor`.
  - Sets `Content-Disposition: attachment; filename="products_report.csv"`.

---

## RAG-Powered AI Shopping Assistant

ShopSense features a **Retrieval-Augmented Generation (RAG)** AI Shopping Assistant that enables users to query the product catalog using natural language.

### RAG Architecture

```
User Question
    │
    ▼
[1. Intent & Constraint Extraction] (Budget, Category, In-Stock)
    │
    ▼
[2. Vector Embedding & Cosine Similarity Search] (10,000+ SQLite Products)
    │
    ▼
[3. Catalog Context Grounding & Anti-Hallucination Guardrails]
    │
    ▼
[4. LLM Synthesis] (Google Gemini / OpenAI / Local Grounded Synthesizer)
    │
    ▼
Answer + Grounded Product Cards + Transparent Source Citations
```

### Key Components

1. **Knowledge Source:** Real SQLite product data from both `products` (live vendor items) and `analytics_products` (historical catalog, 10,000+ items).
2. **Vector Store:** High-performance local in-memory vector store indexing product documents with 128-dimensional dense semantic vectors and n-gram subword hashing.
3. **Hybrid Search:** Combines vector cosine similarity with exact keyword overlap and constraint filtering (e.g. price ceiling, in-stock verification, category matching).
4. **Anti-Hallucination Guardrails:** The LLM is strictly constrained to the retrieved context. It never hallucinates unlisted products, fake prices, or non-existent stock.
5. **Real-time Index Refresh:** Automatically updates the vector index whenever products are added, updated, stock-adjusted, or deleted in the vendor catalog.

### Environment Configuration

The AI Assistant supports optional external LLM providers via environment variables in `server/.env`:

```env
# Optional: Google Gemini API Key
GEMINI_API_KEY=your_gemini_api_key_here

# Optional: OpenAI API Key (alternative)
OPENAI_API_KEY=your_openai_api_key_here

# Optional: Generic LLM Key
LLM_API_KEY=your_key_here
```

> **Safe Fallback:** If no API key is set, the system operates seamlessly in standalone local RAG mode, generating grounded, factual product syntheses directly from retrieved vector store records without crashing.

### AI Assistant API Endpoints

- `POST /api/ai/shopping-assistant`
  - Request: `{ "question": "What is the best laptop for video editing under 50000?" }`
  - Response:
    ```json
    {
      "answer": "Based on the ShopSense catalog, here are the top options...",
      "products": [
        {
          "id": "P1001",
          "name": "ProBook Laptop 15",
          "category": "Computers",
          "price": 45999,
          "stock": 18,
          "vendor": "Verified Vendor",
          "description": "High performance laptop with dedicated graphics."
        }
      ],
      "sources": [
        {
          "productId": "P1001",
          "productName": "ProBook Laptop 15",
          "category": "Computers",
          "price": 45999
        }
      ]
    }
    ```
- `GET /api/ai/status`
  - Returns vector store status, total indexed product count, and active LLM provider.
- `POST /api/ai/refresh-index`
  - Manually triggers a complete rebuild of the vector index from the SQLite database.

### Frontend Chat Interface

Accessible via **AI Assistant** (`/vendor/assistant`) in the vendor sidebar:
- Real-time conversation stream with responsive message bubbles.
- Interactive quick-start query pills (e.g., *"Show electronics under ₹50,000"*, *"Which products are currently in stock?"*).
- Formatted Product Cards embedded directly in AI responses showing verified prices in ₹, stock counts, categories, and descriptions.
- Transparent source tags showing the exact catalog products used for grounding.

---

## Authentication & Security

- Passwords hashed with `bcryptjs`.
- Stateless JWT authentication (7-day validity) with role-based access control (`vendor`, `admin`).
- Strict vendor data isolation: vendors can only access and modify their own catalog and private sales data.
- Input validation on all endpoints preventing negative stock, divisions by zero, and malformed requests.

---

## Testing & Verification

1. **Automated RAG & API Test Suite (`node server/test_rag.js`):**
   - Vector Store initialization and index verification (10,009 products) ➔ **PASSED**
   - Category-specific shopping queries ➔ **PASSED**
   - Budget-constrained queries (`under 50000`) ➔ **PASSED**
   - In-stock constraint validation (`stock > 0`) ➔ **PASSED**
   - Price ranking queries (cheapest / highest) ➔ **PASSED**
   - Bad request / empty query validation (400) ➔ **PASSED**
   - Existing reporting, benchmarking, CSV export, and analytics verification ➔ **PASSED**
   - Total: **21 passed, 0 failed**.

2. **Frontend Production Build (`npm run build`):**
   - Verified clean bundle generation with 0 errors.

---

# All Rights Reserved to AMULYA MUNUGOTI
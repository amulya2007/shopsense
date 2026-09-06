# ShopSense — Vendor Marketplace Intelligence Platform

ShopSense is a full-stack vendor marketplace and business intelligence platform. Vendors register, manage their product catalog, and access a complete suite of analytics, demand forecasting, customer segmentation, and AI-powered shopping assistance — all from a single, unified interface.

---

## Overview

ShopSense combines a live vendor catalog management system with deep analytics drawn from a historical dataset of 10,000+ products, 5,000+ customers, and real transaction history. The platform is designed to feel like one cohesive product rather than a collection of individual features.

---

## Technology Stack

| Layer | Technology |
|---|---|
| Backend | Node.js, Express |
| Database | SQLite via `better-sqlite3` |
| Authentication | JWT (7-day), bcryptjs, RBAC |
| Frontend | React 19, Vite, React Router v6, Tailwind CSS |
| Icons | lucide-react |
| Analytics data | XLSX dataset import into SQLite on first run |
| AI / RAG Engine | In-memory vector store, cosine similarity, hybrid retrieval |
| LLM providers | Google Gemini, OpenAI (optional — graceful local fallback) |
| Optional microservice | FastAPI analytics microservice (read-only, separate port) |

---

## Project Structure

```
shopsense/
├── server/                   Express API (port 4000)
│   ├── db/                   SQLite database + auto-seed on startup
│   │   └── index.js          Schema creation, dataset import, demo seed
│   ├── middleware/
│   │   └── auth.js           JWT verification + RBAC guard
│   ├── routes/
│   │   ├── auth.js           Login, register, token refresh
│   │   ├── vendor.js         Catalog CRUD, stock management, dashboard
│   │   ├── admin.js          Vendor approval, suspension, management
│   │   ├── analytics.js      Full BI suite: inventory, customers, sales,
│   │   │                     forecasting, benchmarking, CSV exports
│   │   └── ai.js             RAG shopping assistant endpoints
│   └── services/
│       └── ragService.js     Vector store, hybrid retrieval, LLM integration
│
├── client/                   React app (port 5173)
│   └── src/
│       ├── pages/
│       │   ├── vendor/       Dashboard, Catalog, Insights, AI Assistant, Profile
│       │   └── admin/        Admin dashboard, Vendor management
│       ├── components/       Shell, StatCard, StatusBadge, ProductImage, etc.
│       ├── context/          AuthContext (JWT session)
│       └── lib/              Axios API client, currency formatter
│
├── analytics_api/            Optional FastAPI microservice (port 8000)
│   ├── main.py               Summary, sales-over-time, top-products endpoints
│   └── README.md
│
└── dataset/                  Source XLSX files (imported once into SQLite)
    ├── products_1.xlsx
    ├── customers_1.xlsx
    ├── orders_1.xlsx
    └── order_items_1.xlsx
```

---

## Setup

### 1. Backend

```bash
cd server
npm install
npm run dev
```

Starts the API on `http://localhost:4000`. On first run, SQLite initialises automatically with:

- Schema creation (vendors, products, sales, analytics tables)
- Historical dataset import from `/dataset/*.xlsx`
- RAG vector index built from 10,009 products
- Demo accounts seeded (see credentials below)

**Demo credentials:**

| Role | Email | Password |
|---|---|---|
| Admin | admin@demo.com | admin123 |
| Vendor | vendor@demo.com | vendor123 |

### 2. Frontend

```bash
cd client
npm install
npm run dev
```

Starts the app on `http://localhost:5173`. API calls to `/api/*` are proxied to the backend automatically via Vite config.

### 3. AI Provider (Optional)

Set environment variables in `server/.env` to enable an external LLM. Without these, the system runs in local grounded-fallback mode — all responses are generated directly from retrieved catalog data with no hallucination.

```env
# Google Gemini (recommended)
GEMINI_API_KEY=your_gemini_api_key_here

# OR OpenAI
OPENAI_API_KEY=your_openai_api_key_here

# JWT secret (override default dev secret in production)
JWT_SECRET=your_production_secret_here
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GEMINI_API_KEY` | Optional | Google Gemini API key for LLM generation |
| `OPENAI_API_KEY` | Optional | OpenAI API key (used if Gemini not configured) |
| `LLM_API_KEY` | Optional | Generic fallback LLM key alias |
| `JWT_SECRET` | Recommended | JWT signing secret (defaults to dev value) |
| `PORT` | Optional | Backend port (defaults to 4000) |
| `CLIENT_ORIGIN` | Optional | Additional CORS origin for production deploys |
| `DB_PATH` | Optional | Path to SQLite DB (used by FastAPI microservice) |

---

## Vendor Experience

Vendors access a full business management suite after approval:

**Dashboard** — Business overview: total sales, revenue, transactions, and products listed. Recent product table with images, categories, prices, and stock.

**My Catalog** — Full product CRUD: list, add, edit, delete, adjust stock. Product images via URL or file upload. Low-stock badge indicators.

**Add / Edit Product** — Name, description, category, price, stock, image. Autocomplete suggestions drawn from catalog history.

**Insights** — Complete business intelligence suite (see Analytics & Reporting below).

**AI Shopping Assistant** — RAG-powered catalog search and product discovery (see AI Shopping Assistant below).

**Profile** — Edit account information, change password, view approval status.

---

## Admin Experience

**Admin Dashboard** — Total, pending, approved, and suspended vendor counts with recent registration table.

**Vendor Management** — Filter by status, approve, suspend, or reactivate any vendor account.

---

## Analytics & Reporting

All analytics are computed from real SQLite data. No mock or placeholder values.

### Business Overview

High-level KPIs from the historical dataset: total orders, total revenue, products sold, customer count, average order value.

### Sales & Reporting

Sales and revenue timeseries with day / week / month timeframe controls. Supports two scopes:

- **Vendor** — Live sales transactions from the vendor's own catalog
- **Marketplace** — Historical dataset (10,000+ products, 5,000+ orders)

Interactive SVG spline chart with Revenue, Units Sold, Orders, and Average Order Value metric toggles. Hover tooltips showing exact values per data point.

### Performance Benchmark

Compares the authenticated vendor against the marketplace average across all approved vendors:

| Metric | Vendor Value | Marketplace Average | Difference |
|---|---|---|---|
| Total Revenue | ₹X,XXX | ₹X,XXX | +/-X.X% |
| Total Orders | X | X | +/-X.X% |
| Units Sold | X | X | +/-X.X% |
| Products Listed | X | X | +/-X.X% |

Each metric shows above/below/equal status with a relative performance bar. Strategic insights are generated based on actual comparisons.

### Inventory Intelligence

Live stock status for every catalog product with configurable low-stock and medium-stock thresholds. Summary counts: healthy, low-stock, out-of-stock.

### Customer Insights

5,000 historical customers segmented into three spending tiers based on total purchase value:

- **High Value (VIP)** — Top spending customers, total revenue share, average spend
- **Medium Value** — Mid-tier customers
- **Low Value** — Entry-level customers

Searchable customer table with tier filter.

### Product Intelligence

Bestselling products ranked by units sold and revenue. Supports vendor scope (live sales) and marketplace scope (historical dataset). Category filter and configurable result limit.

### Demand Forecast

Interactive stock depletion simulation for any product in the 10,000-item catalog:

- Daily sales velocity from historical order data
- Projected demand over 7 / 14 / 30 / 60 / 90-day horizons
- Stock runout date calculation
- Recommended reorder quantity
- SVG trajectory chart: stock depletion vs cumulative demand
- Category-average velocity fallback when product-specific history is insufficient

### Cross-Sell Intelligence

Market basket analysis from actual transaction data:

- **Frequently Bought Together** — Product and category pair co-purchase patterns with support metrics
- **Association Rules** — Directional purchase relationships (If X → Then Y) with support and confidence
- **Cross-Sell Recommendations** — Rule-based suggestions generated from co-purchase evidence

Configurable minimum support and confidence thresholds.

### Dataset Validation

Live audit comparing imported SQLite table row counts against source XLSX workbook totals. Displays passed/failed status per dataset.

---

## CSV Export

| Export | Endpoint | Columns |
|---|---|---|
| Sales Report | `GET /api/analytics/export/sales` | Date, Product, Category, Quantity, Price, Revenue, Vendor |
| Products Report | `GET /api/analytics/export/products` | ProductID, Name, Category, Price, Stock, UnitsSold, Revenue, Vendor |

Both endpoints support `?scope=vendor` (live vendor sales) or `?scope=marketplace` (full historical dataset). Files are streamed with correct `Content-Type: text/csv` and `Content-Disposition` headers.

---

## AI Shopping Assistant

ShopSense includes a Retrieval-Augmented Generation (RAG) AI Shopping Assistant that answers natural-language product queries using real catalog data, with strict grounding and no hallucination.

### RAG Architecture

```
User Question
      │
      ▼
[1] Intent & Constraint Extraction
    • Price: under / above / between / range
    • Category: Electronics, Audio, Computers, Accessories, Wearables, Fashion, Beauty, Home & Kitchen
    • Stock: in-stock / out-of-stock
    • Ordering: cheapest / most expensive / popular
    • Follow-up context: last 2 conversation turns
      │
      ▼
[2] Vector Similarity Search
    • 128-dim dense semantic vectors (character n-gram + token hashing)
    • Category-boosted embeddings
    • Cosine similarity against 10,009 indexed products
    • Token overlap boost for exact name/category matches
      │
      ▼
[3] Hard Constraint Filtering
    • Price ceiling: disqualify products above maxPrice
    • Price floor: disqualify products below minPrice
    • In-stock: disqualify stock ≤ 0
    • Out-of-stock: disqualify stock > 0
    • If zero valid results: surfaces nearest alternatives with honest explanation
      │
      ▼
[4] Popularity & Price Ranking
    • Popular queries: sort by real unitsSold from analytics_order_items
    • Cheapest: narrow to category (if specified), then sort price ascending
    • Most expensive: sort price descending
    • Standard: cosine similarity + token overlap score
      │
      ▼
[5] Context Construction
    • Top 6 products passed to LLM
    • Each product includes: ID, name, category, price, stock, vendor, description, unitsSold
    • Constraint-missed flag triggers honest limitation message
      │
      ▼
[6] LLM Generation (Gemini → OpenAI → Local Fallback)
    • Strict grounding rules: only reference retrieved products
    • Never invent prices, specs, ratings, reviews, or popularity claims
    • Spec queries (best for video editing / gaming) trigger honest limitation note
    • 100% offline local fallback generates factual responses without any LLM
      │
      ▼
Answer + Grounded Product Cards + Source Citations
```

### Knowledge Source

| Source | Table | Products |
|---|---|---|
| Live vendor catalog | `products` | Variable (active vendor listings) |
| Historical dataset | `analytics_products` | 10,000+ |
| Popularity data | `analytics_order_items` | 6,302 products with sales history |

### Catalog Data Limitations

The ShopSense dataset has the following characteristics that the assistant communicates honestly:

- **Price range:** ₹99 to ₹9,999 (no products above ₹10,000)
- **Categories:** Accessories, Audio, Computers, Electronics, Wearables
- **No technical specs:** CPU, RAM, GPU, battery life, display size are not in the dataset
- **Popularity:** Available for 6,302 of 10,009 products via historical order data

When a query cannot be answered from available data (e.g., "best laptop for video editing" — no specs in dataset), the assistant explains the limitation and shows the most relevant available products.

### Vector Store

- Local in-memory store — no external vector database required
- 128-dimensional dense semantic vectors per product
- Character 3-gram subword hashing for fuzzy matching
- Category signal boosting (2× weight)
- Rebuilt automatically when any product is added, updated, or deleted via vendor catalog

### Index Refresh

The vector index rebuilds automatically on every:

- Product creation (`POST /api/vendor/products`)
- Product update (`PUT /api/vendor/products/:id`)
- Stock set (`PATCH /api/vendor/products/:id/stock`)
- Stock adjustment (`POST /api/vendor/products/:id/stock-adjustments`)
- Product deletion (`DELETE /api/vendor/products/:id`)

Manual refresh is also available: `POST /api/ai/refresh-index`

### Conversation Context

The assistant supports lightweight follow-up queries. The frontend sends the last 2 AI response product lists as context. This allows questions like "Which is the cheapest?" to resolve correctly after "Show me laptops."

---

## API Reference

### Authentication

```
POST /api/auth/login
POST /api/auth/register
```

All `/api/vendor/*` and `/api/analytics/*` endpoints require `Authorization: Bearer <token>`.

### Vendor Catalog

```
GET    /api/vendor/dashboard
GET    /api/vendor/products
POST   /api/vendor/products
PUT    /api/vendor/products/:id
DELETE /api/vendor/products/:id
PATCH  /api/vendor/products/:id/stock
POST   /api/vendor/products/:id/stock-adjustments
POST   /api/vendor/images
```

### Analytics

```
GET /api/analytics/inventory
GET /api/analytics/customers
GET /api/analytics/sales
GET /api/analytics/historical-summary
GET /api/analytics/frequent-patterns
GET /api/analytics/association-rules
GET /api/analytics/recommendations
GET /api/analytics/forecast
GET /api/analytics/validation
GET /api/analytics/reporting/sales-over-time   ?timeframe=30d|90d|year|month|week &scope=vendor|marketplace
GET /api/analytics/reporting/category-performance ?scope=vendor|marketplace
GET /api/analytics/reporting/top-products      ?limit=1-100 &category= &scope=vendor|marketplace
GET /api/analytics/reporting/summary           ?scope=vendor|marketplace
GET /api/analytics/benchmark
GET /api/analytics/export/sales                ?scope=vendor|marketplace
GET /api/analytics/export/products             ?scope=vendor|marketplace
```

### AI Shopping Assistant

```
POST /api/ai/shopping-assistant
     Body: { "question": string, "conversationHistory": optional array }
     Response: { "answer": string, "products": array, "sources": array }

GET  /api/ai/status
     Response: { "status", "vectorStoreReady", "indexedProducts", "llmProviderConfigured", "provider" }

POST /api/ai/refresh-index
     Response: { "success", "message", "indexedProducts" }
```

### Admin

```
GET   /api/admin/vendors
PATCH /api/admin/vendors/:id/status
```

---

## Authentication & Security

- Passwords hashed with bcryptjs (10 rounds)
- Stateless JWT authentication with 7-day validity
- Role-based access control: `vendor` and `admin` roles enforced at middleware level
- Strict vendor data isolation: vendors can only read and modify their own catalog and sales data
- AI API keys stored in environment variables only — never in frontend code or committed to source control
- Input validation on all endpoints: negative stock, malformed prices, oversized requests all rejected

---

## Testing

Run the included test suites against the live server:

```bash
# From server/
node test_rag.js    # 21 tests: RAG, vector store, constraint validation, analytics
node test_m3.js     # 15 tests: Reporting APIs, benchmarking, CSV exports, auth security
```

**Last verified results:**

| Suite | Tests | Result |
|---|---|---|
| test_rag.js | 21 | 21 passed, 0 failed |
| test_m3.js | 15 | 15 passed, 0 failed |
| Total | 36 | 36 passed, 0 failed |

**Constraint tests verified:**

| Query | Constraint | Result |
|---|---|---|
| "Electronics in stock" | category=Electronics, stock>0 | All results in Electronics, all in stock |
| "Under 50,000" | price ≤ 50,000 | All results ≤ ₹9,999 (entire catalog qualifies) |
| "Between 10,000 and 30,000" | price 10k–30k | Honest: no catalog products in that range |
| "Out of stock" | stock = 0 | All results have stock = 0 |
| "Cheapest Audio" | category=Audio, cheapest | All results in Audio, sorted by price ascending |
| "Popular products" | isPopular | Sorted by real unitsSold from order history |

---

## Optional FastAPI Microservice

A standalone FastAPI analytics microservice is included for environments that need a Python-native REST layer. It reads the same SQLite database in read-only mode and validates the same JWT tokens.

```bash
cd analytics_api
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Endpoints: `GET /analytics/summary`, `GET /analytics/sales-over-time`, `GET /analytics/top-products`

Interactive docs at `http://localhost:8000/docs`.

> The main ShopSense frontend does not depend on this microservice. It is an optional supplementary API.

---

## All Rights Reserved to AMULYA MUNUGOTI


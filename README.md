# ShopSense — Vendor Marketplace Console

A full-stack vendor marketplace management platform: vendors register and manage
their product catalog; admins review applications and manage vendor accounts.

Rebuilt with a distinct visual identity (deep teal / amber "ledger" theme,
Sora + Inter + IBM Plex Mono typography) — same feature set as the reference
video, different UI.

## Stack

- **Backend:** Node.js, Express, SQLite (via `better-sqlite3`), JWT auth, bcrypt
- **Frontend:** React 19, Vite, React Router, Tailwind CSS v4, lucide-react icons

## Project structure

```
server/          Express API (port 4000)
  db/            SQLite database + auto-seed on first run
  routes/        auth.js, vendor.js, admin.js
  middleware/    JWT auth guard
client/          React app (port 5173, proxies /api -> :4000)
  src/
    pages/       Login, Register, vendor/*, admin/*
    components/  Shell (sidebar layout), StatCard, StatusBadge, ProtectedRoute
    context/     AuthContext (JWT + user session)
    lib/         axios API client
```

## Getting started

### 1. Backend

```bash
cd server
npm install
npm run dev
```

Starts the API on `http://localhost:4000` and creates `shopsense.db` on first
run, seeded with:

- **Admin:** `admin@demo.com` / `admin123`
- **Vendor (approved):** `vendor@demo.com` / `vendor123`

### 2. Frontend

```bash
cd client
npm install
npm run dev
```

Starts the app on `http://localhost:5173`. API calls to `/api/*` are proxied
to the backend automatically (see `vite.config.js`).

Open `http://localhost:5173` and sign in with either demo account above, or
register a new vendor (it will land in "pending" status until an admin
approves it from the Admin → Vendor management screen).

## Features

**Vendor**
- Dashboard: sales, revenue, transactions, products-listed stats + recent products
- My Catalog: list/edit/delete products
- Add/Edit Product: name, description, category, price, stock, optional image URL,
  with name autocomplete suggestions drawn from the vendor's own catalog history
- Analytics: product count by category, revenue by day
- Profile: edit account info, change password, view approval status

**Admin**
- Dashboard: total/pending/approved/suspended vendor counts + recent vendors table
- Vendor management: filter by status, approve / suspend / reset any vendor

## Milestone 2: Inventory & customer insights

The Vendor sidebar now includes **Insights**. It uses the Excel data in `dataset/`
and imports it safely into separate SQLite analytics tables on server startup.
Existing vendor products, sales, vendors, and admins are not replaced.

The Insights page includes:

- Live catalog inventory stock statuses and configurable low/medium stock thresholds
- Customer spend, order count, average order value, and data-derived segments
- Sales totals, product/category performance, and sales-by-date API data
- Frequent product-pair patterns with absolute and relative support
- Association rules and product recommendations with configurable support/confidence
- A transparent 30-day demand projection based on observed daily sales, with
  matched-product and category-average fallbacks
- Import validation that compares database totals with the source Excel files

### Analytics API

All endpoints require a valid Vendor or Admin JWT.

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

### Optional integrations

The supplied dataset contains transactions but no product-review text, and this
project has no external vector database configured. The Insights UI therefore
shows an explicit unavailable state for LLM sentiment analysis and provides
category/name-based related products rather than claiming vector search. Adding
either optional integration requires review data plus an AI provider, or a
configured vector database and embedding provider, respectively.

Minimum support and confidence are decimal values between `0` and `1`. The
defaults are `0.01` (1%) support and `0.2` (20%) confidence, selected to suit
the supplied historical dataset.

### Live inventory API

These endpoints require a Vendor JWT and operate only on that vendor's current
catalog. Stock can never be set or adjusted below zero.

- `GET /api/vendor/inventory?lowThreshold=5`
- `GET /api/vendor/inventory/alerts?lowThreshold=5`
- `PATCH /api/vendor/products/:id/stock` with `{ "stock": 12 }`
- `POST /api/vendor/products/:id/stock-adjustments` with `{ "change": -2 }`

### Testing the APIs

Start the backend with `cd server` then `npm run dev`. In a second terminal,
obtain a vendor token (replace the credentials if using another approved
vendor):

```powershell
$login = Invoke-RestMethod -Method Post -Uri http://localhost:4000/api/auth/login -ContentType 'application/json' -Body '{"email":"vendor@demo.com","password":"vendor123","role":"vendor"}'
$headers = @{ Authorization = "Bearer $($login.token)" }
```

Then test live inventory and low-stock alerts:

```powershell
Invoke-RestMethod -Uri 'http://localhost:4000/api/vendor/inventory?lowThreshold=5' -Headers $headers
Invoke-RestMethod -Uri 'http://localhost:4000/api/vendor/inventory/alerts?lowThreshold=5' -Headers $headers
$inventory = Invoke-RestMethod -Uri 'http://localhost:4000/api/vendor/inventory?lowThreshold=5' -Headers $headers
$productId = $inventory.products[0].productId # Add a product first if the catalog is empty.
Invoke-RestMethod -Method Patch -Uri "http://localhost:4000/api/vendor/products/$productId/stock" -Headers $headers -ContentType 'application/json' -Body '{"stock":3}'
Invoke-RestMethod -Method Post -Uri "http://localhost:4000/api/vendor/products/$productId/stock-adjustments" -Headers $headers -ContentType 'application/json' -Body '{"change":-1}'
```

For historical customer segments and rule-based top products:

```powershell
Invoke-RestMethod -Uri http://localhost:4000/api/analytics/customers -Headers $headers
Invoke-RestMethod -Uri 'http://localhost:4000/api/analytics/top-products?category=Electronics&limit=5' -Headers $headers
```

## Milestone 3: Advanced APIs & Reporting

Milestone 3 introduces production-grade reporting, vendor benchmarking against marketplace aggregates, and direct CSV data exports while maintaining the established Node.js + Express + SQLite + React architecture and existing Milestone 1 & 2 capabilities.

### 1. Reporting APIs

Frontend-ready reporting and BI endpoints with support for timeframe filtering (`30d`, `90d`, `year`, `month`, `week`) and scope selection (`vendor` live sales or `marketplace` dataset):

- `GET /api/analytics/reporting/sales-over-time`
  - Parameters: `timeframe` (default `30d`), `scope` (`vendor` or `marketplace`)
  - Returns chronologically ordered sales timeseries with `revenue`, `orders`, `unitsSold`, and `aov`, plus aggregated totals.
- `GET /api/analytics/reporting/category-performance`
  - Parameters: `scope` (`vendor` or `marketplace`)
  - Returns revenue, units sold, order count, product count, and `revenueSharePct` across categories.
- `GET /api/analytics/reporting/top-products`
  - Parameters: `limit` (1–100, default 10), `category` (optional filter), `scope` (`vendor` or `marketplace`)
  - Returns bestselling products ranked by volume and revenue.
- `GET /api/analytics/reporting/summary`
  - Parameters: `scope` (`vendor` or `marketplace`)
  - Returns high-level executive KPIs including `totalRevenue`, `totalOrders`, `totalUnitsSold`, `totalProducts`, `averageOrderValue`, `topCategory`, and `topProduct`.

### 2. Vendor Benchmarking API

- `GET /api/analytics/benchmark`
  - Compares the authenticated vendor against the marketplace average across all vendors for:
    - **Total Revenue** (₹)
    - **Total Orders**
    - **Units Sold**
    - **Products Listed**
  - Computes exact percentage differences (`+X.X%` above or `-X.X%` below marketplace average).
  - Provides categorized overall performance rating and actionable strategic insights.
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

### 4. Frontend Insights Integration

Integrated seamlessly into the **Vendor Insights** page (`/vendor/insights`) without breaking existing Milestone 1 and Milestone 2 features:
- **Interactive Reporting Scope & Export Toolbar**: Switch between vendor's live sales and marketplace dataset, and trigger real-time CSV downloads.
- **Vendor vs Marketplace Benchmark Cards**: Side-by-side metric comparison cards with status badges (`Above Avg` / `Below Avg`), comparative progress bars, and strategic recommendations.
- **Sales & Revenue Over Time Visualizer**: Smooth cubic spline curve chart with interactive timeframes (`Day`, `Week`, `Month`) and metric selectors (`Revenue`, `Units`, `Orders`, `Avg Order Value`).
- **Category Performance & Top Products Breakdown**: Category contribution cards with revenue shares and ranked product listings.

### 5. Authentication & Security

- All new reporting, benchmarking, and export endpoints require a valid JWT token via `requireAuth(["vendor", "admin"])`.
- Vendor data is strictly isolated; vendors cannot query or expose private transaction records of other vendors.
- Zero divisions, empty catalog/sales scenarios, and invalid tokens are safely handled.

### 6. Testing Performed

- Automated test suite in `server/test_m3.js` validates all 7 new endpoints (status codes, JSON schemas, calculations, CSV headers, data isolation, and 401 unauthorized handling).
- Frontend production build validated (`npm run build` with Vite).

> **Note on Optional Features:** In accordance with instructions, optional features such as WebSockets, RAG, LangChain/LlamaIndex, AI Shopping Assistant, and Text-to-SQL are intentionally not implemented to maintain stability and focus entirely on the core Base Requirements of Milestone 3.

## Notes

- Passwords are hashed with bcrypt; sessions use short-lived JWTs (7 days) stored
  in `localStorage`.
- The SQLite file is created automatically — no external database server needed.
- To reset all data, stop the server and delete `server/db/shopsense.db*`

# All Rights Reserved to AMULYA MUNUGOTI
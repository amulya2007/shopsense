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

## Notes

- Passwords are hashed with bcrypt; sessions use short-lived JWTs (7 days) stored
  in `localStorage`.
- The SQLite file is created automatically — no external database server needed.
- To reset all data, stop the server and delete `server/db/shopsense.db*`

# All Rights Reserved to AMULYA MUNUGOTI
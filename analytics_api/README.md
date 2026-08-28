# ShopSense Analytics API (Milestone 3 - Step 1)

A FastAPI microservice that provides analytics endpoints for the ShopSense project.
Runs alongside the Express server, reads the same SQLite database (read-only),
and validates the same JWT tokens.

## Prerequisites

- Python 3.10+
- packages: `fastapi`, `uvicorn[standard]`, `python-jose[cryptography]`, `pydantic`

Install:
```
pip install -r requirements.txt
```

## Start the server

From the project root:
```
uvicorn analytics_api.main:app --reload --port 8000
```

Or from inside this folder:
```
uvicorn main:app --reload --port 8000
```

## Authentication

All `/analytics/*` endpoints require a Bearer token.
Get one by logging in through the Express server:

```
POST http://localhost:4000/api/auth/login
{ "email": "vendor@demo.com", "password": "vendor123", "role": "vendor" }
```

Copy the `token` field and pass it as:
```
Authorization: Bearer <token>
```

## Endpoints

| Method | Path                        | Description                                   |
|--------|-----------------------------|-----------------------------------------------|
| GET    | /health                     | Health check (no auth)                        |
| GET    | /analytics/summary          | Overall sales & revenue snapshot              |
| GET    | /analytics/sales-over-time  | Daily / weekly / monthly revenue timeseries   |
| GET    | /analytics/top-products     | Top N products by units sold or revenue       |
| GET    | /docs                       | Swagger UI (interactive docs)                 |
| GET    | /redoc                      | ReDoc alternative docs                        |

### GET /analytics/summary
Returns: totalOrders, totalRevenue, averageOrderValue, totalProductsSold, totalProducts, totalCustomers

### GET /analytics/sales-over-time
Query params:
- `granularity` – `daily` (default) | `weekly` | `monthly`
- `days` – for daily: window size (default 90, max 3650)

### GET /analytics/top-products
Query params:
- `limit` – 1-100, default 10
- `sortBy` – `units_sold` (default) | `revenue`
- `category` – optional category filter (case-insensitive)

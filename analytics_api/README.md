# ShopSense Python AI & Analytics API

The FastAPI service owns the vendor-scoped RAG assistant and analytics endpoints. It runs
alongside Express, reads the shared SQLite database in read-only mode, and validates the
JWTs issued by Express. Express proxies authenticated `/api/ai/*` requests to this service.

## Install and run

From the repository root:

```powershell
python -m venv analytics_api\.venv
analytics_api\.venv\Scripts\Activate.ps1
pip install -r analytics_api\requirements.txt
uvicorn analytics_api.main:app --reload --port 8000
```

Keep the Express server running as well. Python loads `JWT_SECRET`, Gemini/OpenAI keys, and
`DB_PATH` from `server/.env`; relative database paths are resolved from the repository root.
Docker Compose starts the AI service and Express API together.

## Endpoints

All endpoints except `GET /health` require a bearer JWT from Express login.

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Health check |
| POST | `/ai/shopping-assistant` | Vendor-scoped hybrid catalog retrieval and grounded answer generation |
| GET | `/ai/status` | Catalog count and configured Python LLM provider |
| POST | `/ai/refresh-index` | Verify current live catalog count |
| POST | `/ai/generate-description` | Grounded product description generation |
| POST | `/ai/generate-seo-content` | Grounded product SEO fields |
| GET | `/analytics/summary` | Overall sales and revenue snapshot |
| GET | `/analytics/sales-over-time` | Daily, weekly, or monthly revenue timeseries |
| GET | `/analytics/top-products` | Top products by units sold or revenue |
| GET | `/docs` | Interactive Swagger UI |
| GET | `/redoc` | ReDoc API reference |

Vendor AI requests always use the vendor ID from the signed token; an admin must explicitly
provide a vendor ID when using the shopping assistant. Retrieval reads current products and
sales from SQLite on every request, so stock and catalog changes do not require a vector
index rebuild. Gemini or OpenAI can synthesize responses from retrieved records. Without a
provider key, or if the provider fails, Python returns a grounded local response.

Analytics query parameters:

- `/analytics/sales-over-time`: `granularity` (`daily`, `weekly`, or `monthly`) and `days`
  (1–3650, for daily reports).
- `/analytics/top-products`: `limit` (1–100), `sortBy` (`units_sold` or `revenue`), and an
  optional case-insensitive `category`.

## Tests

Run the Python AI/RAG tests from the repository root:

```powershell
python -m unittest discover -s analytics_api -p "test_*.py" -v
```

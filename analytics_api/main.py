"""
ShopSense — FastAPI Analytics Microservice

Runs alongside the existing Express server (default port 8000).
Reads the same SQLite database (server/db/shopsense.db) and validates
the same JWT tokens issued by the Express /api/auth/login endpoint.

Endpoints
---------
GET /analytics/summary          - overall sales & revenue summary
GET /analytics/sales-over-time  - daily / weekly / monthly timeseries
GET /analytics/top-products     - top-selling products by units sold
GET /docs                       - interactive Swagger UI
GET /redoc                      - ReDoc alternative docs
"""

import os
import sqlite3
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Any, Literal, Optional

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

_THIS_DIR = Path(__file__).parent
load_dotenv(_THIS_DIR.parent / "server" / ".env")

# Matches the Express middleware/auth.js default secret
JWT_SECRET: str = os.getenv("JWT_SECRET", "shopsense-dev-secret")
JWT_ALGORITHM: str = "HS256"

# Shared SQLite database written by the Express server
_configured_db_path = Path(
    os.getenv("DB_PATH", str(_THIS_DIR / ".." / "server" / "db" / "shopsense.db"))
)
DB_PATH: Path = (
    _configured_db_path
    if _configured_db_path.is_absolute()
    else _THIS_DIR.parent / _configured_db_path
).resolve()

# ---------------------------------------------------------------------------
# Database dependency
# ---------------------------------------------------------------------------

def get_db():
    """Open a read-only connection to the shared SQLite database."""
    if not DB_PATH.exists():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Database not found at {DB_PATH}. Start the Express server first.",
        )
    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()

# ---------------------------------------------------------------------------
# JWT authentication - reuses the same secret as the Express server
# ---------------------------------------------------------------------------

security = HTTPBearer()


class TokenPayload(BaseModel):
    id: int
    role: str
    name: Optional[str] = None
    email: Optional[str] = None


def verify_token(
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(security)],
) -> TokenPayload:
    """Decode and validate the JWT. Accepts vendor and admin roles."""
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    role = payload.get("role", "")
    if role not in ("vendor", "admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden for this role")
    return TokenPayload(id=payload["id"], role=role, name=payload.get("name"), email=payload.get("email"))


CurrentUser = Annotated[TokenPayload, Depends(verify_token)]
DBConn = Annotated[sqlite3.Connection, Depends(get_db)]

# ---------------------------------------------------------------------------
# Pydantic response models
# ---------------------------------------------------------------------------


class SalesSummary(BaseModel):
    totalOrders: int
    totalRevenue: float
    averageOrderValue: float
    totalProductsSold: int
    totalProducts: int
    totalCustomers: int


class SalesSummaryResponse(BaseModel):
    summary: SalesSummary
    dataSource: str = "historical_dataset"
    note: str = "Data sourced from the ShopSense analytics dataset."


class SalesOverTimeResponse(BaseModel):
    granularity: str
    data: list
    totalPoints: int


class TopProductsResponse(BaseModel):
    limit: int
    category: Optional[str]
    sortBy: str
    products: list
    recommendationRule: str = "Products ranked by historical units sold, then by revenue."


class ConversationProduct(BaseModel):
    id: str | int | None = None
    name: str = ""
    category: str = ""


class ConversationTurn(BaseModel):
    role: Literal["assistant"]
    products: list[ConversationProduct] = Field(default_factory=list, max_length=20)


class ShoppingAssistantRequest(BaseModel):
    question: str = Field(min_length=1, max_length=500)
    conversationHistory: list[ConversationTurn] = Field(default_factory=list, max_length=4)
    vendorId: int | None = Field(default=None, gt=0)


class ProductContentRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    category: str = Field(min_length=1, max_length=100)
    hints: str = Field(default="", max_length=1000)

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI):
    print(f"[ShopSense Analytics] DB path : {DB_PATH}")
    print(f"[ShopSense Analytics] DB exists: {DB_PATH.exists()}")
    yield


app = FastAPI(
    title="ShopSense Python AI & Analytics API",
    description=(
        "FastAPI analytics service for ShopSense. "
        "Use the JWT token from POST /api/auth/login (Express) as a Bearer token here."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:4000",
        "https://shopsense-client.onrender.com",
    ],
    allow_credentials=True,
    allow_methods=["GET"],
    allow_headers=["Authorization", "Content-Type"],
)

# ---------------------------------------------------------------------------
# Health check (no auth)
# ---------------------------------------------------------------------------


@app.get("/health", tags=["Health"])
def health_check():
    return {"status": "ok", "service": "ShopSense Python AI & Analytics API", "version": "1.0.0"}


# ---------------------------------------------------------------------------
# Python-native, vendor-scoped retrieval-augmented generation
# ---------------------------------------------------------------------------

try:
    from . import ai_rag
except ImportError:
    import ai_rag


def _assistant_vendor_id(user: TokenPayload, requested_vendor_id: int | None) -> int:
    if user.role == "vendor":
        return user.id
    if requested_vendor_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="vendorId is required when an administrator uses the shopping assistant.",
        )
    return requested_vendor_id


@app.post("/ai/generate-description", tags=["Python AI"], summary="Generate a grounded product description")
async def generate_product_description(request: ProductContentRequest, _user: CurrentUser) -> dict[str, str]:
    return await ai_rag.generate_product_description(
        request.name.strip(),
        request.category.strip(),
        request.hints.strip()[:300],
    )


@app.post("/ai/generate-seo-content", tags=["Python AI"], summary="Generate grounded product SEO fields")
async def generate_seo_content(request: ProductContentRequest, _user: CurrentUser) -> dict[str, Any]:
    return await ai_rag.generate_seo_content(
        request.name.strip(),
        request.category.strip(),
        request.hints.strip(),
    )


@app.post("/ai/shopping-assistant", tags=["Python AI"], summary="Ask the vendor catalog assistant")
async def shopping_assistant(
    request: ShoppingAssistantRequest,
    user: CurrentUser,
    db: DBConn,
) -> dict[str, Any]:
    vendor_id = _assistant_vendor_id(user, request.vendorId)
    vendor_exists = db.execute("SELECT 1 FROM vendors WHERE id = ?", (vendor_id,)).fetchone()
    if not vendor_exists:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vendor account was not found.")

    history = [
        {
            "role": turn.role,
            "products": [product.model_dump() for product in turn.products],
        }
        for turn in request.conversationHistory[-4:]
    ]
    question = request.question.strip()
    results = ai_rag.retrieve_products(db, question, vendor_id, history)
    if results["constraints"]["count"]:
        answer = ai_rag.format_grounded_answer(question, results)
    else:
        answer, _provider = await ai_rag.generate_answer(question, results)

    if not results["products"] and results["totalMatched"] == 0:
        catalog_count = db.execute(
            "SELECT COUNT(*) AS count FROM products WHERE vendor_id = ?",
            (vendor_id,),
        ).fetchone()["count"]
        if catalog_count == 0:
            answer = "This vendor account has no products in its catalog yet. Add products to this catalog, then ask me to search them."

    sources = [
        {
            "productId": product["id"],
            "productName": product["name"],
            "category": product["category"],
            "price": product["price"],
            "stock": product["stock"],
            "vendor": product["vendor"],
            "unitsSold": product["unitsSold"],
        }
        for product in results["products"]
    ]
    return {"answer": answer, "products": results["products"][:6], "sources": sources}


@app.get("/ai/status", tags=["Python AI"], summary="Get the vendor-scoped Python RAG status")
def ai_status(
    user: CurrentUser,
    db: DBConn,
    vendor_id: int | None = Query(default=None, alias="vendorId", gt=0),
) -> dict[str, Any]:
    scoped_vendor_id = user.id if user.role == "vendor" else vendor_id
    if scoped_vendor_id is None:
        indexed_products = db.execute("SELECT COUNT(*) AS count FROM products").fetchone()["count"]
    else:
        indexed_products = db.execute(
            "SELECT COUNT(*) AS count FROM products WHERE vendor_id = ?",
            (scoped_vendor_id,),
        ).fetchone()["count"]
    provider, _api_key = ai_rag._configured_provider()
    return {
        "status": "online",
        "vectorStoreReady": indexed_products > 0,
        "indexedProducts": indexed_products,
        "llmProviderConfigured": provider is not None,
        "provider": f"{provider} + Python RAG" if provider else "Python Grounded Catalog RAG (Local)",
    }


@app.post("/ai/refresh-index", tags=["Python AI"], summary="Refresh the live vendor catalog index")
def refresh_ai_index(user: CurrentUser, db: DBConn) -> dict[str, Any]:
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden for this role.")
    count = db.execute("SELECT COUNT(*) AS count FROM products").fetchone()["count"]
    return {
        "success": True,
        "message": f"Python RAG reads all {count} live catalog products directly from SQLite.",
        "indexedProducts": count,
    }


# ---------------------------------------------------------------------------
# Endpoint 1 - GET /analytics/summary
# ---------------------------------------------------------------------------


@app.get(
    "/analytics/summary",
    response_model=SalesSummaryResponse,
    tags=["Analytics"],
    summary="Sales & Revenue Summary",
    description=(
        "Overall snapshot: total orders, total revenue, average order value, "
        "total units sold, unique products, and unique customers."
    ),
)
def get_sales_summary(_user: CurrentUser, db: DBConn) -> SalesSummaryResponse:
    orders = db.execute(
        "SELECT COUNT(*) AS totalOrders, "
        "COALESCE(SUM(total_amount), 0) AS totalRevenue, "
        "COALESCE(AVG(total_amount), 0) AS averageOrderValue "
        "FROM analytics_orders"
    ).fetchone()

    units = db.execute(
        "SELECT COALESCE(SUM(quantity), 0) AS totalProductsSold FROM analytics_order_items"
    ).fetchone()

    products = db.execute("SELECT COUNT(*) AS n FROM analytics_products").fetchone()
    customers = db.execute("SELECT COUNT(*) AS n FROM analytics_customers").fetchone()

    return SalesSummaryResponse(
        summary=SalesSummary(
            totalOrders=orders["totalOrders"],
            totalRevenue=round(orders["totalRevenue"], 2),
            averageOrderValue=round(orders["averageOrderValue"], 2),
            totalProductsSold=units["totalProductsSold"],
            totalProducts=products["n"],
            totalCustomers=customers["n"],
        )
    )


# ---------------------------------------------------------------------------
# Endpoint 2 - GET /analytics/sales-over-time
# ---------------------------------------------------------------------------


@app.get(
    "/analytics/sales-over-time",
    response_model=SalesOverTimeResponse,
    tags=["Analytics"],
    summary="Sales Over Time",
    description=(
        "Revenue, order count, and units broken down by granularity: "
        "daily (last N days), weekly (by day-of-week), or monthly (by calendar month)."
    ),
)
def get_sales_over_time(
    _user: CurrentUser,
    db: DBConn,
    granularity: Literal["daily", "weekly", "monthly"] = Query(
        default="daily", description="Aggregation granularity: daily | weekly | monthly"
    ),
    days: int = Query(
        default=90, ge=1, le=3650,
        description="For daily: number of most-recent days to return."
    ),
) -> SalesOverTimeResponse:
    if granularity == "daily":
        rows = db.execute(
            """
            SELECT o.order_date AS date,
                   SUM(o.total_amount)            AS revenue,
                   COUNT(DISTINCT o.order_id)     AS orders,
                   COALESCE(SUM(oi.quantity), 0)  AS purchases,
                   ROUND(COALESCE(AVG(o.total_amount), 0), 2) AS aov
            FROM analytics_orders o
            LEFT JOIN analytics_order_items oi ON oi.order_id = o.order_id
            GROUP BY o.order_date
            ORDER BY o.order_date ASC
            """
        ).fetchall()
        rows = rows[-days:]
        data = [
            {"date": r["date"], "revenue": round(r["revenue"] or 0, 2),
             "orders": r["orders"], "purchases": r["purchases"], "aov": round(r["aov"] or 0, 2)}
            for r in rows
        ]

    elif granularity == "weekly":
        rows = db.execute(
            """
            SELECT CASE strftime('%w', o.order_date)
                     WHEN '0' THEN 'Sunday'   WHEN '1' THEN 'Monday'
                     WHEN '2' THEN 'Tuesday'  WHEN '3' THEN 'Wednesday'
                     WHEN '4' THEN 'Thursday' WHEN '5' THEN 'Friday'
                     ELSE 'Saturday'
                   END AS period,
                   SUM(oi.quantity * oi.unit_price) AS revenue,
                   COUNT(DISTINCT o.order_id)       AS orders,
                   COALESCE(SUM(oi.quantity), 0)    AS purchases
            FROM analytics_orders o
            JOIN analytics_order_items oi ON oi.order_id = o.order_id
            GROUP BY strftime('%w', o.order_date)
            ORDER BY CAST(strftime('%w', o.order_date) AS INTEGER) ASC
            """
        ).fetchall()
        data = [
            {"period": r["period"], "revenue": round(r["revenue"] or 0, 2),
             "orders": r["orders"], "purchases": r["purchases"]}
            for r in rows
        ]

    else:  # monthly
        rows = db.execute(
            """
            SELECT CASE strftime('%m', o.order_date)
                     WHEN '01' THEN 'Jan' WHEN '02' THEN 'Feb' WHEN '03' THEN 'Mar'
                     WHEN '04' THEN 'Apr' WHEN '05' THEN 'May' WHEN '06' THEN 'Jun'
                     WHEN '07' THEN 'Jul' WHEN '08' THEN 'Aug' WHEN '09' THEN 'Sep'
                     WHEN '10' THEN 'Oct' WHEN '11' THEN 'Nov' ELSE 'Dec'
                   END AS period,
                   SUM(oi.quantity * oi.unit_price) AS revenue,
                   COUNT(DISTINCT o.order_id)       AS orders,
                   COALESCE(SUM(oi.quantity), 0)    AS purchases
            FROM analytics_orders o
            JOIN analytics_order_items oi ON oi.order_id = o.order_id
            GROUP BY strftime('%m', o.order_date)
            ORDER BY strftime('%m', o.order_date) ASC
            """
        ).fetchall()
        data = [
            {"period": r["period"], "revenue": round(r["revenue"] or 0, 2),
             "orders": r["orders"], "purchases": r["purchases"]}
            for r in rows
        ]

    return SalesOverTimeResponse(granularity=granularity, data=data, totalPoints=len(data))


# ---------------------------------------------------------------------------
# Endpoint 3 - GET /analytics/top-products
# ---------------------------------------------------------------------------


@app.get(
    "/analytics/top-products",
    response_model=TopProductsResponse,
    tags=["Analytics"],
    summary="Top-Selling Products",
    description="Top N products ranked by units sold or revenue. Optional category filter.",
)
def get_top_products(
    _user: CurrentUser,
    db: DBConn,
    limit: int = Query(default=10, ge=1, le=100, description="How many products to return (1-100)."),
    category: Optional[str] = Query(default=None, description="Filter by category (case-insensitive)."),
    sort_by: Literal["units_sold", "revenue"] = Query(
        default="units_sold", alias="sortBy",
        description="Sort by: units_sold | revenue"
    ),
) -> TopProductsResponse:
    order_clause = (
        "unitsSold DESC, revenue DESC" if sort_by == "units_sold"
        else "revenue DESC, unitsSold DESC"
    )
    base_sql = f"""
        SELECT p.product_id, p.product_name, p.category,
               SUM(oi.quantity)                  AS unitsSold,
               SUM(oi.quantity * oi.unit_price)  AS revenue
        FROM analytics_order_items oi
        JOIN analytics_products p ON p.product_id = oi.product_id
        {{where}}
        GROUP BY p.product_id
        ORDER BY {order_clause}, p.product_name ASC
        LIMIT ?
    """
    if category:
        rows = db.execute(
            base_sql.format(where="WHERE lower(p.category) = lower(?)"),
            (category, limit)
        ).fetchall()
    else:
        rows = db.execute(base_sql.format(where=""), (limit,)).fetchall()

    products = [
        {"product_id": r["product_id"], "product_name": r["product_name"],
         "category": r["category"], "unitsSold": r["unitsSold"] or 0,
         "revenue": round(r["revenue"] or 0, 2), "rank": idx + 1}
        for idx, r in enumerate(rows)
    ]
    return TopProductsResponse(limit=limit, category=category, sortBy=sort_by, products=products)

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
from typing import Annotated, Literal, Optional

from fastapi import Depends, FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# Matches the Express middleware/auth.js default secret
JWT_SECRET: str = os.getenv("JWT_SECRET", "shopsense-dev-secret")
JWT_ALGORITHM: str = "HS256"

# Shared SQLite database written by the Express server
_THIS_DIR = Path(__file__).parent
DB_PATH: Path = Path(
    os.getenv("DB_PATH", str(_THIS_DIR / ".." / "server" / "db" / "shopsense.db"))
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
    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
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

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI):
    print(f"[ShopSense Analytics] DB path : {DB_PATH}")
    print(f"[ShopSense Analytics] DB exists: {DB_PATH.exists()}")
    yield


app = FastAPI(
    title="ShopSense Analytics API",
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
    return {"status": "ok", "service": "ShopSense Analytics API", "version": "1.0.0"}


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

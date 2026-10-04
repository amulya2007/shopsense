"""FastAPI equivalents of the Express vendor API routes."""

import re
import secrets
import shutil
import sqlite3
import subprocess
import time
import os
from dataclasses import dataclass
from email import policy
from email.parser import BytesParser
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from jose import JWTError, jwt
from .database import DB_PATH

JWT_SECRET = os.getenv("JWT_SECRET", "shopsense-dev-secret")
JWT_ALGORITHM = "HS256"

try:
    import bcrypt
except ImportError:  # pragma: no cover - available in production deployments
    bcrypt = None


router = APIRouter(prefix="/vendor")
UPLOAD_DIRECTORY = Path(__file__).resolve().parent.parent / "server" / "uploads" / "products"
IMAGE_EXTENSIONS = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}
SEO_FIELDS = {
    "seo_title": ("seoTitle", 160),
    "short_description": ("shortDescription", 500),
    "meta_title": ("metaTitle", 160),
    "meta_description": ("metaDescription", 320),
    "seo_keywords": ("seoKeywords", 1000),
    "product_tags": ("productTags", 1000),
    "key_features": ("keyFeatures", 2000),
    "vendor_hints": ("vendorHints", 1000),
}
SYSTEM_DESCRIPTION_MARKERS = (
    "shopsense", "this listing", "this item specifically", "should not be confused",
    "catalog details", "product categories", "product name", "only details that appear",
    "internal data", "data limitations", "catalog/listing",
)
REQUIRED_SCHEMA = {
    "vendors": {"id", "full_name", "business_name", "email", "password", "phone",
                "business_address", "status", "joined_at"},
    "products": {"id", "vendor_id", "name", "description", "category", "price", "stock",
                 "image_url", "created_at", *SEO_FIELDS.keys()},
    "sales": {"id", "vendor_id", "product_id", "quantity", "amount", "sold_at"},
}


@dataclass
class TokenPayload:
    id: int
    role: str


def _error(code: int, message: str) -> JSONResponse:
    return JSONResponse(status_code=code, content={"error": message})


def _open_db():
    if not DB_PATH.exists():
        raise RuntimeError("Database unavailable")
    connection = sqlite3.connect(DB_PATH, check_same_thread=False)
    connection.row_factory = sqlite3.Row
    missing = []
    for table, required_columns in REQUIRED_SCHEMA.items():
        actual_columns = {
            row["name"] for row in connection.execute(f'PRAGMA table_info("{table}")')
        }
        if not actual_columns:
            missing.append(f"table {table}")
            continue
        missing.extend(
            f"column {table}.{column}"
            for column in sorted(required_columns - actual_columns)
        )
    if missing:
        connection.close()
        raise HTTPException(
            status_code=503,
            detail=f"Vendor API schema is incomplete: {', '.join(missing)}",
        )
    return connection


def _db():
    try:
        connection = _open_db()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail="Database unavailable") from exc
    try:
        yield connection
    finally:
        connection.close()


def _user(request: Request) -> TokenPayload | JSONResponse:
    authorization = request.headers.get("authorization", "")
    token = authorization[7:] if authorization.startswith("Bearer ") else ""
    if not token:
        return _error(401, "Missing token")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("role") != "vendor":
            return _error(403, "Forbidden for this role")
        return TokenPayload(id=payload["id"], role=payload["role"])
    except (JWTError, KeyError, TypeError, ValueError):
        return _error(401, "Invalid or expired token")


def _row(row: sqlite3.Row | None) -> dict[str, Any] | None:
    return dict(row) if row is not None else None


def _hash_password(password: str) -> str:
    if bcrypt is not None:
        return bcrypt.hashpw(password.encode(), bcrypt.gensalt(10)).decode()
    node = shutil.which("node")
    bcryptjs = Path(__file__).resolve().parent.parent / "server" / "node_modules" / "bcryptjs"
    if node and bcryptjs.exists():
        script = (
            "let s='';process.stdin.setEncoding('utf8');"
            "process.stdin.on('data',d=>s+=d);"
            f"process.stdin.on('end',()=>process.stdout.write(require({str(bcryptjs)!r}).hashSync(s,10)));"
        )
        result = subprocess.run(
            [node, "-e", script], input=password, text=True, capture_output=True,
            cwd=bcryptjs.parent.parent, check=False, timeout=10,
        )
        if result.returncode == 0:
            return result.stdout
    raise RuntimeError("No bcrypt implementation is available")


def _number(value: Any) -> float:
    if value is None or value is False:
        return 0.0
    if value is True:
        return 1.0
    if isinstance(value, str) and not value.strip():
        return 0.0
    try:
        return float(value)
    except (TypeError, ValueError):
        return float("nan")


def _whole_nonnegative(value: Any) -> bool:
    number = _number(value)
    return number.is_integer() and number >= 0


def _threshold(value: Any) -> int | None:
    if value is None:
        return 5
    number = _number(value)
    if number.is_integer() and 0 <= number <= 1_000_000:
        return int(number)
    return None


def _normalize_image_url(value: Any) -> str | None:
    image_url = str(value or "").strip()
    if not image_url:
        return ""
    if image_url.startswith("/"):
        return image_url
    if re.fullmatch(r"data:image/(?:jpeg|jpg|png|webp|gif);base64,[a-z0-9+/=]+", image_url, re.I):
        return image_url if len(image_url) <= 300_000 else None
    parsed = urlparse(image_url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return None
    if parsed.hostname.lower().endswith("google.com"):
        return None
    return image_url


def _seo_fields(body: dict[str, Any], existing: dict[str, Any] | None = None):
    existing = existing or {}
    fields = {}
    for column, (property_name, limit) in SEO_FIELDS.items():
        value = body.get(property_name, existing.get(column) or "")
        if not isinstance(value, str):
            return None, f"{property_name} must be text."
        if len(value) > limit:
            return None, f"{property_name} must be {limit} characters or fewer."
        fields[column] = value.strip()
    return fields, None


def _description(name: str, category: str) -> str:
    product = name.strip() or "This product"
    category = category.strip() or "general"
    return (
        f"{product} is a product designed for its intended everyday purpose.\n"
        f"It is a suitable choice when you need a product for this purpose in the {category} category.\n"
        "Review the listing details to confirm the specifications and compatibility you need."
    )


def _display_product(product: dict[str, Any]) -> dict[str, Any]:
    description = str(product.get("description") or "").lower()
    if any(marker in description for marker in SYSTEM_DESCRIPTION_MARKERS):
        product["description"] = _description(product.get("name", ""), product.get("category", ""))
    return product


def _filename(vendor_id: int, extension: str) -> str:
    return f"vendor-{vendor_id}-{int(time.time() * 1000)}-{secrets.randbelow(1_000_000_000)}{extension}"


async def _body(request: Request) -> dict[str, Any]:
    try:
        parsed = await request.json()
    except Exception:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _lookup_product(db: sqlite3.Connection, product_id: str, vendor_id: int):
    return db.execute(
        "SELECT * FROM products WHERE id = ? AND vendor_id = ?",
        (product_id, vendor_id),
    ).fetchone()


@router.post("/images")
async def upload_image(request: Request):
    user = _user(request)
    if isinstance(user, JSONResponse):
        return user
    try:
        content_type = request.headers.get("content-type", "")
        if not content_type.lower().startswith("multipart/form-data"):
            return _error(400, "Choose an image file to upload.")
        content_length = int(request.headers.get("content-length", "0") or 0)
        if content_length > 5 * 1024 * 1024 + 256 * 1024:
            return _error(400, "Image must be 5 MB or smaller.")
        raw = bytearray()
        async for chunk in request.stream():
            raw.extend(chunk)
            if len(raw) > 5 * 1024 * 1024 + 256 * 1024:
                return _error(400, "Image must be 5 MB or smaller.")
        parsed = BytesParser(policy=policy.default).parsebytes(
            f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode() + raw
        )
        upload = next(
            (
                part for part in parsed.iter_parts()
                if part.get_content_disposition() == "form-data"
                and part.get_param("name", header="content-disposition") == "image"
            ),
            None,
        )
        if upload is None or not upload.get_filename():
            return _error(400, "Choose an image file to upload.")
        if not upload.get_content_type().startswith("image/"):
            return _error(400, "Choose an image file to upload.")
        data = upload.get_payload(decode=True) or b""
        if len(data) > 5 * 1024 * 1024:
            return _error(400, "Image must be 5 MB or smaller.")
        original_name = upload.get_filename() or ""
        extension = Path(original_name).suffix.lower() or ".jpg"
        UPLOAD_DIRECTORY.mkdir(parents=True, exist_ok=True)
        filename = _filename(user.id, extension)
        (UPLOAD_DIRECTORY / filename).write_bytes(data)
        return JSONResponse(status_code=201, content={"imageUrl": f"/uploads/products/{filename}"})
    except Exception:
        return _error(400, "Unable to upload this image. Please choose a valid image file.")


def _page_preview(html: str, page_url: str) -> str | None:
    patterns = (
        r'<meta[^>]+(?:property|name)=["\'](?:og:image|twitter:image)["\'][^>]+content=["\']([^"\']+)["\']',
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\'](?:og:image|twitter:image)["\']',
    )
    for pattern in patterns:
        match = re.search(pattern, html, re.I)
        if match:
            return urljoin(page_url, match.group(1).replace("&amp;", "&"))
    return None


@router.post("/images/from-page")
async def upload_image_from_page(request: Request):
    user = _user(request)
    if isinstance(user, JSONResponse):
        return user
    body = await _body(request)
    page_url = str(body.get("url") or "").strip()
    parsed = urlparse(page_url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return _error(400, "Unable to open that webpage. Use a public image page URL.")
    headers = {"User-Agent": "Mozilla/5.0 (compatible; ShopSense/1.0)"}
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True, headers=headers) as client:
            page = await client.get(page_url)
            if not page.is_success or "text/html" not in page.headers.get("content-type", ""):
                return _error(400, "This URL is not an image webpage. Paste a direct image URL instead.")
            preview_url = _page_preview(page.text, page_url)
            if not preview_url:
                return _error(400, "No public preview image was found on that page. Upload the image file instead.")
            image_response = await client.get(preview_url)
        content_type = image_response.headers.get("content-type", "").split(";")[0].lower()
        length = int(image_response.headers.get("content-length", "0") or 0)
        data = image_response.content
        if (
            not image_response.is_success or content_type not in IMAGE_EXTENSIONS
            or length > 5 * 1024 * 1024 or len(data) > 5 * 1024 * 1024
        ):
            raise ValueError("invalid image")
        UPLOAD_DIRECTORY.mkdir(parents=True, exist_ok=True)
        filename = _filename(user.id, IMAGE_EXTENSIONS[content_type])
        (UPLOAD_DIRECTORY / filename).write_bytes(data)
        return JSONResponse(status_code=201, content={"imageUrl": f"/uploads/products/{filename}"})
    except Exception:
        return _error(400, "The page preview could not be downloaded. Download the image first, then drag it here.")


@router.get("/dashboard")
def dashboard(request: Request, db: sqlite3.Connection = Depends(_db)):
    user = _user(request)
    if isinstance(user, JSONResponse):
        return user
    vendor_id = user.id
    products_listed = db.execute(
        "SELECT COUNT(*) AS c FROM products WHERE vendor_id = ?", (vendor_id,)
    ).fetchone()["c"]
    sales = db.execute(
        """SELECT COALESCE(SUM(quantity),0) AS totalSales,
                  COALESCE(SUM(amount),0) AS totalRevenue, COUNT(*) AS totalTransactions
           FROM sales WHERE vendor_id = ?""",
        (vendor_id,),
    ).fetchone()
    products = [
        _display_product(dict(row)) for row in db.execute(
            "SELECT * FROM products WHERE vendor_id = ? ORDER BY created_at DESC", (vendor_id,)
        ).fetchall()
    ]
    return {
        "totalSales": sales["totalSales"], "totalRevenue": sales["totalRevenue"],
        "totalTransactions": sales["totalTransactions"], "productsListed": products_listed,
        "recentProducts": products,
    }


@router.get("/products")
def list_products(request: Request, db: sqlite3.Connection = Depends(_db)):
    user = _user(request)
    if isinstance(user, JSONResponse):
        return user
    return [
        _display_product(dict(row)) for row in db.execute(
            "SELECT * FROM products WHERE vendor_id = ? ORDER BY created_at DESC", (user.id,)
        ).fetchall()
    ]


@router.get("/products/suggestions")
def product_suggestions(request: Request, db: sqlite3.Connection = Depends(_db)):
    user = _user(request)
    if isinstance(user, JSONResponse):
        return user
    query = request.query_params.get("q", "").lower().strip()
    if not query:
        return []
    return [
        dict(row) for row in db.execute(
            """SELECT DISTINCT name, category, price, stock, 'catalog' AS origin
               FROM products WHERE vendor_id = ? AND lower(name) LIKE ? LIMIT 5""",
            (user.id, f"%{query}%"),
        ).fetchall()
    ]


def _stock_status(stock: int, threshold: int) -> str:
    if stock <= 0:
        return "out_of_stock"
    if stock <= threshold:
        return "low_stock"
    return "in_stock"


@router.get("/inventory")
def inventory(request: Request, db: sqlite3.Connection = Depends(_db)):
    user = _user(request)
    if isinstance(user, JSONResponse):
        return user
    threshold = _threshold(request.query_params.get("lowThreshold"))
    if threshold is None:
        return _error(400, "lowThreshold must be a non-negative whole number")
    products = [
        {
            **dict(row), "lowStockThreshold": threshold,
            "status": _stock_status(row["stock"], threshold),
        }
        for row in db.execute(
            """SELECT id AS productId, name AS productName, category, price, stock
               FROM products WHERE vendor_id = ? ORDER BY stock ASC, name ASC""",
            (user.id,),
        ).fetchall()
    ]
    return {
        "lowStockThreshold": threshold,
        "products": products,
        "summary": {
            "totalProducts": len(products),
            "totalStock": sum(product["stock"] for product in products),
            "lowStockProducts": sum(product["status"] == "low_stock" for product in products),
            "outOfStockProducts": sum(product["status"] == "out_of_stock" for product in products),
        },
    }


@router.get("/inventory/alerts")
def inventory_alerts(request: Request, db: sqlite3.Connection = Depends(_db)):
    user = _user(request)
    if isinstance(user, JSONResponse):
        return user
    threshold = _threshold(request.query_params.get("lowThreshold"))
    if threshold is None:
        return _error(400, "lowThreshold must be a non-negative whole number")
    alerts = []
    for row in db.execute(
        """SELECT id AS productId, name AS productName, stock FROM products
           WHERE vendor_id = ? AND stock <= ? ORDER BY stock ASC, name ASC""",
        (user.id, threshold),
    ).fetchall():
        status = "out_of_stock" if row["stock"] <= 0 else "low_stock"
        alerts.append({
            **dict(row), "lowStockThreshold": threshold, "status": status,
            "message": (
                f"{row['productName']} is out of stock." if status == "out_of_stock"
                else f"{row['productName']} is low in stock ({row['stock']} remaining)."
            ),
        })
    return {
        "lowStockThreshold": threshold,
        "alertCount": len(alerts),
        "outOfStockCount": sum(alert["status"] == "out_of_stock" for alert in alerts),
        "lowStockCount": sum(alert["status"] == "low_stock" for alert in alerts),
        "alerts": alerts,
    }


@router.post("/products")
async def create_product(request: Request, db: sqlite3.Connection = Depends(_db)):
    user = _user(request)
    if isinstance(user, JSONResponse):
        return user
    body = await _body(request)
    seo, error = _seo_fields(body)
    if error:
        return _error(400, error)
    name = str(body.get("name") or "").strip()
    description = str(body.get("description") or "").strip()
    category = str(body.get("category") or "").strip()
    price = _number(body.get("price"))
    stock = body.get("stock")
    if not name or not description or not category or "price" not in body or body.get("price") == "":
        return _error(400, "Missing required fields")
    if not (price >= 0 and price != float("inf")):
        return _error(400, "Price must be a non-negative number")
    image_url = _normalize_image_url(body.get("imageUrl"))
    if image_url is None:
        return _error(400, "Use a direct http(s) image URL, not a Google Search link.")
    if stock is not None and not _whole_nonnegative(stock):
        return _error(400, "Stock must be a non-negative whole number")
    columns = [
        "vendor_id", "name", "description", "category", "price", "stock", "image_url",
        *SEO_FIELDS.keys(),
    ]
    values = [
        user.id, name, description, category, price,
        0 if stock is None or stock == "" else int(_number(stock)), image_url,
        *(seo[column] for column in SEO_FIELDS),
    ]
    try:
        cursor = db.execute(
            f"INSERT INTO products ({', '.join(columns)}) VALUES ({', '.join('?' for _ in values)})",
            values,
        )
        db.commit()
        product = db.execute("SELECT * FROM products WHERE id = ?", (cursor.lastrowid,)).fetchone()
        return JSONResponse(status_code=201, content=dict(product))
    except sqlite3.Error:
        db.rollback()
        return _error(500, "Unable to save this product. Please try again.")


@router.put("/products/{product_id}")
async def update_product(product_id: str, request: Request, db: sqlite3.Connection = Depends(_db)):
    user = _user(request)
    if isinstance(user, JSONResponse):
        return user
    product = _lookup_product(db, product_id, user.id)
    if product is None:
        return _error(404, "Product not found")
    body = await _body(request)
    seo, error = _seo_fields(body, dict(product))
    if error:
        return _error(400, error)
    image_url = product["image_url"]
    provided_image = body.get("imageUrl")
    if provided_image is not None and str(provided_image).strip():
        image_url = _normalize_image_url(provided_image)
        if image_url is None:
            return _error(400, "Use a direct http(s) image URL, not a Google Search link.")
    stock = body.get("stock")
    if stock is not None and not _whole_nonnegative(stock):
        return _error(400, "Stock must be a non-negative whole number")
    price = _number(body["price"]) if "price" in body else product["price"]
    columns = [
        "name", "description", "category", "price", "stock", "image_url", *SEO_FIELDS.keys(),
    ]
    values = [
        body.get("name") if body.get("name") is not None else product["name"],
        body.get("description") if body.get("description") is not None else product["description"],
        body.get("category") if body.get("category") is not None else product["category"], price,
        int(_number(stock)) if "stock" in body else product["stock"], image_url,
        *(seo[column] for column in SEO_FIELDS), product["id"],
    ]
    db.execute(
        f"UPDATE products SET {', '.join(column + ' = ?' for column in columns)} WHERE id = ?",
        values,
    )
    db.commit()
    return dict(db.execute("SELECT * FROM products WHERE id = ?", (product["id"],)).fetchone())


@router.patch("/products/{product_id}/stock")
async def set_stock(product_id: str, request: Request, db: sqlite3.Connection = Depends(_db)):
    user = _user(request)
    if isinstance(user, JSONResponse):
        return user
    body = await _body(request)
    if not _whole_nonnegative(body.get("stock")):
        return _error(400, "Stock must be a non-negative whole number")
    product = db.execute(
        "SELECT id, name FROM products WHERE id = ? AND vendor_id = ?", (product_id, user.id)
    ).fetchone()
    if product is None:
        return _error(404, "Product not found")
    db.execute("UPDATE products SET stock = ? WHERE id = ?", (int(_number(body["stock"])), product["id"]))
    db.commit()
    updated = db.execute(
        "SELECT id AS productId, name AS productName, stock FROM products WHERE id = ?",
        (product["id"],),
    ).fetchone()
    return {"message": "Stock updated successfully", **dict(updated)}


@router.post("/products/{product_id}/stock-adjustments")
async def adjust_stock(product_id: str, request: Request, db: sqlite3.Connection = Depends(_db)):
    user = _user(request)
    if isinstance(user, JSONResponse):
        return user
    body = await _body(request)
    change = _number(body.get("change"))
    if not change.is_integer() or change == 0:
        return _error(400, "change must be a non-zero whole number")
    product = db.execute(
        "SELECT id, name, stock FROM products WHERE id = ? AND vendor_id = ?", (product_id, user.id)
    ).fetchone()
    if product is None:
        return _error(404, "Product not found")
    updated_stock = product["stock"] + int(change)
    if updated_stock < 0:
        return _error(400, "Stock adjustment cannot reduce stock below zero")
    db.execute("UPDATE products SET stock = ? WHERE id = ?", (updated_stock, product["id"]))
    db.commit()
    return {
        "message": "Stock adjusted successfully", "productId": product["id"],
        "productName": product["name"], "previousStock": product["stock"],
        "change": int(change), "currentStock": updated_stock,
    }


@router.delete("/products/{product_id}")
def delete_product(product_id: str, request: Request, db: sqlite3.Connection = Depends(_db)):
    user = _user(request)
    if isinstance(user, JSONResponse):
        return user
    product = _lookup_product(db, product_id, user.id)
    if product is None:
        return _error(404, "Product not found")
    db.execute("DELETE FROM products WHERE id = ?", (product["id"],))
    db.commit()
    return {"message": "Product deleted"}


@router.get("/analytics")
def analytics(request: Request, db: sqlite3.Connection = Depends(_db)):
    user = _user(request)
    if isinstance(user, JSONResponse):
        return user
    by_category = [
        dict(row) for row in db.execute(
            """SELECT category, COUNT(*) AS productCount, COALESCE(SUM(stock),0) AS totalStock
               FROM products WHERE vendor_id = ? GROUP BY category""",
            (user.id,),
        ).fetchall()
    ]
    sales = [
        dict(row) for row in db.execute(
            """SELECT date(sold_at) AS day, SUM(amount) AS revenue FROM sales
               WHERE vendor_id = ? GROUP BY day ORDER BY day DESC LIMIT 14""",
            (user.id,),
        ).fetchall()
    ]
    return {"byCategory": by_category, "salesOverTime": sales}


@router.get("/analytics/historical")
def historical_analytics(request: Request, db: sqlite3.Connection = Depends(_db)):
    user = _user(request)
    if isinstance(user, JSONResponse):
        return user
    revenue = db.execute(
        "SELECT COALESCE(SUM(amount),0) AS totalRevenue FROM sales WHERE vendor_id = ?",
        (user.id,),
    ).fetchone()["totalRevenue"]
    tables = {
        row["name"] for row in db.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
    }
    sales_columns = {row["name"] for row in db.execute("PRAGMA table_info(sales)")}
    if "order_id" in sales_columns:
        average_order = db.execute(
            """SELECT AVG(total) FROM (SELECT SUM(amount) AS total FROM sales
               WHERE vendor_id = ? GROUP BY order_id)""",
            (user.id,),
        ).fetchone()[0]
    else:
        average_order = db.execute(
            "SELECT AVG(amount) FROM sales WHERE vendor_id = ?", (user.id,)
        ).fetchone()[0]
    repeat_rate = 0
    if {"orders", "customers"} <= tables:
        repeat_count = db.execute(
            """SELECT COUNT(*) FROM (SELECT customer_id FROM orders WHERE vendor_id = ?
               GROUP BY customer_id HAVING COUNT(*) > 1)""",
            (user.id,),
        ).fetchone()[0]
        total_customers = db.execute("SELECT COUNT(*) FROM customers").fetchone()[0]
        repeat_rate = repeat_count / total_customers if total_customers else 0
    if "order_items" in tables:
        top_products = [
            dict(row) for row in db.execute(
                """SELECT oi.product_id, p.name, SUM(oi.quantity) AS quantity_sold
                   FROM order_items oi JOIN products p ON oi.product_id = p.id
                   WHERE p.vendor_id = ? GROUP BY oi.product_id
                   ORDER BY quantity_sold DESC LIMIT 5""",
                (user.id,),
            ).fetchall()
        ]
    else:
        top_products = [
            dict(row) for row in db.execute(
                """SELECT s.product_id, p.name, SUM(s.quantity) AS quantity_sold
                   FROM sales s JOIN products p ON s.product_id = p.id
                   WHERE s.vendor_id = ? GROUP BY s.product_id
                   ORDER BY quantity_sold DESC LIMIT 5""",
                (user.id,),
            ).fetchall()
        ]
    sales_over_time = [
        dict(row) for row in db.execute(
            """SELECT date(sold_at) AS day, SUM(amount) AS revenue FROM sales
               WHERE vendor_id = ? GROUP BY day ORDER BY day DESC LIMIT 14""",
            (user.id,),
        ).fetchall()
    ]
    return {
        "totalRevenue": revenue, "averageOrderValue": average_order,
        "repeatCustomerRate": repeat_rate, "topProducts": top_products,
        "salesOverTime": sales_over_time,
    }


@router.get("/profile")
def get_profile(request: Request, db: sqlite3.Connection = Depends(_db)):
    user = _user(request)
    if isinstance(user, JSONResponse):
        return user
    vendor = db.execute(
        """SELECT id, full_name, business_name, email, phone, business_address, status, joined_at
           FROM vendors WHERE id = ?""",
        (user.id,),
    ).fetchone()
    return _row(vendor)


@router.put("/profile")
async def update_profile(request: Request, db: sqlite3.Connection = Depends(_db)):
    user = _user(request)
    if isinstance(user, JSONResponse):
        return user
    body = await _body(request)
    vendor = db.execute("SELECT * FROM vendors WHERE id = ?", (user.id,)).fetchone()
    if vendor is None:
        return _error(404, "Vendor not found")
    password_hash = vendor["password"]
    password = body.get("password")
    if password:
        if not isinstance(password, str):
            return _error(400, "Password must be at least 6 characters")
        if len(password) < 6:
            return _error(400, "Password must be at least 6 characters")
        try:
            password_hash = _hash_password(password)
        except (OSError, RuntimeError, subprocess.SubprocessError):
            return _error(500, "Unable to update this profile.")
    db.execute(
        """UPDATE vendors SET full_name=?, business_name=?, phone=?, business_address=?, password=?
           WHERE id=?""",
        (
            body.get("fullName") if body.get("fullName") is not None else vendor["full_name"],
            body.get("businessName") if body.get("businessName") is not None else vendor["business_name"],
            body.get("phone") if body.get("phone") is not None else vendor["phone"],
            body.get("businessAddress") if body.get("businessAddress") is not None else vendor["business_address"],
            password_hash, vendor["id"],
        ),
    )
    db.commit()
    updated = db.execute(
        """SELECT id, full_name, business_name, email, phone, business_address, status, joined_at
           FROM vendors WHERE id = ?""",
        (vendor["id"],),
    ).fetchone()
    return {"message": "Profile updated", "vendor": dict(updated)}

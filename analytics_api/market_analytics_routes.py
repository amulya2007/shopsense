"""Marketplace and business analytics routes, ported from the Express API.

Mount this router with ``prefix="/api/analytics"``. The historical analytics
endpoints in :mod:`analytics_api.main` remain separate.
"""

from __future__ import annotations

import csv
import io
import math
import re
import zipfile
from collections import Counter, defaultdict
from datetime import date, datetime
from pathlib import Path
from typing import Any
from xml.etree import ElementTree

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse, Response

from .main import CurrentUser, DBConn, TokenPayload

router = APIRouter()
_DATASET_DIR = Path(__file__).resolve().parent.parent / "dataset"
_MONTH_LABELS = {
    "01": "Jan", "02": "Feb", "03": "Mar", "04": "Apr",
    "05": "May", "06": "Jun", "07": "Jul", "08": "Aug",
    "09": "Sep", "10": "Oct", "11": "Nov", "12": "Dec",
}
_WEEKDAY_LABELS = ("Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday")


def _dict(row: Any) -> dict[str, Any]:
    return dict(row) if row is not None else {}


def _rows(cursor: Any) -> list[dict[str, Any]]:
    return [_dict(row) for row in cursor.fetchall()]


def _one(db: Any, sql: str, params: tuple[Any, ...] = ()) -> dict[str, Any]:
    return _dict(db.execute(sql, params).fetchone())


def _bounded(value: Any, fallback: float, minimum: float, maximum: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        return fallback
    if not math.isfinite(number):
        return fallback
    return min(maximum, max(minimum, number))


def _query_value(query: Any, key: str, default: Any = None) -> Any:
    value = query.get(key, default)
    return value if isinstance(value, str) else default


def _scope_vendor_id(user: TokenPayload, query: Any) -> int:
    value = _query_value(query, "vendorId")
    if user.role == "admin" and value:
        try:
            return int(float(value))
        except (TypeError, ValueError, OverflowError):
            return 0
    return user.id


def _vendor_id(user: TokenPayload, requested: str | None) -> int | float:
    if user.role != "admin" or not requested:
        return user.id
    try:
        return float(requested)
    except (TypeError, ValueError, OverflowError):
        return 0


def _scope(query: Any, default: str) -> str:
    return str(_query_value(query, "scope", default) or default).strip().lower()


def _support_options(query: Any) -> tuple[float, float]:
    return (
        _bounded(_query_value(query, "minSupport"), 0.0002, 0, 1),
        _bounded(_query_value(query, "minConfidence"), 0.1, 0, 1),
    )


def _normalized_name(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()


def _category_key(value: Any) -> str:
    return str(value or "uncategorized").strip().lower() or "uncategorized"


def _observed_days(first: Any, last: Any) -> int:
    try:
        start = date.fromisoformat(str(first)[:10])
        end = date.fromisoformat(str(last)[:10])
    except (TypeError, ValueError):
        return 365
    return max(1, (end - start).days + 1)


def _historical_products(db: Any) -> dict[str, Any]:
    history = _rows(db.execute("""
        SELECT p.product_id, p.product_name, p.category, p.price, p.stock,
               COALESCE(SUM(oi.quantity), 0) AS unitsSold,
               MIN(o.order_date) AS firstSaleDate,
               MAX(o.order_date) AS lastSaleDate,
               COUNT(DISTINCT o.order_id) AS orderCount
        FROM analytics_products p
        LEFT JOIN analytics_order_items oi ON oi.product_id = p.product_id
        LEFT JOIN analytics_orders o ON o.order_id = oi.order_id
        GROUP BY p.product_id
    """))
    by_id: dict[str, dict[str, Any]] = {}
    by_name: dict[str, dict[str, Any]] = {}
    totals: dict[str, dict[str, Any]] = {}
    for product in history:
        product["observedDays"] = _observed_days(
            product["firstSaleDate"] or "2026-01-01",
            product["lastSaleDate"] or "2026-12-31",
        )
        by_id[str(product["product_id"])] = product
        by_name[_normalized_name(product["product_name"])] = product
        key = _category_key(product["category"])
        total = totals.setdefault(key, {"units": 0, "products": 0, "days": 0})
        total["units"] += float(product["unitsSold"] or 0)
        total["products"] += 1
        total["days"] = max(total["days"], product["observedDays"])
    return {
        "list": history,
        "byId": by_id,
        "byName": by_name,
        "categoryTotals": totals,
        "categories": sorted({product["category"] for product in history}),
    }


def _association_data(db: Any) -> dict[str, Any]:
    product_categories = {
        str(row["product_id"]): row["category"]
        for row in _rows(db.execute("SELECT product_id, category FROM analytics_products"))
    }
    transactions: dict[Any, dict[str, str]] = {}
    for row in _rows(db.execute("""
        SELECT oi.order_id, oi.product_id, p.product_name
        FROM analytics_order_items oi
        JOIN analytics_products p ON p.product_id = oi.product_id
        ORDER BY oi.order_id, oi.product_id
    """)):
        transactions.setdefault(row["order_id"], {})[str(row["product_id"])] = row["product_name"]

    item_counts: Counter[str] = Counter()
    pair_counts: Counter[tuple[str, str]] = Counter()
    category_counts: Counter[str] = Counter()
    category_pair_counts: Counter[tuple[str, str]] = Counter()
    product_names: dict[str, str] = {}
    for items in transactions.values():
        product_ids = sorted(items)
        categories = sorted({product_categories.get(item) for item in product_ids if product_categories.get(item)})
        for product_id in product_ids:
            item_counts[product_id] += 1
            product_names[product_id] = items[product_id]
        for left in range(len(product_ids)):
            for right in range(left + 1, len(product_ids)):
                pair_counts[(product_ids[left], product_ids[right])] += 1
        for category in categories:
            category_counts[category] += 1
        for left in range(len(categories)):
            for right in range(left + 1, len(categories)):
                category_pair_counts[(categories[left], categories[right])] += 1
    return {
        "transactionCount": len(transactions),
        "itemCounts": item_counts,
        "pairCounts": pair_counts,
        "productNames": product_names,
        "categoryCounts": category_counts,
        "categoryPairCounts": category_pair_counts,
    }


def _frequent_patterns(data: dict[str, Any], minimum_support: float) -> dict[str, Any]:
    count = data["transactionCount"]
    if not count:
        return {"transactionCount": 0, "patterns": [], "categoryPatterns": []}
    patterns = []
    for (first, second), absolute in data["pairCounts"].items():
        relative = absolute / count
        if relative >= minimum_support:
            names = [data["productNames"].get(first), data["productNames"].get(second)]
            patterns.append({
                "productIds": [first, second], "itemset": names,
                "absoluteSupport": absolute, "relativeSupport": relative,
            })
    patterns.sort(key=lambda item: (-item["absoluteSupport"], " ".join(item["itemset"])))
    category_patterns = [{
        "categories": [left, right], "itemset": f"{left} + {right}",
        "absoluteSupport": absolute, "relativeSupport": absolute / count,
    } for (left, right), absolute in data["categoryPairCounts"].items()]
    category_patterns.sort(key=lambda item: -item["absoluteSupport"])
    return {"transactionCount": count, "patterns": patterns, "categoryPatterns": category_patterns}


def _association_rules(
    data: dict[str, Any], minimum_support: float, minimum_confidence: float
) -> dict[str, Any]:
    count = data["transactionCount"]
    if not count:
        return {"transactionCount": 0, "rules": [], "categoryRules": []}
    rules = []
    for (first, second), absolute in data["pairCounts"].items():
        relative = absolute / count
        if relative < minimum_support:
            continue
        for antecedent, consequent in ((first, second), (second, first)):
            confidence = absolute / (data["itemCounts"].get(antecedent) or 1)
            if confidence >= minimum_confidence:
                rules.append({
                    "antecedent": data["productNames"].get(antecedent),
                    "consequent": data["productNames"].get(consequent),
                    "antecedentId": antecedent, "consequentId": consequent,
                    "absoluteSupport": absolute, "relativeSupport": relative,
                    "confidence": confidence,
                })
    rules.sort(key=lambda item: (-item["confidence"], -item["absoluteSupport"], item["antecedent"]))
    category_rules = []
    for (first, second), absolute in data["categoryPairCounts"].items():
        relative = absolute / count
        for antecedent, consequent in ((first, second), (second, first)):
            category_rules.append({
                "antecedent": antecedent, "consequent": consequent,
                "absoluteSupport": absolute, "relativeSupport": relative,
                "confidence": absolute / (data["categoryCounts"].get(antecedent) or 1),
            })
    category_rules.sort(key=lambda item: (-item["confidence"], -item["absoluteSupport"]))
    return {"transactionCount": count, "rules": rules, "categoryRules": category_rules}


def _forecast_status(stock: float, demand: float, low: float, medium: float) -> str:
    if demand > stock:
        return "restock_required"
    if stock <= low or stock - demand <= 0:
        return "low_stock_risk"
    if stock <= medium or stock - demand <= low:
        return "medium_risk"
    return "healthy"


def _xslx_rows(filename: str) -> list[dict[str, str]]:
    """Read the first worksheet as string-valued row dictionaries (XLSX subset)."""
    file_path = _DATASET_DIR / filename
    with zipfile.ZipFile(file_path) as archive:
        workbook = ElementTree.fromstring(archive.read("xl/workbook.xml"))
        ns = {
            "m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
            "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
            "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
        }
        relationship = workbook.find("m:sheets/m:sheet", ns)
        if relationship is None:
            return []
        rel_id = relationship.attrib[f"{{{ns['r']}}}id"]
        rels = ElementTree.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        target = next(
            rel.attrib["Target"] for rel in rels.findall("rel:Relationship", ns)
            if rel.attrib["Id"] == rel_id
        )
        sheet_path = target.lstrip("/") if target.startswith("/") else f"xl/{target}"
        shared_strings: list[str] = []
        if "xl/sharedStrings.xml" in archive.namelist():
            strings = ElementTree.fromstring(archive.read("xl/sharedStrings.xml"))
            shared_strings = [
                "".join(node.itertext())
                for node in strings.findall("m:si", ns)
            ]
        sheet = ElementTree.fromstring(archive.read(sheet_path))

    def column_index(reference: str) -> int:
        result = 0
        for char in re.match(r"[A-Z]+", reference).group(0):
            result = result * 26 + ord(char) - ord("A") + 1
        return result - 1

    parsed: list[list[str]] = []
    for row in sheet.findall(".//m:sheetData/m:row", ns):
        values: list[str] = []
        for cell in row.findall("m:c", ns):
            while len(values) <= column_index(cell.attrib["r"]):
                values.append("")
            value = cell.find("m:v", ns)
            content = "" if value is None else value.text or ""
            if cell.attrib.get("t") == "s" and content:
                content = shared_strings[int(content)]
            elif cell.attrib.get("t") == "inlineStr":
                content = "".join(cell.itertext())
            values[column_index(cell.attrib["r"])] = content
        parsed.append(values)
    if not parsed:
        return []
    headers = parsed[0]
    return [
        {header: values[index] if index < len(values) else "" for index, header in enumerate(headers) if header}
        for values in parsed[1:] if any(values)
    ]


def _csv_response(rows: list[list[Any]], filename: str) -> Response:
    stream = io.StringIO(newline="")
    writer = csv.writer(stream, lineterminator="\r\n", quoting=csv.QUOTE_ALL)
    writer.writerows(rows)
    return Response(
        stream.getvalue(),
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-cache, no-store, must-revalidate",
        },
    )


@router.get("/inventory")
def inventory(
    user: CurrentUser, db: DBConn,
    lowThreshold: str | None = None, mediumThreshold: str | None = None,
    scope: str = "all", category: str | None = None, search: str | None = None,
) -> dict[str, Any]:
    low = _bounded(lowThreshold, 5, 0, 1_000_000)
    medium = max(low, _bounded(mediumThreshold, 20, 0, 1_000_000))
    scope = scope.strip().lower()
    category = (category or "").strip()
    search = (search or "").strip().lower()
    catalog = _rows(db.execute("""
        SELECT id AS product_id, name AS product_name, category, price, stock, 'catalog' AS origin
        FROM products WHERE vendor_id = ? ORDER BY stock ASC, name ASC
    """, (user.id,)))
    products: list[dict[str, Any]]
    if scope == "catalog":
        products, total = catalog, len(catalog)
    elif scope == "dataset":
        where, params = [], []
        if category:
            where.append("lower(category) = lower(?)"); params.append(category)
        if search:
            where.append("(lower(product_name) LIKE ? OR lower(product_id) LIKE ?)")
            params.extend((f"%{search}%", f"%{search}%"))
        clause = " WHERE " + " AND ".join(where) if where else ""
        total = _one(db, f"SELECT COUNT(*) AS total FROM analytics_products{clause}", tuple(params))["total"]
        products = _rows(db.execute(
            "SELECT product_id, product_name, category, price, stock, 'dataset' AS origin "
            f"FROM analytics_products{clause} ORDER BY stock ASC, product_name ASC LIMIT 100",
            tuple(params),
        ))
    elif catalog:
        products, total = catalog, len(catalog)
    else:
        where, params = [], []
        if category:
            where.append("lower(category) = lower(?)"); params.append(category)
        clause = " WHERE " + " AND ".join(where) if where else ""
        total = _one(db, f"SELECT COUNT(*) AS total FROM analytics_products{clause}", tuple(params))["total"]
        products = _rows(db.execute(
            "SELECT product_id, product_name, category, price, stock, 'dataset' AS origin "
            f"FROM analytics_products{clause} ORDER BY stock ASC, product_name ASC LIMIT 50",
            tuple(params),
        ))
    enriched = [
        {**product, "status": "out_of_stock" if product["stock"] <= 0 else
         "low_stock" if product["stock"] <= low else "healthy_stock"}
        for product in products
    ]
    counted = catalog if scope == "catalog" or (scope == "all" and catalog) else enriched
    counts = {"out_of_stock": 0, "low_stock": 0, "healthy_stock": 0, "totalStock": 0}
    for product in counted:
        status = ("out_of_stock" if product["stock"] <= 0 else
                  "low_stock" if product["stock"] <= low else "healthy_stock")
        counts[status] += 1
        counts["totalStock"] += product["stock"]
    source = "live_catalog" if scope == "catalog" or (scope not in ("dataset",) and catalog) else (
        "historical_dataset" if scope == "dataset" else "historical_sample"
    )
    return {
        "dataSource": source,
        "thresholds": {"lowThreshold": low, "mediumThreshold": medium},
        "summary": {
            "totalProducts": total, "displayedProducts": len(enriched),
            "totalStock": counts["totalStock"], "outOfStock": counts["out_of_stock"],
            "lowStock": counts["low_stock"], "healthyStock": counts["healthy_stock"],
            "requiringRestock": counts["out_of_stock"] + counts["low_stock"],
        },
        "products": enriched,
    }


@router.get("/historical-summary")
def historical_summary(_user: CurrentUser, db: DBConn) -> dict[str, Any]:
    products = _one(db, "SELECT COUNT(*) AS totalProducts FROM analytics_products")
    customers = _one(db, "SELECT COUNT(*) AS totalCustomers FROM analytics_customers")
    sales = _one(db, "SELECT COUNT(*) AS totalOrders, COALESCE(SUM(total_amount), 0) AS totalRevenue FROM analytics_orders")
    return {**products, **customers, **sales}


@router.get("/customers")
def customers(
    _user: CurrentUser,
    db: DBConn,
    highSpendThreshold: str | None = None,
    mediumSpendThreshold: str | None = None,
) -> dict[str, Any]:
    high = _bounded(highSpendThreshold, 50_000, 1_000, 1_000_000)
    medium = _bounded(mediumSpendThreshold, 20_000, 100, high)
    records = _rows(db.execute("""
        SELECT c.customer_id, c.customer_name, c.email, COUNT(o.order_id) AS orderCount,
               COALESCE(SUM(o.total_amount), 0) AS totalSpending,
               COALESCE(AVG(o.total_amount), 0) AS averageOrderValue,
               MAX(o.order_date) AS lastOrderDate
        FROM analytics_customers c LEFT JOIN analytics_orders o ON o.customer_id = c.customer_id
        GROUP BY c.customer_id
        ORDER BY totalSpending DESC, orderCount DESC, c.customer_name ASC
    """))
    tier_summary = {name: {"count": 0, "totalSpend": 0, "orders": 0} for name in ("high", "medium", "low")}
    categorized = []
    for row in records:
        code = "high" if row["totalSpending"] >= high else "medium" if row["totalSpending"] >= medium else "low"
        tier = {"high": "High Value", "medium": "Medium Value", "low": "Low Value"}[code]
        item = {**row, "tier": tier, "tierCode": code, "segment": tier}
        categorized.append(item)
        bucket = tier_summary[code]
        bucket["count"] += 1
        bucket["totalSpend"] += row["totalSpending"]
        bucket["orders"] += row["orderCount"]
    revenue = sum(customer["totalSpending"] for customer in categorized)
    orders = sum(customer["orderCount"] or 0 for customer in categorized)

    def tier_entry(code: str, label: str, threshold: str) -> dict[str, Any]:
        data = tier_summary[code]
        return {
            "label": label, "threshold": threshold, **data,
            "spendPct": round(data["totalSpend"] / revenue * 100) if revenue else 0,
            "avgSpend": round(data["totalSpend"] / data["count"]) if data["count"] else 0,
        }

    return {
        "summary": {
            "totalCustomers": len(records), "totalSpend": revenue,
            "averageOrderValue": round(revenue / orders) if orders else 0,
            "averageOrdersPerCustomer": f"{orders / len(records):.1f}" if records else 0,
            "highThreshold": high, "mediumThreshold": medium,
            "tiers": {
                "high": tier_entry("high", "High Value (VIP)", f">= ₹{high:,.0f}"),
                "medium": tier_entry("medium", "Medium Value (Regular)", f"₹{medium:,.0f} - ₹{high:,.0f}"),
                "low": tier_entry("low", "Low Value (Starter)", f"< ₹{medium:,.0f}"),
            },
        },
        "segmentationMethod": "Customers are categorized into 3 tiers based on historical spend: High Value (>= ₹50,000), Medium Value (₹20,000 - ₹50,000), and Low Value (< ₹20,000).",
        "customers": categorized, "mostActiveCustomers": categorized[:100],
    }


@router.get("/top-products")
def top_products(
    _user: CurrentUser, db: DBConn,
    limit: str | None = None, category: str | None = None,
) -> dict[str, Any]:
    maximum = int(_bounded(limit, 10, 1, 100))
    category = (category or "").strip()
    sql = """
        SELECT p.product_id, p.product_name, p.category, SUM(oi.quantity) AS unitsSold,
               SUM(oi.quantity * oi.unit_price) AS revenue
        FROM analytics_order_items oi JOIN analytics_products p ON p.product_id = oi.product_id
    """
    params: list[Any] = []
    if category:
        sql += " WHERE lower(p.category) = lower(?)"
        params.append(category)
    sql += " GROUP BY p.product_id ORDER BY unitsSold DESC, revenue DESC, p.product_name ASC LIMIT ?"
    rows = _rows(db.execute(sql, (*params, maximum)))
    return {
        "category": category or None, "limit": maximum,
        "recommendationRule": "Products are ranked by historical units sold, then historical revenue.",
        "products": rows,
    }


@router.get("/sales")
def sales(_user: CurrentUser, db: DBConn) -> dict[str, Any]:
    summary = _one(db, """
        SELECT COUNT(*) AS totalOrders, COALESCE(SUM(total_amount), 0) AS totalRevenue,
               COALESCE(AVG(total_amount), 0) AS averageOrderValue FROM analytics_orders
    """)
    summary["totalProductsSold"] = _one(
        db, "SELECT COALESCE(SUM(quantity), 0) AS total FROM analytics_order_items"
    )["total"]
    top = _rows(db.execute("""
        SELECT p.product_id, p.product_name, p.category, SUM(oi.quantity) AS unitsSold,
               SUM(oi.quantity * oi.unit_price) AS revenue
        FROM analytics_order_items oi JOIN analytics_products p ON p.product_id = oi.product_id
        GROUP BY oi.product_id ORDER BY unitsSold DESC, revenue DESC LIMIT 10
    """))
    categories = _rows(db.execute("""
        SELECT p.category, SUM(oi.quantity) AS unitsSold,
               SUM(oi.quantity * oi.unit_price) AS revenue
        FROM analytics_order_items oi JOIN analytics_products p ON p.product_id = oi.product_id
        GROUP BY p.category ORDER BY revenue DESC
    """))
    days = _rows(db.execute("""
        SELECT o.order_date AS date, SUM(o.total_amount) AS revenue,
               COUNT(DISTINCT o.order_id) AS orders, COALESCE(SUM(oi.quantity), 0) AS purchases,
               ROUND(COALESCE(AVG(o.total_amount), 0), 2) AS aov
        FROM analytics_orders o LEFT JOIN analytics_order_items oi ON oi.order_id = o.order_id
        GROUP BY o.order_date ORDER BY o.order_date ASC
    """))
    week = _rows(db.execute("""
        SELECT CASE strftime('%w', o.order_date)
          WHEN '0' THEN 'Sunday' WHEN '1' THEN 'Monday' WHEN '2' THEN 'Tuesday'
          WHEN '3' THEN 'Wednesday' WHEN '4' THEN 'Thursday' WHEN '5' THEN 'Friday'
          ELSE 'Saturday' END AS period, SUM(oi.quantity * oi.unit_price) AS revenue,
          COUNT(DISTINCT o.order_id) AS orders, COALESCE(SUM(oi.quantity), 0) AS purchases
        FROM analytics_orders o JOIN analytics_order_items oi ON oi.order_id = o.order_id
        GROUP BY strftime('%w', o.order_date)
        ORDER BY CAST(strftime('%w', o.order_date) AS INTEGER)
    """))
    month = _rows(db.execute("""
        SELECT strftime('%m', o.order_date) AS month,
               SUM(oi.quantity * oi.unit_price) AS revenue,
               COUNT(DISTINCT o.order_id) AS orders, COALESCE(SUM(oi.quantity), 0) AS purchases
        FROM analytics_orders o JOIN analytics_order_items oi ON oi.order_id = o.order_id
        GROUP BY strftime('%m', o.order_date) ORDER BY strftime('%m', o.order_date)
    """))
    return {
        "summary": summary, "topProducts": top, "topCategories": categories,
        "revenueByCategory": categories, "salesByDate": days,
        "revenueByPeriod": {
            "day30": days[-30:], "day90": days[-90:], "year": days, "week": week,
            "month": [
                {"period": _MONTH_LABELS.get(row["month"], "Dec"), "revenue": row["revenue"],
                 "orders": row["orders"], "purchases": row["purchases"]}
                for row in month
            ],
        },
    }


@router.get("/frequent-patterns")
def frequent_patterns(_user: CurrentUser, db: DBConn, minSupport: str | None = None) -> dict[str, Any]:
    support, _ = _support_options({"minSupport": minSupport})
    return {"minimumSupport": support, **_frequent_patterns(_association_data(db), support)}


@router.get("/association-rules")
def association_rules(
    _user: CurrentUser, db: DBConn,
    minSupport: str | None = None, minConfidence: str | None = None,
) -> dict[str, Any]:
    support, confidence = _support_options({"minSupport": minSupport, "minConfidence": minConfidence})
    return {
        "minimumSupport": support, "minimumConfidence": confidence,
        **_association_rules(_association_data(db), support, confidence),
    }


@router.get("/recommendations")
def recommendations(
    _user: CurrentUser, db: DBConn,
    minSupport: str | None = None, minConfidence: str | None = None,
    category: str | None = None,
) -> dict[str, Any]:
    support, confidence = _support_options({"minSupport": minSupport, "minConfidence": minConfidence})
    result = _association_rules(_association_data(db), support, confidence)
    top = _rows(db.execute("""
        SELECT p.product_id, p.product_name, p.category, p.price, SUM(oi.quantity) AS unitsSold
        FROM analytics_order_items oi JOIN analytics_products p ON p.product_id = oi.product_id
        GROUP BY p.product_id ORDER BY unitsSold DESC, p.product_name ASC LIMIT 12
    """))
    top_selling = [{**item, "reason": f"Top selling in {item['category']}"} for item in top]
    category = (category or "").strip()
    in_category = []
    if category:
        in_category = _rows(db.execute("""
            SELECT p.product_id, p.product_name, p.category, p.price, SUM(oi.quantity) AS unitsSold
            FROM analytics_order_items oi JOIN analytics_products p ON p.product_id = oi.product_id
            WHERE lower(p.category) = lower(?) GROUP BY p.product_id
            ORDER BY unitsSold DESC, p.product_name ASC LIMIT 12
        """, (category,)))
        in_category = [{**item, "reason": f"Top selling in {item['category']}"} for item in in_category]
    rule_recs = [{
        "recommendedProduct": rule["consequent"], "basedOnProduct": rule["antecedent"],
        "absoluteSupport": rule["absoluteSupport"], "relativeSupport": rule["relativeSupport"],
        "confidence": rule["confidence"],
        "reason": f"Frequently purchased with {rule['antecedent']} ({rule['absoluteSupport']} orders).",
    } for rule in result["rules"][:15]]
    fallback = []
    for index, item in enumerate(top_selling[:8]):
        if not top_selling:
            break
        paired = top_selling[(index + 1) % len(top_selling)]
        fallback.append({
            "recommendedProduct": item["product_name"], "basedOnProduct": paired["product_name"],
            "absoluteSupport": item["unitsSold"], "relativeSupport": item["unitsSold"] / 5000,
            "confidence": 0.85,
            "reason": f"Bestseller in {item['category']} ({item['unitsSold']} units sold).",
        })
    final = rule_recs if len(rule_recs) >= 6 else (rule_recs + fallback)[:15]
    return {
        "minimumSupport": support, "minimumConfidence": confidence,
        "transactionCount": result["transactionCount"], "topSelling": top_selling,
        "topInCategory": in_category, "recommendations": final,
        "categoryAffinity": result["categoryRules"][:8],
    }


@router.get("/validation")
def validation(_user: CurrentUser, db: DBConn) -> dict[str, Any]:
    try:
        orders = _xslx_rows("orders_1.xlsx")
        customers = _xslx_rows("customers_1.xlsx")
        products = _xslx_rows("products_1.xlsx")
        items = _xslx_rows("order_items_1.xlsx")
        calculated = {
            "orders": _one(db, "SELECT COUNT(*) AS value FROM analytics_orders")["value"],
            "revenue": _one(db, "SELECT COALESCE(SUM(total_amount), 0) AS value FROM analytics_orders")["value"],
            "productsSold": _one(db, "SELECT COALESCE(SUM(quantity), 0) AS value FROM analytics_order_items")["value"],
            "customers": _one(db, "SELECT COUNT(*) AS value FROM analytics_customers")["value"],
            "products": _one(db, "SELECT COUNT(*) AS value FROM analytics_products")["value"],
        }
        expected = {
            "orders": len(orders),
            "revenue": sum(float(row.get("total_amount") or 0) for row in orders),
            "productsSold": sum(float(row.get("quantity") or 0) for row in items),
            "customers": len(customers), "products": len(products),
        }
        labels = {
            "orders": "Orders", "revenue": "Revenue", "productsSold": "Products Sold",
            "customers": "Customers", "products": "Historical Products",
        }
        checks = []
        for key, label in labels.items():
            difference = calculated[key] - expected[key]
            tolerance = 0.01 if key == "revenue" else 0
            checks.append({
                "metric": key, "label": label, "calculated": calculated[key],
                "expected": expected[key], "difference": difference,
                "status": "passed" if abs(difference) <= tolerance else "failed",
            })
        return {"status": "passed" if all(c["status"] == "passed" for c in checks) else "failed", "checks": checks}
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Unable to validate the historical dataset.") from exc


@router.get("/forecast")
def forecast(
    user: CurrentUser, db: DBConn,
    lowThreshold: str | None = None, mediumThreshold: str | None = None,
    days: str | None = None, forecastDays: str | None = None,
    scope: str = "all", category: str | None = None, search: str | None = None,
    limit: str | None = None,
) -> dict[str, Any]:
    low = _bounded(lowThreshold, 5, 0, 1_000_000)
    medium = max(low, _bounded(mediumThreshold, 20, 0, 1_000_000))
    forecast_period = _bounded(days or forecastDays, 30, 1, 365)
    scope = scope.strip().lower()
    category_filter, search_query = (category or "").strip(), (search or "").strip().lower()
    maximum = int(_bounded(limit, 250, 1, 10_000))
    catalog = _rows(db.execute("""
        SELECT id AS product_id, name AS product_name, category, price, stock, 'catalog' AS origin
        FROM products WHERE vendor_id = ? ORDER BY stock ASC, name ASC
    """, (user.id,)))
    live_sales = _rows(db.execute("""
        SELECT product_id, SUM(quantity) AS unitsSold, MIN(date(sold_at)) AS firstSaleDate,
               MAX(date(sold_at)) AS lastSaleDate
        FROM sales WHERE vendor_id = ? GROUP BY product_id
    """, (user.id,)))
    live_by_product = {str(row["product_id"]): {**row, "observedDays": _observed_days(row["firstSaleDate"], row["lastSaleDate"])} for row in live_sales}
    historical = _historical_products(db)
    history = historical["list"]

    def matches(product: dict[str, Any]) -> bool:
        return (
            (not category_filter or str(product["category"]).lower() == category_filter.lower())
            and (not search_query or search_query in str(product["product_name"]).lower()
                 or search_query in str(product["product_id"]).lower())
        )

    dataset = [product for product in history if matches(product)]
    dataset.sort(key=lambda product: -(product["unitsSold"] or 0))
    if scope == "catalog":
        targets = catalog
    elif scope == "dataset":
        targets = [{**product, "origin": "dataset"} for product in dataset[:maximum]]
    else:
        targets = catalog + [{**product, "origin": "dataset"} for product in dataset[:max(80, maximum)]]

    forecasts = []
    for product in targets:
        is_catalog = product["origin"] == "catalog"
        recorded = live_by_product.get(str(product["product_id"])) if is_catalog else None
        exact = historical["byId"].get(str(product["product_id"])) or historical["byName"].get(_normalized_name(product["product_name"]))
        fallback = historical["categoryTotals"].get(_category_key(product["category"]))
        historical_sales = float(recorded["unitsSold"] if recorded else (
            exact["unitsSold"] if exact else round(fallback["units"] / fallback["products"]) if fallback else 0
        ))
        periods = (recorded or {}).get("observedDays") or (exact or {}).get("observedDays") or (fallback or {}).get("days") or 365
        average = historical_sales / periods if periods else 0
        demand = max(1, round(average * forecast_period))
        shortage = max(demand - product["stock"], 0)
        runout_days = math.floor(product["stock"] / average) if average > 0 else 999
        basis, basis_label = "category-average history", "Category average"
        if recorded:
            basis, basis_label = "recorded vendor sales", "Your recorded sales"
        elif exact and (exact["unitsSold"] > 0 or not is_catalog):
            basis, basis_label = "matched dataset history", "Historical Dataset (Exact Match)"
        elif fallback:
            basis_label = f"Category average ({product['category']})"
        forecasts.append({
            key: product[key] for key in ("product_id", "product_name", "category", "price", "stock")
        } | {
            "origin": product.get("origin", "dataset"), "historicalSales": historical_sales,
            "observedDays": periods, "orderCount": (exact or {}).get("orderCount") or (
                math.ceil(historical_sales / 2) if historical_sales > 0 else 0
            ),
            "averageDailySales": average, "predictedDemand": demand,
            "thirtyDayDemand": max(1, round(average * 30)), "stockRequirement": demand,
            "shortage": shortage, "recommendedRestock": shortage, "runoutDays": runout_days,
            "stockCoveragePct": round(product["stock"] / max(1, demand) * 100),
            "revenueAtRisk": round(shortage * (product["price"] or 0)),
            "forecastBasis": basis, "forecastBasisLabel": basis_label,
            "status": _forecast_status(product["stock"], demand, low, medium),
        })
    return {
        "dataSource": "live_catalog" if scope == "catalog" else "historical_dataset" if scope == "dataset" else "combined",
        "forecastPeriodDays": forecast_period, "thresholds": {"lowThreshold": low, "mediumThreshold": medium},
        "totalProductsCount": len(history), "catalogCount": len(catalog),
        "categories": historical["categories"], "forecasts": forecasts,
        "alertCount": sum(item["status"] != "healthy" for item in forecasts),
    }


@router.get("/forecast/product-detail")
def forecast_product_detail(
    _user: CurrentUser, db: DBConn, productId: str | None = None
) -> dict[str, Any]:
    product_id = (productId or "").strip()
    if not product_id:
        return JSONResponse(status_code=400, content={"error": "productId is required"})
    return {
        "productId": product_id,
        "monthlySales": _rows(db.execute("""
            SELECT strftime('%m', o.order_date) AS month, SUM(oi.quantity) AS unitsSold
            FROM analytics_order_items oi JOIN analytics_orders o ON o.order_id = oi.order_id
            WHERE oi.product_id = ? GROUP BY strftime('%m', o.order_date)
            ORDER BY strftime('%m', o.order_date) ASC
        """, (product_id,))),
    }


@router.get("/sentiment")
def sentiment(_user: CurrentUser) -> dict[str, Any]:
    return {"available": False, "message": "No review data available in dataset.", "products": []}


@router.get("/similar-products")
def similar_products(
    _user: CurrentUser, db: DBConn, productId: str | None = None
) -> dict[str, Any]:
    product_id = (productId or "").strip()
    if not product_id:
        return JSONResponse(status_code=400, content={"error": "productId is required"})
    product = _one(db, """
        SELECT product_id, product_name, category, price
        FROM analytics_products WHERE product_id = ?
    """, (product_id,))
    if not product:
        return JSONResponse(status_code=404, content={"error": "Historical product not found"})
    tokens = set(_normalized_name(product["product_name"]).split())
    candidates = _rows(db.execute("""
        SELECT product_id, product_name, category, price
        FROM analytics_products WHERE product_id != ?
    """, (product_id,)))
    similar = []
    for candidate in candidates:
        overlap = sum(token in tokens for token in _normalized_name(candidate["product_name"]).split())
        same_category = str(candidate["category"]).lower() == str(product["category"]).lower()
        score = (2 if same_category else 0) + overlap
        if score:
            similar.append({
                **candidate, "score": score,
                "reason": f"Similar category: {candidate['category']}" if same_category else "Similar product name",
            })
    similar.sort(key=lambda item: (-item["score"], item["product_name"]))
    return {"product": product, "similarProducts": similar[:6]}


@router.get("/reporting/sales-over-time")
def reporting_sales_over_time(
    user: CurrentUser, db: DBConn,
    timeframe: str = "30d", scope: str | None = None, vendorId: str | None = None,
) -> dict[str, Any]:
    timeframe = timeframe.strip().lower()
    scope = (scope or ("vendor" if user.role == "vendor" else "marketplace")).strip().lower()
    selected_vendor = _vendor_id(user, vendorId)
    if scope == "vendor":
        if timeframe == "month":
            data = _rows(db.execute("""
                SELECT strftime('%Y-%m', sold_at) AS date, strftime('%Y-%m', sold_at) AS label,
                       COALESCE(SUM(amount), 0) AS revenue, COUNT(id) AS orders,
                       COALESCE(SUM(quantity), 0) AS unitsSold,
                       ROUND(COALESCE(AVG(amount), 0), 2) AS aov
                FROM sales WHERE vendor_id = ? GROUP BY strftime('%Y-%m', sold_at)
                ORDER BY strftime('%Y-%m', sold_at)
            """, (selected_vendor,)))
        elif timeframe == "week":
            data = _rows(db.execute("""
                WITH days AS (
                  SELECT 0 AS day_offset, 'Monday' AS day_name UNION SELECT 1, 'Tuesday'
                  UNION SELECT 2, 'Wednesday' UNION SELECT 3, 'Thursday'
                  UNION SELECT 4, 'Friday' UNION SELECT 5, 'Saturday' UNION SELECT 6, 'Sunday'
                )
                SELECT days.day_name AS label, days.day_offset AS date,
                       COALESCE(SUM(s.amount), 0) AS revenue, COALESCE(COUNT(s.id), 0) AS orders,
                       COALESCE(SUM(s.quantity), 0) AS unitsSold,
                       ROUND(COALESCE(AVG(s.amount), 0), 2) AS aov
                FROM days LEFT JOIN sales s ON s.vendor_id = ?
                  AND ((CAST(strftime('%w', s.sold_at) AS INTEGER) + 6) % 7) = days.day_offset
                GROUP BY days.day_offset, days.day_name ORDER BY days.day_offset
            """, (selected_vendor,)))
        else:
            data = _rows(db.execute("""
                WITH RECURSIVE hours(hour) AS (
                  SELECT 0 UNION ALL SELECT hour + 1 FROM hours WHERE hour < 23
                )
                SELECT hours.hour AS hour, printf('%02d:00', hours.hour) AS label,
                       COALESCE(SUM(s.amount), 0) AS revenue, COALESCE(COUNT(s.id), 0) AS orders,
                       COALESCE(SUM(s.quantity), 0) AS unitsSold,
                       ROUND(COALESCE(AVG(s.amount), 0), 2) AS aov
                FROM hours LEFT JOIN sales s ON s.vendor_id = ?
                  AND CAST(strftime('%H', s.sold_at) AS INTEGER) = hours.hour
                GROUP BY hours.hour ORDER BY hours.hour
            """, (selected_vendor,)))
        revenue = sum(float(row["revenue"] or 0) for row in data)
        orders = sum(int(row["orders"] or 0) for row in data)
        units = sum(int(row["unitsSold"] or 0) for row in data)
        return {
            "scope": "vendor", "timeframe": timeframe, "vendorId": selected_vendor,
            "summary": {
                "totalRevenue": revenue, "totalOrders": orders, "totalUnitsSold": units,
                "averageOrderValue": round(revenue / orders, 2) if orders else 0,
            },
            "data": data,
        }
    if timeframe == "month":
        data = _rows(db.execute("""
            SELECT strftime('%m', o.order_date) AS month, COALESCE(SUM(oi.quantity * oi.unit_price), 0) AS revenue,
                   COUNT(DISTINCT o.order_id) AS orders, COALESCE(SUM(oi.quantity), 0) AS unitsSold,
                   ROUND(COALESCE(AVG(o.total_amount), 0), 2) AS aov
            FROM analytics_orders o JOIN analytics_order_items oi ON oi.order_id = o.order_id
            GROUP BY strftime('%m', o.order_date) ORDER BY strftime('%m', o.order_date)
        """))
        data = [
            {
                "label": _MONTH_LABELS.get(row["month"], "Dec"), "date": row["month"],
                "revenue": row["revenue"], "orders": row["orders"],
                "unitsSold": row["unitsSold"], "aov": row["aov"],
            }
            for row in data
        ]
    elif timeframe == "week":
        data = _rows(db.execute("""
            SELECT date(o.order_date, '-' || ((CAST(strftime('%w', o.order_date) AS INTEGER) + 6) % 7) || ' days') AS date,
                   date(o.order_date, '-' || ((CAST(strftime('%w', o.order_date) AS INTEGER) + 6) % 7) || ' days') AS label,
                   COALESCE(SUM(oi.quantity * oi.unit_price), 0) AS revenue,
                   COUNT(DISTINCT o.order_id) AS orders, COALESCE(SUM(oi.quantity), 0) AS unitsSold,
                   ROUND(COALESCE(AVG(o.total_amount), 0), 2) AS aov
            FROM analytics_orders o JOIN analytics_order_items oi ON oi.order_id = o.order_id
            GROUP BY date(o.order_date, '-' || ((CAST(strftime('%w', o.order_date) AS INTEGER) + 6) % 7) || ' days')
            ORDER BY date
        """))
    else:
        limit = 90 if timeframe == "90d" else 365 if timeframe == "year" else 30
        data = _rows(db.execute("""
            SELECT o.order_date AS date, strftime('%m-%d', o.order_date) AS label,
                   COALESCE(SUM(o.total_amount), 0) AS revenue,
                   COUNT(DISTINCT o.order_id) AS orders, COALESCE(SUM(oi.quantity), 0) AS unitsSold,
                   ROUND(COALESCE(AVG(o.total_amount), 0), 2) AS aov
            FROM analytics_orders o LEFT JOIN analytics_order_items oi ON oi.order_id = o.order_id
            GROUP BY o.order_date ORDER BY o.order_date
        """))[-limit:]
    revenue = sum(float(row["revenue"] or 0) for row in data)
    orders = sum(int(row["orders"] or 0) for row in data)
    units = sum(int(row["unitsSold"] or 0) for row in data)
    return {
        "scope": "marketplace", "timeframe": timeframe,
        "summary": {
            "totalRevenue": revenue, "totalOrders": orders, "totalUnitsSold": units,
            "averageOrderValue": round(revenue / orders, 2) if orders else 0,
        },
        "data": data,
    }


@router.get("/reporting/category-performance")
def reporting_category_performance(
    user: CurrentUser, db: DBConn, scope: str = "marketplace", vendorId: str | None = None
) -> dict[str, Any]:
    scope = scope.strip().lower()
    selected_vendor = _vendor_id(user, vendorId)
    if scope == "vendor":
        categories = _rows(db.execute("""
            SELECT p.category, COALESCE(SUM(s.amount), 0) AS revenue,
                   COALESCE(SUM(s.quantity), 0) AS unitsSold, COUNT(s.id) AS orderCount,
                   COUNT(DISTINCT p.id) AS productCount
            FROM products p LEFT JOIN sales s ON s.product_id = p.id AND s.vendor_id = p.vendor_id
            WHERE p.vendor_id = ? GROUP BY p.category ORDER BY revenue DESC, unitsSold DESC
        """, (selected_vendor,)))
        result_scope, vendor_field = "vendor", {"vendorId": selected_vendor}
    else:
        categories = _rows(db.execute("""
            SELECT p.category, COALESCE(SUM(oi.quantity * oi.unit_price), 0) AS revenue,
                   COALESCE(SUM(oi.quantity), 0) AS unitsSold,
                   COUNT(DISTINCT oi.order_id) AS orderCount,
                   COUNT(DISTINCT p.product_id) AS productCount
            FROM analytics_products p JOIN analytics_order_items oi ON oi.product_id = p.product_id
            GROUP BY p.category ORDER BY revenue DESC
        """))
        result_scope, vendor_field = "marketplace", {}
    revenue = sum(float(row["revenue"] or 0) for row in categories)
    units = sum(float(row["unitsSold"] or 0) for row in categories)
    enriched = [
        {**row, "revenueSharePct": round(row["revenue"] / revenue * 1000) / 10 if revenue else 0}
        for row in categories
    ]
    return {
        "scope": result_scope, **vendor_field,
        "summary": {"totalCategories": len(enriched), "totalRevenue": revenue, "totalUnitsSold": units},
        "categories": enriched,
    }


@router.get("/reporting/top-products")
def reporting_top_products(
    user: CurrentUser, db: DBConn, limit: str | None = None,
    category: str | None = None, scope: str = "marketplace", vendorId: str | None = None,
) -> dict[str, Any]:
    maximum = int(_bounded(limit, 10, 1, 100))
    category = (category or "").strip()
    scope = scope.strip().lower()
    selected_vendor = _vendor_id(user, vendorId)
    if scope == "vendor":
        sql = """
            SELECT p.id AS product_id, p.name AS product_name, p.category, p.price, p.stock,
                   COALESCE(SUM(s.quantity), 0) AS unitsSold, COALESCE(SUM(s.amount), 0) AS revenue,
                   COUNT(s.id) AS orderCount
            FROM products p LEFT JOIN sales s ON s.product_id = p.id AND s.vendor_id = p.vendor_id
            WHERE p.vendor_id = ?
        """
        params: list[Any] = [selected_vendor]
        if category:
            sql += " AND lower(p.category) = lower(?)"
            params.append(category)
        sql += " GROUP BY p.id ORDER BY unitsSold DESC, revenue DESC LIMIT ?"
    else:
        sql = """
            SELECT p.product_id, p.product_name, p.category, p.price, p.stock,
                   COALESCE(SUM(oi.quantity), 0) AS unitsSold,
                   COALESCE(SUM(oi.quantity * oi.unit_price), 0) AS revenue,
                   COUNT(DISTINCT oi.order_id) AS orderCount
            FROM analytics_products p JOIN analytics_order_items oi ON oi.product_id = p.product_id
        """
        params = []
        if category:
            sql += " WHERE lower(p.category) = lower(?)"
            params.append(category)
        sql += " GROUP BY p.product_id ORDER BY unitsSold DESC, revenue DESC LIMIT ?"
    rows = _rows(db.execute(sql, (*params, maximum)))
    return {"scope": "vendor" if scope == "vendor" else "marketplace",
            "limit": maximum, "category": category or None, "products": rows}


@router.get("/reporting/summary")
def reporting_summary(
    user: CurrentUser, db: DBConn, scope: str | None = None, vendorId: str | None = None
) -> dict[str, Any]:
    scope = (scope or ("vendor" if user.role == "vendor" else "marketplace")).strip().lower()
    selected_vendor = _vendor_id(user, vendorId)
    if scope == "vendor":
        sales_row = _one(db, """
            SELECT COALESCE(SUM(amount), 0) AS totalRevenue, COUNT(id) AS totalOrders,
                   COALESCE(SUM(quantity), 0) AS totalUnitsSold FROM sales WHERE vendor_id = ?
        """, (selected_vendor,))
        count = _one(db, "SELECT COUNT(*) AS c FROM products WHERE vendor_id = ?", (selected_vendor,))["c"]
        top_category = _one(db, """
            SELECT p.category, SUM(s.amount) AS revenue FROM sales s
            JOIN products p ON s.product_id = p.id WHERE s.vendor_id = ?
            GROUP BY p.category ORDER BY revenue DESC LIMIT 1
        """, (selected_vendor,))
        top_product = _one(db, """
            SELECT p.id AS product_id, p.name AS product_name,
                   SUM(s.quantity) AS unitsSold, SUM(s.amount) AS revenue
            FROM sales s JOIN products p ON s.product_id = p.id WHERE s.vendor_id = ?
            GROUP BY p.id ORDER BY revenue DESC, unitsSold DESC LIMIT 1
        """, (selected_vendor,))
        orders = sales_row["totalOrders"]
        return {
            "scope": "vendor", "vendorId": selected_vendor,
            **sales_row, "totalProducts": count,
            "averageOrderValue": round(sales_row["totalRevenue"] / orders, 2) if orders else 0,
            "topCategory": {"name": top_category["category"], "revenue": top_category["revenue"]} if top_category else None,
            "topProduct": top_product or None,
        }
    order_summary = _one(db, """
        SELECT COUNT(*) AS totalOrders, COALESCE(SUM(total_amount), 0) AS totalRevenue,
               COALESCE(AVG(total_amount), 0) AS averageOrderValue FROM analytics_orders
    """)
    units = _one(db, "SELECT COALESCE(SUM(quantity), 0) AS totalUnitsSold FROM analytics_order_items")["totalUnitsSold"]
    product_count = _one(db, "SELECT COUNT(*) AS c FROM analytics_products")["c"]
    customer_count = _one(db, "SELECT COUNT(*) AS c FROM analytics_customers")["c"]
    top_category = _one(db, """
        SELECT p.category, SUM(oi.quantity * oi.unit_price) AS revenue
        FROM analytics_order_items oi JOIN analytics_products p ON oi.product_id = p.product_id
        GROUP BY p.category ORDER BY revenue DESC LIMIT 1
    """)
    top_product = _one(db, """
        SELECT p.product_id, p.product_name, SUM(oi.quantity) AS unitsSold,
               SUM(oi.quantity * oi.unit_price) AS revenue
        FROM analytics_order_items oi JOIN analytics_products p ON oi.product_id = p.product_id
        GROUP BY p.product_id ORDER BY unitsSold DESC, revenue DESC LIMIT 1
    """)
    revenue = order_summary["totalRevenue"]
    return {
        "scope": "marketplace", "totalRevenue": revenue, "totalOrders": order_summary["totalOrders"],
        "totalUnitsSold": units, "totalProducts": product_count, "totalCustomers": customer_count,
        "averageOrderValue": round(order_summary["averageOrderValue"] * 100) / 100,
        "topCategory": {
            "name": top_category["category"], "revenue": top_category["revenue"],
            "revenueSharePct": round(top_category["revenue"] / revenue * 1000) / 10 if revenue else 0,
        } if top_category else None,
        "topProduct": top_product or None,
    }


@router.get("/benchmark")
def benchmark(
    user: CurrentUser, db: DBConn, vendorId: str | None = None
) -> dict[str, Any]:
    selected_vendor = _vendor_id(user, vendorId)
    vendor = _one(db, "SELECT id, full_name, business_name, email FROM vendors WHERE id = ?", (selected_vendor,))
    if not vendor:
        return JSONResponse(status_code=404, content={"error": "Vendor not found"})
    vendor_revenue = _one(db, "SELECT COALESCE(SUM(amount), 0) AS v FROM sales WHERE vendor_id = ?", (selected_vendor,))["v"]
    vendor_orders = _one(db, "SELECT COUNT(*) AS v FROM sales WHERE vendor_id = ?", (selected_vendor,))["v"]
    vendor_units = _one(db, "SELECT COALESCE(SUM(quantity), 0) AS v FROM sales WHERE vendor_id = ?", (selected_vendor,))["v"]
    vendor_products = _one(db, "SELECT COUNT(*) AS v FROM products WHERE vendor_id = ?", (selected_vendor,))["v"]
    count = _one(db, "SELECT COUNT(*) AS c FROM vendors WHERE status = 'approved'")["c"] or 1
    total_revenue = _one(db, "SELECT COALESCE(SUM(amount), 0) AS r FROM sales")["r"]
    total_orders = _one(db, "SELECT COUNT(*) AS o FROM sales")["o"]
    total_units = _one(db, "SELECT COALESCE(SUM(quantity), 0) AS u FROM sales")["u"]
    total_products = _one(db, "SELECT COUNT(*) AS p FROM products")["p"]
    averages = {
        "revenue": round(total_revenue / count, 2), "orders": round(total_orders / count, 1),
        "unitsSold": round(total_units / count, 1), "productCount": round(total_products / count, 1),
    }

    def compare(label: str, actual: float, average: float, currency: bool = False) -> dict[str, Any]:
        difference = round((actual - average) * 100) / 100
        pct = round((actual - average) / average * 100, 1) if average > 0 else (100.0 if actual > 0 else 0)
        status = "above" if pct > 0 else "below" if pct < 0 else "equal"
        return {
            "label": label, "vendorValue": actual, "marketplaceAverage": average,
            "difference": difference, "percentageDifference": pct, "status": status,
            "formattedDiff": f"{'+' if pct > 0 else ''}{pct:.1f}%", "currency": currency,
        }

    comps = {
        "revenue": compare("Total Revenue", vendor_revenue, averages["revenue"], True),
        "orders": compare("Total Orders", vendor_orders, averages["orders"]),
        "unitsSold": compare("Units Sold", vendor_units, averages["unitsSold"]),
        "productCount": compare("Products Listed", vendor_products, averages["productCount"]),
    }
    above = sum(item["status"] == "above" for item in comps.values())
    overall = (
        "Top Performer (Above Average)" if above >= 3 else
        "Competitive (Above Average in key areas)" if above >= 2 else
        "Growth Opportunity (Below Average)" if comps["revenue"]["status"] == "below" else
        "At Market Average"
    )
    insights = []
    revenue_comp = comps["revenue"]
    if revenue_comp["status"] == "above":
        insights.append(f"Your revenue (₹{vendor_revenue:,.0f}) is {revenue_comp['formattedDiff']} above the marketplace average.")
    elif revenue_comp["status"] == "below":
        insights.append(f"Your revenue (₹{vendor_revenue:,.0f}) is {revenue_comp['formattedDiff'].replace('+', '')} below the marketplace average.")
    else:
        insights.append("Your revenue is on par with the marketplace average.")
    if comps["productCount"]["status"] == "below":
        insights.append(f"Listing more products (currently {vendor_products} vs avg {averages['productCount']}) can help expand your category reach and order volume.")
    elif comps["productCount"]["status"] == "above":
        insights.append(f"Strong product catalog depth with {vendor_products} products listed (marketplace average: {averages['productCount']}).")
    if comps["unitsSold"]["status"] == "above":
        insights.append(f"High unit sales volume ({vendor_units} units sold vs marketplace avg {averages['unitsSold']}).")
    return {
        "vendor": {
            "id": vendor["id"], "fullName": vendor.get("full_name"),
            "businessName": vendor.get("business_name"), "email": vendor.get("email"),
        },
        "marketplace": {
            "totalVendors": count, "totalRevenue": total_revenue,
            "totalOrders": total_orders, "totalUnitsSold": total_units, "totalProducts": total_products,
        },
        "benchmarks": comps, "overallPerformance": overall, "insights": insights,
    }


@router.get("/export/sales")
def export_sales(
    user: CurrentUser, db: DBConn, scope: str | None = None, vendorId: str | None = None
) -> Response:
    scope = (scope or ("vendor" if user.role == "vendor" else "marketplace")).strip().lower()
    selected_vendor = _vendor_id(user, vendorId)
    if scope == "vendor":
        records = _rows(db.execute("""
            SELECT s.sold_at AS date, p.name AS product, p.category, s.quantity, p.price,
                   s.amount AS revenue, v.business_name AS vendor
            FROM sales s JOIN products p ON s.product_id = p.id
            JOIN vendors v ON s.vendor_id = v.id WHERE s.vendor_id = ? ORDER BY s.sold_at DESC
        """, (selected_vendor,)))
    else:
        records = _rows(db.execute("""
            SELECT o.order_date AS date, p.product_name AS product, p.category, oi.quantity,
                   oi.unit_price AS price, oi.quantity * oi.unit_price AS revenue,
                   'ShopSense Marketplace' AS vendor
            FROM analytics_order_items oi JOIN analytics_orders o ON oi.order_id = o.order_id
            JOIN analytics_products p ON oi.product_id = p.product_id
            ORDER BY o.order_date DESC LIMIT 5000
        """))
    output = [["Date", "Product", "Category", "Quantity", "Price", "Revenue", "Vendor"]]
    for row in records:
        output.append([
            row.get("date") or "", row.get("product") or "", row.get("category") or "",
            row.get("quantity") if row.get("quantity") is not None else 0,
            f"{float(row.get('price') or 0):.2f}", f"{float(row.get('revenue') or 0):.2f}",
            row.get("vendor") or "",
        ])
    return _csv_response(output, "sales_report.csv")


@router.get("/export/products")
def export_products(
    user: CurrentUser, db: DBConn, scope: str | None = None, vendorId: str | None = None
) -> Response:
    scope = (scope or ("vendor" if user.role == "vendor" else "marketplace")).strip().lower()
    selected_vendor = _vendor_id(user, vendorId)
    if scope == "vendor":
        records = _rows(db.execute("""
            SELECT p.id AS product_id, p.name AS product_name, p.category, p.price, p.stock,
                   COALESCE(SUM(s.quantity), 0) AS units_sold, COALESCE(SUM(s.amount), 0) AS revenue,
                   v.business_name AS vendor
            FROM products p JOIN vendors v ON p.vendor_id = v.id
            LEFT JOIN sales s ON s.product_id = p.id AND s.vendor_id = p.vendor_id
            WHERE p.vendor_id = ? GROUP BY p.id ORDER BY units_sold DESC, revenue DESC
        """, (selected_vendor,)))
    else:
        records = _rows(db.execute("""
            SELECT p.product_id, p.product_name, p.category, p.price, p.stock,
                   COALESCE(SUM(oi.quantity), 0) AS units_sold,
                   COALESCE(SUM(oi.quantity * oi.unit_price), 0) AS revenue,
                   'ShopSense Marketplace' AS vendor
            FROM analytics_products p LEFT JOIN analytics_order_items oi ON oi.product_id = p.product_id
            GROUP BY p.product_id ORDER BY units_sold DESC, revenue DESC LIMIT 5000
        """))
    output = [["ProductID", "Name", "Category", "Price", "Stock", "UnitsSold", "Revenue", "Vendor"]]
    for row in records:
        output.append([
            row.get("product_id") or "", row.get("product_name") or "", row.get("category") or "",
            f"{float(row.get('price') or 0):.2f}", row.get("stock") if row.get("stock") is not None else 0,
            row.get("units_sold") if row.get("units_sold") is not None else 0,
            f"{float(row.get('revenue') or 0):.2f}", row.get("vendor") or "",
        ])
    return _csv_response(output, "products_report.csv")

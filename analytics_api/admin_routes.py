"""FastAPI equivalents of the Express administrator routes."""

import sqlite3
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends, HTTPException, Request, status
from fastapi.routing import APIRoute
from fastapi.responses import JSONResponse
from jose import JWTError, jwt

from . import main


def get_admin_db():
    """Open a writable connection to the shared ShopSense database."""
    if not main.DB_PATH.exists():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Database not found at {main.DB_PATH}. Start the Express server first.",
        )
    connection = sqlite3.connect(str(main.DB_PATH), check_same_thread=False)
    connection.row_factory = sqlite3.Row
    try:
        yield connection
    finally:
        connection.close()


AdminDB = Annotated[sqlite3.Connection, Depends(get_admin_db)]


class AdminRoute(APIRoute):
    """Apply the Express router-wide admin authentication contract."""

    def get_route_handler(self):
        route_handler = super().get_route_handler()

        async def admin_route_handler(request: Request):
            authorization = request.headers.get("authorization", "")
            token = authorization[7:] if authorization.startswith("Bearer ") else None
            if not token:
                return JSONResponse(status_code=401, content={"error": "Missing token"})

            try:
                payload = jwt.decode(
                    token, main.JWT_SECRET, algorithms=[main.JWT_ALGORITHM]
                )
            except JWTError:
                return JSONResponse(
                    status_code=401,
                    content={"error": "Invalid or expired token"},
                )

            if payload.get("role") != "admin":
                return JSONResponse(
                    status_code=403,
                    content={"error": "Forbidden for this role"},
                )
            return await route_handler(request)

        return admin_route_handler


router = APIRouter(route_class=AdminRoute)


@router.get("/dashboard")
def get_dashboard(db: AdminDB) -> dict[str, Any]:
    total_vendors = db.execute("SELECT COUNT(*) AS c FROM vendors").fetchone()["c"]
    pending = db.execute(
        "SELECT COUNT(*) AS c FROM vendors WHERE status='pending'"
    ).fetchone()["c"]
    approved = db.execute(
        "SELECT COUNT(*) AS c FROM vendors WHERE status='approved'"
    ).fetchone()["c"]
    suspended = db.execute(
        "SELECT COUNT(*) AS c FROM vendors WHERE status='suspended'"
    ).fetchone()["c"]
    recent_vendors = db.execute(
        """SELECT id, full_name, business_name, email, status, joined_at
           FROM vendors ORDER BY joined_at DESC LIMIT 8"""
    ).fetchall()

    return {
        "totalVendors": total_vendors,
        "pending": pending,
        "approved": approved,
        "suspended": suspended,
        "recentVendors": [dict(vendor) for vendor in recent_vendors],
    }


@router.get("/vendors")
def get_vendors(request: Request, db: AdminDB) -> list[dict[str, Any]]:
    vendor_status = request.query_params.get("status")
    if vendor_status and vendor_status != "all":
        rows = db.execute(
            """SELECT id, full_name, business_name, email, phone, business_address,
                      status, joined_at
               FROM vendors WHERE status = ? ORDER BY joined_at DESC""",
            (vendor_status,),
        ).fetchall()
    else:
        rows = db.execute(
            """SELECT id, full_name, business_name, email, phone, business_address,
                      status, joined_at
               FROM vendors ORDER BY joined_at DESC"""
        ).fetchall()
    return [dict(vendor) for vendor in rows]


@router.put("/vendors/{vendor_id}/status")
def update_vendor_status(
    vendor_id: str,
    db: AdminDB,
    body: dict[str, Any] = Body(default={}),
) -> dict[str, str] | JSONResponse:
    new_status = body.get("status")
    if new_status not in ("pending", "approved", "suspended"):
        return JSONResponse(status_code=400, content={"error": "Invalid status"})

    vendor = db.execute("SELECT * FROM vendors WHERE id = ?", (vendor_id,)).fetchone()
    if vendor is None:
        return JSONResponse(status_code=404, content={"error": "Vendor not found"})

    db.execute("UPDATE vendors SET status = ? WHERE id = ?", (new_status, vendor["id"]))
    db.commit()
    return {"message": f"Vendor {new_status}"}


@router.delete("/vendors/{vendor_id}")
def delete_vendor(vendor_id: str, db: AdminDB) -> dict[str, str]:
    vendor = db.execute("SELECT id FROM vendors WHERE id = ?", (vendor_id,)).fetchone()
    if vendor is None:
        raise HTTPException(status_code=404, detail={"error": "Vendor not found"})

    with db:
        db.execute("DELETE FROM sales WHERE vendor_id = ?", (vendor["id"],))
        db.execute("DELETE FROM products WHERE vendor_id = ?", (vendor["id"],))
        db.execute("DELETE FROM vendors WHERE id = ?", (vendor["id"],))
    return {"message": "Vendor deleted"}

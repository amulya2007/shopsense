import sqlite3
import unittest
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import FastAPI
from jose import jwt

from analytics_api import main
from analytics_api.admin_routes import get_admin_db, router


def make_admin_database():
    connection = sqlite3.connect(":memory:", check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.executescript(
        """
        CREATE TABLE vendors (
            id INTEGER PRIMARY KEY, full_name TEXT NOT NULL, business_name TEXT NOT NULL,
            email TEXT NOT NULL, password TEXT NOT NULL, phone TEXT,
            business_address TEXT, status TEXT NOT NULL, joined_at TEXT NOT NULL
        );
        CREATE TABLE products (id INTEGER PRIMARY KEY, vendor_id INTEGER NOT NULL);
        CREATE TABLE sales (id INTEGER PRIMARY KEY, vendor_id INTEGER NOT NULL);
        INSERT INTO vendors VALUES
            (1, 'Alex One', 'Shop One', 'one@example.com', 'secret', '111', 'Address One', 'pending', '2025-01-01'),
            (2, 'Alex Two', 'Shop Two', 'two@example.com', 'secret', '222', 'Address Two', 'approved', '2025-02-01'),
            (3, 'Alex Three', 'Shop Three', 'three@example.com', 'secret', '333', 'Address Three', 'suspended', '2025-03-01');
        INSERT INTO products VALUES (1, 1), (2, 2);
        INSERT INTO sales VALUES (1, 1), (2, 2);
        """
    )
    return connection


class AdminRoutesTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.db = make_admin_database()
        self.app = FastAPI()
        self.app.include_router(router, prefix="/api/admin")
        self.app.dependency_overrides[get_admin_db] = lambda: self.db

    def tearDown(self):
        self.db.close()

    def token(self, role="admin"):
        return jwt.encode(
            {
                "id": 1,
                "role": role,
                "exp": datetime.now(timezone.utc) + timedelta(minutes=10),
            },
            main.JWT_SECRET,
            algorithm=main.JWT_ALGORITHM,
        )

    async def request(self, method, path, *, role="admin", json=None, auth=True):
        headers = {"Authorization": f"Bearer {self.token(role)}"} if auth else {}
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=self.app),
            base_url="http://test",
        ) as client:
            return await client.request(
                method, f"/api/admin{path}", headers=headers, json=json
            )

    async def test_authentication_matches_express_admin_middleware(self):
        missing = await self.request("GET", "/dashboard", auth=False)
        self.assertEqual((missing.status_code, missing.json()), (401, {"error": "Missing token"}))

        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=self.app), base_url="http://test"
        ) as client:
            invalid = await client.get(
                "/api/admin/dashboard", headers={"Authorization": "Bearer invalid"}
            )
        self.assertEqual(
            (invalid.status_code, invalid.json()),
            (401, {"error": "Invalid or expired token"}),
        )

        forbidden = await self.request("GET", "/dashboard", role="vendor")
        self.assertEqual(
            (forbidden.status_code, forbidden.json()),
            (403, {"error": "Forbidden for this role"}),
        )

    async def test_dashboard_and_vendor_listing_shapes_and_order(self):
        dashboard = await self.request("GET", "/dashboard")
        self.assertEqual(dashboard.status_code, 200)
        self.assertEqual(
            dashboard.json(),
            {
                "totalVendors": 3,
                "pending": 1,
                "approved": 1,
                "suspended": 1,
                "recentVendors": [
                    {
                        "id": 3,
                        "full_name": "Alex Three",
                        "business_name": "Shop Three",
                        "email": "three@example.com",
                        "status": "suspended",
                        "joined_at": "2025-03-01",
                    },
                    {
                        "id": 2,
                        "full_name": "Alex Two",
                        "business_name": "Shop Two",
                        "email": "two@example.com",
                        "status": "approved",
                        "joined_at": "2025-02-01",
                    },
                    {
                        "id": 1,
                        "full_name": "Alex One",
                        "business_name": "Shop One",
                        "email": "one@example.com",
                        "status": "pending",
                        "joined_at": "2025-01-01",
                    },
                ],
            },
        )

        all_vendors = await self.request("GET", "/vendors")
        self.assertEqual(all_vendors.status_code, 200)
        self.assertEqual(len(all_vendors.json()), 3)
        self.assertEqual(
            set(all_vendors.json()[0]),
            {
                "id", "full_name", "business_name", "email", "phone",
                "business_address", "status", "joined_at",
            },
        )
        pending = await self.request("GET", "/vendors?status=pending")
        self.assertEqual([vendor["id"] for vendor in pending.json()], [1])
        all_by_status = await self.request("GET", "/vendors?status=all")
        self.assertEqual(len(all_by_status.json()), 3)

    async def test_status_update_validates_and_persists(self):
        updated = await self.request(
            "PUT", "/vendors/1/status", json={"status": "approved"}
        )
        self.assertEqual((updated.status_code, updated.json()), (200, {"message": "Vendor approved"}))
        self.assertEqual(
            self.db.execute("SELECT status FROM vendors WHERE id = 1").fetchone()["status"],
            "approved",
        )

        invalid = await self.request(
            "PUT", "/vendors/1/status", json={"status": "deleted"}
        )
        self.assertEqual((invalid.status_code, invalid.json()), (400, {"error": "Invalid status"}))
        missing_status = await self.request("PUT", "/vendors/1/status", json={})
        self.assertEqual(
            (missing_status.status_code, missing_status.json()),
            (400, {"error": "Invalid status"}),
        )
        unknown = await self.request(
            "PUT", "/vendors/999/status", json={"status": "pending"}
        )
        self.assertEqual(
            (unknown.status_code, unknown.json()),
            (404, {"error": "Vendor not found"}),
        )

    async def test_delete_vendor_removes_owned_sales_products_and_vendor(self):
        deleted = await self.request("DELETE", "/vendors/1")
        self.assertEqual((deleted.status_code, deleted.json()), (200, {"message": "Vendor deleted"}))
        self.assertIsNone(self.db.execute("SELECT id FROM vendors WHERE id = 1").fetchone())
        self.assertIsNone(self.db.execute("SELECT id FROM products WHERE vendor_id = 1").fetchone())
        self.assertIsNone(self.db.execute("SELECT id FROM sales WHERE vendor_id = 1").fetchone())
        self.assertIsNotNone(self.db.execute("SELECT id FROM vendors WHERE id = 2").fetchone())
        self.assertIsNotNone(self.db.execute("SELECT id FROM products WHERE vendor_id = 2").fetchone())
        self.assertIsNotNone(self.db.execute("SELECT id FROM sales WHERE vendor_id = 2").fetchone())

        missing = await self.request("DELETE", "/vendors/999")
        self.assertEqual((missing.status_code, missing.json()), (404, {"error": "Vendor not found"}))


if __name__ == "__main__":
    unittest.main()

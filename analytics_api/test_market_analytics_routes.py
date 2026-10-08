import sqlite3
import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient

from analytics_api import main
from analytics_api.market_analytics_routes import router


def make_analytics_db():
    db = sqlite3.connect(":memory:", check_same_thread=False)
    db.row_factory = sqlite3.Row
    db.executescript(
        """
        CREATE TABLE vendors (
            id INTEGER PRIMARY KEY, full_name TEXT, business_name TEXT, email TEXT,
            status TEXT
        );
        CREATE TABLE products (
            id INTEGER PRIMARY KEY, vendor_id INTEGER, name TEXT, category TEXT,
            price REAL, stock INTEGER
        );
        CREATE TABLE sales (
            id INTEGER PRIMARY KEY, vendor_id INTEGER, product_id INTEGER,
            quantity INTEGER, amount REAL, sold_at TEXT
        );
        CREATE TABLE analytics_products (
            product_id TEXT PRIMARY KEY, product_name TEXT, category TEXT,
            price REAL, stock INTEGER
        );
        CREATE TABLE analytics_customers (
            customer_id TEXT PRIMARY KEY, customer_name TEXT, email TEXT
        );
        CREATE TABLE analytics_orders (
            order_id TEXT PRIMARY KEY, customer_id TEXT, order_date TEXT,
            total_amount REAL
        );
        CREATE TABLE analytics_order_items (
            order_id TEXT, product_id TEXT, quantity INTEGER, unit_price REAL
        );
        INSERT INTO vendors VALUES
            (1, 'Vendor One', 'One Shop', 'one@example.test', 'approved'),
            (2, 'Vendor Two', 'Two Shop', 'two@example.test', 'approved');
        INSERT INTO products VALUES
            (11, 1, 'Live Alpha', 'Home', 10, 2),
            (21, 2, 'Private Beta', 'Home', 20, 4);
        INSERT INTO sales VALUES
            (1, 1, 11, 3, 30, '2026-01-02 10:00:00'),
            (2, 2, 21, 5, 100, '2026-01-03 11:00:00');
        INSERT INTO analytics_products VALUES
            ('A', 'Alpha Mug', 'Home', 12.5, 8),
            ('B', 'Alpha Plate', 'Home', 20, 4),
            ('C', 'Beta Lamp', 'Office', 25, 6);
        INSERT INTO analytics_customers VALUES
            ('C1', 'Customer One', 'customer@example.test');
        INSERT INTO analytics_orders VALUES
            ('O1', 'C1', '2026-01-02', 32.5),
            ('O2', 'C1', '2026-01-03', 20);
        INSERT INTO analytics_order_items VALUES
            ('O1', 'A', 1, 12.5), ('O1', 'B', 1, 20),
            ('O2', 'A', 1, 12.5);
        """
    )
    return db


class MarketAnalyticsRoutesTests(unittest.TestCase):
    def setUp(self):
        self.db = make_analytics_db()
        self.user = main.TokenPayload(id=1, role="vendor", name="Vendor One")
        self.app = FastAPI()
        self.app.include_router(router, prefix="/api/analytics")

        def override_user():
            return self.user

        def override_db():
            yield self.db

        self.app.dependency_overrides[main.verify_token] = override_user
        self.app.dependency_overrides[main.get_db] = override_db
        self.client = TestClient(self.app)

    def tearDown(self):
        self.client.close()
        self.db.close()

    def test_vendor_scope_ignores_requested_other_vendor(self):
        response = self.client.get(
            "/api/analytics/reporting/summary?scope=vendor&vendorId=2"
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["vendorId"], 1)
        self.assertEqual(response.json()["totalRevenue"], 30)
        self.assertEqual(response.json()["topProduct"]["product_id"], 11)

    def test_inventory_and_top_products_preserve_historical_shapes(self):
        inventory = self.client.get(
            "/api/analytics/inventory?scope=dataset&search=Alpha&lowThreshold=0"
        )
        self.assertEqual(inventory.status_code, 200)
        self.assertEqual(inventory.json()["dataSource"], "historical_dataset")
        self.assertEqual(inventory.json()["summary"]["totalProducts"], 2)
        self.assertEqual(len(inventory.json()["products"]), 2)

        top = self.client.get("/api/analytics/top-products?limit=1000&category=Home")
        self.assertEqual(top.status_code, 200)
        payload = top.json()
        self.assertEqual(payload["limit"], 100)
        self.assertEqual(payload["category"], "Home")
        self.assertEqual(payload["products"][0]["product_id"], "A")
        self.assertEqual(
            payload["recommendationRule"],
            "Products are ranked by historical units sold, then historical revenue.",
        )

    def test_exports_are_csv_and_vendor_scoped(self):
        response = self.client.get(
            "/api/analytics/export/sales?scope=vendor&vendorId=2"
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "text/csv; charset=utf-8")
        self.assertIn('attachment; filename="sales_report.csv"', response.headers["content-disposition"])
        self.assertIn('"Live Alpha"', response.text)
        self.assertNotIn("Private Beta", response.text)

    def test_similarity_and_required_product_id_error_shape(self):
        missing = self.client.get("/api/analytics/similar-products")
        self.assertEqual(missing.status_code, 400)
        self.assertEqual(missing.json(), {"error": "productId is required"})

        response = self.client.get("/api/analytics/similar-products?productId=A")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["product"]["product_id"], "A")
        self.assertEqual(response.json()["similarProducts"][0]["product_id"], "B")


if __name__ == "__main__":
    unittest.main()

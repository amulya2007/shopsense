import os
import sqlite3
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from jose import jwt

from analytics_api import ai_rag, main


def make_catalog():
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    connection.executescript(
        """
        CREATE TABLE vendors (id INTEGER PRIMARY KEY, business_name TEXT NOT NULL);
        CREATE TABLE products (
            id INTEGER PRIMARY KEY, vendor_id INTEGER NOT NULL, name TEXT NOT NULL,
            description TEXT, category TEXT NOT NULL, price REAL NOT NULL,
            stock INTEGER NOT NULL, image_url TEXT
        );
        CREATE TABLE sales (
            id INTEGER PRIMARY KEY, vendor_id INTEGER NOT NULL, product_id INTEGER NOT NULL,
            quantity INTEGER NOT NULL
        );
        INSERT INTO vendors VALUES (1, 'Vendor One'), (2, 'Vendor Two');
        INSERT INTO products VALUES
            (1, 1, 'Flex Yoga Mat', 'Comfortable mat for stretching and yoga workouts.', 'Sports', 1199, 9, ''),
            (2, 1, 'Neoprene Dumbbell Pair', 'Dumbbells for strength workouts.', 'Sports', 1799, 0, ''),
            (3, 1, 'Smart Fitness Band', 'Activity tracking for daily workouts.', 'Electronics', 1999, 3, ''),
            (4, 1, 'Everyday Laptop Backpack', 'A backpack for carrying a laptop.', 'Accessories', 2199, 8, ''),
            (5, 2, 'Yoga Starter Mat', 'Yoga mat for exercise.', 'Sports', 499, 5, '');
        INSERT INTO sales VALUES (1, 1, 1, 12), (2, 1, 2, 4);
        """
    )
    return connection


class RetrievalTests(unittest.TestCase):
    def setUp(self):
        self.db = make_catalog()

    def tearDown(self):
        self.db.close()

    def test_fitness_search_is_relevant_and_vendor_scoped(self):
        result = ai_rag.retrieve_products(self.db, "What fitness products do you have?", 1)
        names = {product["name"] for product in result["products"]}

        self.assertIn("Flex Yoga Mat", names)
        self.assertIn("Neoprene Dumbbell Pair", names)
        self.assertIn("Smart Fitness Band", names)
        self.assertNotIn("Everyday Laptop Backpack", names)
        self.assertNotIn("Yoga Starter Mat", names)
        self.assertEqual(result["totalMatched"], 3)

    def test_price_category_and_stock_filters_are_hard_constraints(self):
        result = ai_rag.retrieve_products(
            self.db, "Show Sports products under ₹1,500 that are in stock", 1
        )

        self.assertEqual([product["name"] for product in result["products"]], ["Flex Yoga Mat"])
        self.assertEqual(result["totalMatched"], 1)
        self.assertEqual(result["products"][0]["vendorId"], 1)

    def test_price_range_and_out_of_stock_constraints(self):
        result = ai_rag.retrieve_products(
            self.db, "Show out-of-stock products between ₹1,500 and ₹2,000", 1
        )

        self.assertEqual([product["name"] for product in result["products"]], ["Neoprene Dumbbell Pair"])

    def test_laptop_query_does_not_match_a_laptop_backpack(self):
        result = ai_rag.retrieve_products(self.db, "Do you have a laptop?", 1)

        self.assertEqual(result["products"], [])

    def test_ranking_uses_catalog_values(self):
        result = ai_rag.retrieve_products(self.db, "Which is the most expensive product?", 1)

        self.assertEqual(result["products"][0]["name"], "Everyday Laptop Backpack")

    def test_counts_are_exact_for_price_filter(self):
        result = ai_rag.retrieve_products(self.db, "How many products are under Rs 1500?", 1)

        self.assertEqual(result["totalMatched"], 1)
        self.assertEqual(result["totalUnits"], 9)


class PythonGenerationTests(unittest.IsolatedAsyncioTestCase):
    async def test_configured_gemini_receives_retrieved_catalog_context(self):
        db = make_catalog()
        results = ai_rag.retrieve_products(db, "Show fitness products", 1)
        requests = []

        class FakeResponse:
            def raise_for_status(self):
                return None

            def json(self):
                return {"candidates": [{"content": {"parts": [{"text": "Here are your fitness products."}]}}]}

        class FakeClient:
            def __init__(self, timeout):
                self.timeout = timeout

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return None

            async def post(self, url, **kwargs):
                requests.append((url, kwargs))
                return FakeResponse()

        try:
            with patch.dict(os.environ, {"GEMINI_API_KEY": "test-key", "OPENAI_API_KEY": ""}):
                with patch("analytics_api.ai_rag.httpx.AsyncClient", FakeClient):
                    answer, provider = await ai_rag.generate_answer("Show fitness products", results)

            self.assertEqual(answer, "Here are your fitness products.")
            self.assertEqual(provider, "Gemini + Python RAG")
            self.assertIn("gemini-2.5-flash:generateContent", requests[0][0])
            prompt = requests[0][1]["json"]["contents"][0]["parts"][0]["text"]
            self.assertIn("Flex Yoga Mat", prompt)
        finally:
            db.close()


class PythonAiEndpointTests(unittest.TestCase):
    def setUp(self):
        self.temp_directory = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_directory.name) / "shopsense.db"
        connection = make_catalog()
        disk_connection = sqlite3.connect(self.db_path)
        connection.backup(disk_connection)
        disk_connection.close()
        connection.close()
        self.client = TestClient(main.app)

    def tearDown(self):
        self.temp_directory.cleanup()

    def _token(self, user_id, role):
        return jwt.encode(
            {
                "id": user_id,
                "role": role,
                "exp": datetime.now(timezone.utc) + timedelta(minutes=10),
            },
            main.JWT_SECRET,
            algorithm="HS256",
        )

    def test_vendor_token_controls_catalog_scope_and_response_shape(self):
        headers = {"Authorization": f"Bearer {self._token(1, 'vendor')}"}
        body = {
            "question": "Show my products",
            "vendorId": 2,
            "conversationHistory": [],
        }
        with patch.object(main, "DB_PATH", self.db_path), patch.dict(
            os.environ, {"GEMINI_API_KEY": "", "OPENAI_API_KEY": ""}
        ):
            response = self.client.post("/ai/shopping-assistant", headers=headers, json=body)

        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertEqual(set(result), {"answer", "products", "sources"})
        self.assertTrue(result["products"])
        self.assertTrue(all(product["vendorId"] == 1 for product in result["products"]))
        self.assertNotIn("Yoga Starter Mat", [product["name"] for product in result["products"]])

    def test_admin_must_select_a_vendor(self):
        headers = {"Authorization": f"Bearer {self._token(5, 'admin')}"}
        with patch.object(main, "DB_PATH", self.db_path):
            response = self.client.post(
                "/ai/shopping-assistant",
                headers=headers,
                json={"question": "Show products"},
            )

        self.assertEqual(response.status_code, 400)


if __name__ == "__main__":
    unittest.main()

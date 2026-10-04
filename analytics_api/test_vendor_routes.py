import sqlite3

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from jose import jwt

from . import vendor_routes
from .main import JWT_ALGORITHM, JWT_SECRET


@pytest.fixture
def client():
    connection = sqlite3.connect(":memory:", check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.executescript(
        """
        CREATE TABLE vendors (
            id INTEGER PRIMARY KEY, full_name TEXT, business_name TEXT, email TEXT,
            password TEXT, phone TEXT, business_address TEXT, status TEXT, joined_at TEXT
        );
        CREATE TABLE products (
            id INTEGER PRIMARY KEY AUTOINCREMENT, vendor_id INTEGER NOT NULL, name TEXT NOT NULL,
            description TEXT, category TEXT NOT NULL, price REAL NOT NULL, stock INTEGER NOT NULL,
            image_url TEXT, created_at TEXT DEFAULT '2026-01-01',
            seo_title TEXT DEFAULT '', short_description TEXT DEFAULT '', meta_title TEXT DEFAULT '',
            meta_description TEXT DEFAULT '', seo_keywords TEXT DEFAULT '', product_tags TEXT DEFAULT '',
            key_features TEXT DEFAULT '', vendor_hints TEXT DEFAULT ''
        );
        CREATE TABLE sales (
            id INTEGER PRIMARY KEY AUTOINCREMENT, vendor_id INTEGER, product_id INTEGER,
            quantity INTEGER, amount REAL, sold_at TEXT
        );
        INSERT INTO vendors VALUES (1, 'Vendor One', 'One Shop', 'one@example.com',
          'hash', '555', 'Address', 'approved', '2026-01-01');
        INSERT INTO products (vendor_id, name, description, category, price, stock)
          VALUES (1, 'Owned item', 'Good item', 'Home', 12.5, 3);
        INSERT INTO products (vendor_id, name, description, category, price, stock)
          VALUES (2, 'Other item', 'Other', 'Home', 9, 50);
        """
    )

    def override_db():
        yield connection

    app = FastAPI()
    app.include_router(vendor_routes.router)
    app.dependency_overrides[vendor_routes._db] = override_db
    with TestClient(app) as test_client:
        yield test_client
    connection.close()


def auth(role="vendor", user_id=1):
    token = jwt.encode({"id": user_id, "role": role}, JWT_SECRET, algorithm=JWT_ALGORITHM)
    return {"Authorization": f"Bearer {token}"}


def test_auth_and_vendor_catalog_isolation(client):
    assert client.get("/api/vendor/products").status_code == 401
    forbidden = client.get("/api/vendor/products", headers=auth(role="admin"))
    assert forbidden.status_code == 403
    response = client.get("/api/vendor/products", headers=auth())
    assert response.status_code == 200
    assert [item["name"] for item in response.json()] == ["Owned item"]


def test_product_create_stock_update_and_inventory(client):
    headers = auth()
    created = client.post(
        "/api/vendor/products",
        headers=headers,
        json={
            "name": "New item", "description": "New description", "category": "Home",
            "price": 7.25, "stock": 2,
        },
    )
    assert created.status_code == 201
    product_id = created.json()["id"]

    stock = client.patch(
        f"/api/vendor/products/{product_id}/stock",
        headers=headers,
        json={"stock": 0},
    )
    assert stock.status_code == 200
    assert stock.json() == {
        "message": "Stock updated successfully",
        "productId": product_id,
        "productName": "New item",
        "stock": 0,
    }

    inventory = client.get("/api/vendor/inventory?lowThreshold=3", headers=headers)
    assert inventory.status_code == 200
    assert inventory.json()["summary"] == {
        "totalProducts": 2,
        "totalStock": 3,
        "lowStockProducts": 1,
        "outOfStockProducts": 1,
    }


def test_validation_and_tenant_scoped_mutations(client):
    headers = auth()
    bad_create = client.post(
        "/api/vendor/products",
        headers=headers,
        json={"name": "Bad", "description": "Bad", "category": "Home", "price": 1, "stock": -1},
    )
    assert bad_create.status_code == 400
    assert bad_create.json() == {"error": "Stock must be a non-negative whole number"}

    foreign_delete = client.delete("/api/vendor/products/2", headers=headers)
    assert foreign_delete.status_code == 404
    invalid_threshold = client.get("/api/vendor/inventory?lowThreshold=-1", headers=headers)
    assert invalid_threshold.status_code == 400
    assert invalid_threshold.json() == {
        "error": "lowThreshold must be a non-negative whole number"
    }

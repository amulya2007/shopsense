import sqlite3
import unittest
import os
from unittest.mock import patch

import httpx
import bcrypt

from analytics_api import main
from analytics_api.auth_routes import _send_verification_email


def make_auth_database():
    connection = sqlite3.connect(":memory:", check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.executescript(
        """
        CREATE TABLE admins (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            email_verified INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE vendors (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            full_name TEXT NOT NULL,
            business_name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            phone TEXT,
            business_address TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            joined_at TEXT NOT NULL DEFAULT (datetime('now')),
            email_verified INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE email_verifications (
            account_type TEXT NOT NULL,
            account_id INTEGER NOT NULL,
            token_hash TEXT NOT NULL UNIQUE,
            expires_at TEXT NOT NULL,
            sent_at TEXT NOT NULL,
            verified_at TEXT,
            PRIMARY KEY (account_type, account_id)
        );
        """
    )
    return connection


class EmailAuthenticationTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.db = make_auth_database()
        self.sent_tokens = []

        def override_db():
            yield self.db

        main.app.dependency_overrides[main.get_db] = override_db
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app),
            base_url="http://test",
        )

    async def asyncTearDown(self):
        await self.client.aclose()
        main.app.dependency_overrides.pop(main.get_db, None)
        self.db.close()

    def capture_email(self, email, _name, token):
        self.sent_tokens.append((email, token))

    async def test_health_endpoint_accepts_existing_api_prefix(self):
        response = await self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")

    @patch("analytics_api.auth_routes._send_verification_email")
    async def test_vendor_must_verify_email_and_be_approved_before_login(self, send_email):
        send_email.side_effect = self.capture_email
        registration = await self.client.post(
            "/api/auth/register",
            json={
                "fullName": "Casey Vendor",
                "businessName": "Casey Goods",
                "email": "CASEY@example.com",
                "password": "correct-horse-battery",
            },
        )
        self.assertEqual(registration.status_code, 201)
        self.assertEqual(self.sent_tokens[0][0], "casey@example.com")
        self.assertEqual(
            self.db.execute("SELECT email_verified FROM vendors").fetchone()["email_verified"],
            0,
        )

        login_before_verification = await self.client.post(
            "/api/auth/login",
            json={"email": "casey@example.com", "password": "correct-horse-battery", "role": "vendor"},
        )
        self.assertEqual(login_before_verification.status_code, 403)
        self.assertEqual(login_before_verification.headers.get("x-email-verification-required"), "true")

        verification = await self.client.post(
            "/api/auth/verify-email",
            json={"token": self.sent_tokens[0][1]},
        )
        self.assertEqual(verification.status_code, 200)

        awaiting_approval = await self.client.post(
            "/api/auth/login",
            json={"email": "casey@example.com", "password": "correct-horse-battery", "role": "vendor"},
        )
        self.assertEqual(awaiting_approval.status_code, 403)
        self.assertIn("awaiting admin approval", awaiting_approval.json()["error"])

        self.db.execute("UPDATE vendors SET status = 'approved'")
        approved_login = await self.client.post(
            "/api/auth/login",
            json={"email": "casey@example.com", "password": "correct-horse-battery", "role": "vendor"},
        )
        self.assertEqual(approved_login.status_code, 200)
        self.assertEqual(approved_login.json()["user"]["role"], "vendor")
        self.assertIn("token", approved_login.json())

        repeated_verification = await self.client.post(
            "/api/auth/verify-email",
            json={"token": self.sent_tokens[0][1]},
        )
        self.assertEqual(repeated_verification.status_code, 200)

    @patch("analytics_api.auth_routes._send_verification_email")
    async def test_invalid_email_is_rejected_without_creating_an_account(self, send_email):
        response = await self.client.post(
            "/api/auth/register",
            json={
                "fullName": "Invalid Person",
                "businessName": "Invalid Goods",
                "email": "not-an-email",
                "password": "correct-horse-battery",
            },
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM vendors").fetchone()[0], 0)
        send_email.assert_not_called()

    @patch("analytics_api.auth_routes._send_verification_email")
    async def test_mail_failure_rolls_back_registration(self, send_email):
        from fastapi import HTTPException

        send_email.side_effect = HTTPException(status_code=503, detail="Mail unavailable.")
        response = await self.client.post(
            "/api/auth/register",
            json={
                "fullName": "Casey Vendor",
                "businessName": "Casey Goods",
                "email": "casey@example.com",
                "password": "correct-horse-battery",
            },
        )
        self.assertEqual(response.status_code, 503)
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM vendors").fetchone()[0], 0)
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM email_verifications").fetchone()[0], 0)

    @patch("analytics_api.auth_routes._send_verification_email")
    async def test_existing_unverified_admin_can_request_verification(self, send_email):
        send_email.side_effect = self.capture_email
        self.db.execute(
            "INSERT INTO admins (name, email, password, email_verified) VALUES (?, ?, ?, 0)",
            ("Admin Person", "admin@example.com", "unused"),
        )
        response = await self.client.post(
            "/api/auth/resend-verification",
            json={"email": "admin@example.com", "role": "admin"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.sent_tokens[0][0], "admin@example.com")
        verified = await self.client.post(
            "/api/auth/verify-email",
            json={"token": self.sent_tokens[0][1]},
        )
        self.assertEqual(verified.status_code, 200)

    @patch("analytics_api.auth_routes._send_verification_email")
    async def test_unverified_admin_cannot_login_until_mailbox_is_confirmed(self, send_email):
        send_email.side_effect = self.capture_email
        password = "a-unique-admin-password"
        password_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=4)).decode()
        self.db.execute(
            "INSERT INTO admins (name, email, password, email_verified) VALUES (?, ?, ?, 0)",
            ("Admin Person", "admin@example.com", password_hash),
        )

        login_before_verification = await self.client.post(
            "/api/auth/login",
            json={"email": "admin@example.com", "password": password, "role": "admin"},
        )
        self.assertEqual(login_before_verification.status_code, 403)
        self.assertEqual(login_before_verification.headers.get("x-email-verification-required"), "true")

        await self.client.post(
            "/api/auth/resend-verification",
            json={"email": "admin@example.com", "role": "admin"},
        )
        await self.client.post(
            "/api/auth/verify-email",
            json={"token": self.sent_tokens[0][1]},
        )
        verified_login = await self.client.post(
            "/api/auth/login",
            json={"email": "admin@example.com", "password": password, "role": "admin"},
        )
        self.assertEqual(verified_login.status_code, 200)
        self.assertEqual(verified_login.json()["user"]["role"], "admin")

    @patch.dict(
        os.environ,
        {
            "SMTP_HOST": "smtp.example.test",
            "SMTP_PORT": "587",
            "SMTP_USERNAME": "shop@example.test",
            "SMTP_PASSWORD": "test-secret",
            "SMTP_FROM_EMAIL": "shop@example.test",
            "CLIENT_ORIGIN": "https://shopsense.example.test",
        },
    )
    @patch("analytics_api.auth_routes.smtplib.SMTP")
    def test_verification_email_contains_frontend_link(self, smtp_class):
        smtp = smtp_class.return_value.__enter__.return_value
        _send_verification_email("person@example.test", "Test Person", "test-token")
        message = smtp.send_message.call_args.args[0]
        self.assertEqual(message["To"], "person@example.test")
        self.assertEqual(message["From"], "shop@example.test")
        self.assertIn(
            "https://shopsense.example.test/register?verifyEmailToken=test-token",
            message.get_body(preferencelist=("plain",)).get_content(),
        )
        smtp.starttls.assert_called_once()

    @patch.dict(os.environ, {}, clear=True)
    def test_email_delivery_fails_explicitly_without_smtp_configuration(self):
        from fastapi import HTTPException

        with self.assertRaises(HTTPException) as error:
            _send_verification_email("person@example.test", "Test Person", "test-token")
        self.assertEqual(error.exception.status_code, 503)

    @patch.dict(
        os.environ,
        {
            "BOOTSTRAP_ADMIN_EMAIL": "owner@example.com",
            "BOOTSTRAP_ADMIN_NAME": "Store Owner",
            "BOOTSTRAP_ADMIN_PASSWORD": "owner-unique-password",
        },
    )
    @patch("analytics_api.auth_routes._send_verification_email")
    async def test_bootstrap_creates_real_admin_alongside_unverified_legacy_admin(self, send_email):
        send_email.side_effect = self.capture_email
        self.db.execute(
            "INSERT INTO admins (name, email, password, email_verified) VALUES (?, ?, ?, 0)",
            ("Demo Admin", "admin@demo.com", "old-hash"),
        )

        response = await self.client.post("/api/auth/bootstrap-admin")

        self.assertEqual(response.status_code, 201)
        account = self.db.execute(
            "SELECT name, email_verified FROM admins WHERE email = ?",
            ("owner@example.com",),
        ).fetchone()
        self.assertEqual(account["name"], "Store Owner")
        self.assertEqual(account["email_verified"], 0)
        self.assertEqual(self.sent_tokens[0][0], "owner@example.com")


if __name__ == "__main__":
    unittest.main()

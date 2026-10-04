import sqlite3
import unittest
import os
from urllib.parse import parse_qs, urlparse
from unittest.mock import patch

import httpx
import bcrypt

from analytics_api import main
from analytics_api.auth_routes import (
    _send_verification_email,
    _smtp_settings,
    log_email_configuration,
)


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

    async def test_cors_allows_frontend_write_requests(self):
        response = await self.client.options(
            "/api/vendor/products/1",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "DELETE",
                "Access-Control-Request-Headers": "authorization,content-type",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get("access-control-allow-origin"), "http://localhost:5173")
        self.assertIn("DELETE", response.headers.get("access-control-allow-methods", ""))

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
        self.assertEqual(repeated_verification.status_code, 400)

    @patch.dict(
        os.environ,
        {
            "SMTP_HOST": "smtp.example.test",
            "SMTP_PORT": "587",
            "SMTP_USERNAME": "shop@example.test",
            "SMTP_PASSWORD": "test-secret",
            "SMTP_FROM": "shop@example.test",
            "CLIENT_ORIGIN": "http://localhost:5173",
            "APP_ENV": "test",
            "EMAIL_DELIVERY_MODE": "smtp",
        },
    )
    @patch("analytics_api.auth_routes.smtplib.SMTP")
    async def test_registration_sends_link_that_verifies_account(self, smtp_class):
        smtp = smtp_class.return_value.__enter__.return_value
        response = await self.client.post(
            "/api/auth/register",
            json={
                "fullName": "Casey Example",
                "businessName": "Casey Goods",
                "email": "casey@example.com",
                "password": "correct-horse-battery",
            },
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["email"], "casey@example.com")
        smtp.starttls.assert_called_once()
        smtp.send_message.assert_called_once()
        message = smtp.send_message.call_args.args[0]
        verification_link = next(
            line
            for line in message.get_body(preferencelist=("plain",)).get_content().splitlines()
            if line.startswith("http://localhost:5173/register?")
        )
        parsed_link = urlparse(verification_link)
        self.assertEqual(parsed_link.path, "/register")
        token = parse_qs(parsed_link.query)["verifyEmailToken"][0]

        verification = await self.client.post("/api/auth/verify-email", json={"token": token})

        self.assertEqual(verification.status_code, 200)
        self.assertEqual(
            self.db.execute(
                "SELECT email_verified FROM vendors WHERE email = ?",
                ("casey@example.com",),
            ).fetchone()[0],
            1,
        )

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
    async def test_resend_rotates_token_and_unknown_email_gets_same_response(self, send_email):
        send_email.side_effect = self.capture_email
        self.db.execute(
            "INSERT INTO admins (name, email, password, email_verified) VALUES (?, ?, ?, 0)",
            ("Admin Person", "admin@example.com", "unused"),
        )
        first = await self.client.post("/api/auth/resend-verification", json={"email": "admin@example.com", "role": "admin"})
        self.db.execute("UPDATE email_verifications SET sent_at = '2000-01-01T00:00:00+00:00'")
        second = await self.client.post("/api/auth/resend-verification", json={"email": "admin@example.com", "role": "admin"})
        self.assertEqual((first.status_code, second.status_code), (200, 200))
        self.assertNotEqual(self.sent_tokens[0][1], self.sent_tokens[1][1])
        old_token = await self.client.post("/api/auth/verify-email", json={"token": self.sent_tokens[0][1]})
        self.assertEqual(old_token.status_code, 400)
        unknown = await self.client.post("/api/auth/resend-verification", json={"email": "absent@example.com", "role": "admin"})
        self.assertEqual(unknown.json(), second.json())

    @patch("analytics_api.auth_routes._send_verification_email")
    async def test_expired_token_is_removed(self, send_email):
        send_email.side_effect = self.capture_email
        await self.client.post("/api/auth/register", json={
            "fullName": "Casey Vendor", "businessName": "Casey Goods",
            "email": "expiry@example.com", "password": "correct-horse-battery",
        })
        self.db.execute("UPDATE email_verifications SET expires_at = '2000-01-01T00:00:00+00:00'")
        expired = await self.client.post("/api/auth/verify-email", json={"token": self.sent_tokens[0][1]})
        self.assertEqual(expired.status_code, 400)
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM email_verifications").fetchone()[0], 0)

    @patch.dict(os.environ, {"APP_ENV": "production", "EMAIL_DELIVERY_MODE": "console", "ALLOW_DEV_EMAIL_PREVIEW": "true"}, clear=True)
    def test_production_rejects_development_email_preview(self):
        from fastapi import HTTPException
        with self.assertRaises(HTTPException):
            _send_verification_email("person@example.test", "Test Person", "a" * 43)

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
            "SMTP_USE_SSL": "false",
            "CLIENT_ORIGIN": "https://shopsense.example.test",
            "APP_ENV": "test",
            "EMAIL_DELIVERY_MODE": "smtp",
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
        self.assertIn("SMTP_USERNAME", error.exception.detail)
        self.assertIn("SMTP_PASSWORD", error.exception.detail)

    @patch.dict(os.environ, {"SMTP_HOST": "smtp.gmail.com", "SMTP_PORT": "587"}, clear=True)
    def test_missing_email_error_only_names_values_that_are_missing(self):
        from fastapi import HTTPException

        with self.assertRaises(HTTPException) as error:
            _smtp_settings()
        self.assertEqual(error.exception.status_code, 503)
        self.assertIn("SMTP_USERNAME, SMTP_PASSWORD", error.exception.detail)
        self.assertNotIn("SMTP_HOST", error.exception.detail)

    @patch.dict(
        os.environ,
        {
            "SMTP_HOST": "smtp.example.test",
            "SMTP_PORT": "587",
            "SMTP_USERNAME": "shop@example.test",
            "SMTP_PASSWORD": "secret-that-must-not-be-logged",
            "SMTP_FROM": "preferred@example.test",
            "SMTP_FROM_EMAIL": "legacy@example.test",
        },
        clear=True,
    )
    def test_smtp_from_precedes_legacy_sender_alias(self):
        self.assertEqual(_smtp_settings()[4], "preferred@example.test")

    @patch.dict(
        os.environ,
        {
            "SMTP_HOST": "smtp.example.test",
            "SMTP_PORT": "587",
            "SMTP_USERNAME": "shop@example.test",
            "SMTP_PASSWORD": "secret-that-must-not-be-logged",
            "SMTP_FROM": "shop@example.test",
        },
        clear=True,
    )
    def test_smtp_readiness_log_never_contains_credentials(self):
        with self.assertLogs("analytics_api.auth_routes", level="INFO") as captured:
            log_email_configuration()
        output = "\n".join(captured.output)
        self.assertIn("SMTP configuration detected", output)
        self.assertNotIn("secret-that-must-not-be-logged", output)
        self.assertNotIn("shop@example.test", output)

    @patch.dict(os.environ, {}, clear=True)
    def test_missing_smtp_configuration_logs_warning_without_stopping_startup(self):
        with self.assertLogs("analytics_api.auth_routes", level="WARNING") as captured:
            log_email_configuration()
        self.assertIn("SMTP configuration unavailable", "\n".join(captured.output))

    @patch.dict(
        os.environ,
        {
            "SMTP_HOST": "smtp.example.test",
            "SMTP_PORT": "587",
            "SMTP_USERNAME": "shop@example.test",
            "SMTP_PASSWORD": "secret-that-must-not-be-logged",
            "SMTP_FROM": "shop@example.test",
            "CLIENT_ORIGIN": "https://shopsense.example.test",
            "APP_ENV": "test",
            "EMAIL_DELIVERY_MODE": "smtp",
        },
        clear=True,
    )
    @patch("analytics_api.auth_routes.smtplib.SMTP")
    def test_delivery_logs_attempt_and_success_without_password(self, smtp_class):
        with self.assertLogs("analytics_api.auth_routes", level="INFO") as captured:
            _send_verification_email("person@example.test", "Test Person", "test-token")
        output = "\n".join(captured.output)
        self.assertIn("Attempting verification email delivery", output)
        self.assertIn("Verification email delivered successfully", output)
        self.assertNotIn("secret-that-must-not-be-logged", output)
        smtp_class.return_value.__enter__.return_value.starttls.assert_called_once()

    @patch.dict(
        os.environ,
        {
            "SMTP_HOST": "smtp.example.test",
            "SMTP_PORT": "587",
            "SMTP_USERNAME": "shop@example.test",
            "SMTP_PASSWORD": "secret-that-must-not-be-logged",
            "SMTP_FROM": "shop@example.test",
            "APP_ENV": "test",
            "EMAIL_DELIVERY_MODE": "smtp",
        },
        clear=True,
    )
    @patch("analytics_api.auth_routes.smtplib.SMTP", side_effect=OSError("connection refused"))
    def test_delivery_failure_is_logged_without_password(self, _smtp_class):
        from fastapi import HTTPException

        with self.assertLogs("analytics_api.auth_routes", level="ERROR") as captured:
            with self.assertRaises(HTTPException):
                _send_verification_email("person@example.test", "Test Person", "test-token")
        output = "\n".join(captured.output)
        self.assertIn("Verification email delivery failed", output)
        self.assertNotIn("secret-that-must-not-be-logged", output)

    @patch.dict(
        os.environ,
        {
            "SMTP_HOST": "smtp.example.test",
            "SMTP_PORT": "587",
            "SMTP_USERNAME": "shop@example.test",
            "SMTP_PASSWORD": "test-secret",
            "SMTP_FROM_EMAIL": "",
        },
        clear=True,
    )
    def test_blank_sender_address_defaults_to_smtp_username(self):
        self.assertEqual(_smtp_settings()[4], "shop@example.test")

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

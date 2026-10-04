"""Email-verified account registration and login endpoints."""

import hashlib
import html
import os
import secrets
import smtplib
import ssl
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from email.utils import parseaddr
from urllib.parse import urlencode

import bcrypt
from email_validator import EmailNotValidError, validate_email
from fastapi import APIRouter, Depends, HTTPException, status
from jose import jwt
from pydantic import BaseModel, Field

from .database import DB_PATH
from .main import DBConn, JWT_ALGORITHM, JWT_SECRET, TokenPayload


router = APIRouter(prefix="/auth", tags=["Authentication"])
VERIFICATION_TTL = timedelta(minutes=30)
RESEND_COOLDOWN = timedelta(seconds=60)


class RegistrationRequest(BaseModel):
    fullName: str = Field(min_length=1, max_length=120)
    businessName: str = Field(min_length=1, max_length=160)
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=8, max_length=72)
    phone: str | None = Field(default=None, max_length=40)
    businessAddress: str | None = Field(default=None, max_length=300)


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=72)
    role: str


class VerifyEmailRequest(BaseModel):
    token: str = Field(min_length=32, max_length=128)


class ResendVerificationRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    role: str


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_email(raw_email: str) -> str:
    try:
        return validate_email(raw_email.strip(), check_deliverability=False).normalized.lower()
    except EmailNotValidError as exc:
        raise HTTPException(status_code=400, detail="Enter a valid email address.") from exc


def _smtp_settings() -> tuple[str, int, str, str, str, bool]:
    host = os.getenv("SMTP_HOST", "").strip()
    username = os.getenv("SMTP_USERNAME", "").strip()
    password = os.getenv("SMTP_PASSWORD", "")
    sender = os.getenv("SMTP_FROM_EMAIL", username).strip()
    if not all((host, username, password, sender)):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Email verification is not configured. Contact the administrator.",
        )
    try:
        port = int(os.getenv("SMTP_PORT", "587"))
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The email verification service is misconfigured.",
        ) from exc
    if not 1 <= port <= 65535:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The email verification service is misconfigured.",
        )
    use_ssl = os.getenv("SMTP_USE_SSL", "").lower() in {"1", "true", "yes"}
    return host, port, username, password, sender, use_ssl


def _send_verification_email(email: str, name: str, token: str) -> None:
    host, port, username, password, sender, use_ssl = _smtp_settings()
    client_origin = os.getenv("CLIENT_ORIGIN", "http://localhost:5173").rstrip("/")
    query = urlencode({"verifyEmailToken": token})
    verification_url = f"{client_origin}/register?{query}"

    message = EmailMessage()
    message["Subject"] = "Verify your ShopSense email address"
    message["From"] = sender
    message["To"] = email
    message.set_content(
        f"Hello {name},\n\n"
        f"Verify your email address to continue with ShopSense:\n{verification_url}\n\n"
        "This link expires in 30 minutes. If you did not request this, you can ignore this email."
    )
    message.add_alternative(
        "<p>Hello "
        + html.escape(name)
        + ",</p><p>Verify your email address to continue with ShopSense:</p>"
        + '<p><a href="'
        + html.escape(verification_url, quote=True)
        + '">Verify email address</a></p>'
        + "<p>This link expires in 30 minutes. If you did not request this, you can ignore this email.</p>",
        subtype="html",
    )

    try:
        if use_ssl:
            with smtplib.SMTP_SSL(host, port, context=ssl.create_default_context(), timeout=15) as client:
                client.login(username, password)
                client.send_message(message)
        else:
            with smtplib.SMTP(host, port, timeout=15) as client:
                client.ehlo()
                client.starttls(context=ssl.create_default_context())
                client.ehlo()
                client.login(username, password)
                client.send_message(message)
    except (OSError, smtplib.SMTPException) as exc:
        print(f"[ShopSense Auth] Could not send verification email: {exc}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="We could not send the verification email. Please try again later.",
        ) from exc


def _issue_verification(
    db,
    account_type: str,
    account_id: int,
    email: str,
    name: str,
) -> None:
    row = db.execute(
        "SELECT sent_at FROM email_verifications WHERE account_type = ? AND account_id = ?",
        (account_type, account_id),
    ).fetchone()
    if row:
        try:
            sent_at = datetime.fromisoformat(row["sent_at"])
        except ValueError:
            sent_at = _now() - RESEND_COOLDOWN
        if _now() - sent_at < RESEND_COOLDOWN:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Please wait before requesting another verification email.",
            )

    token = secrets.token_urlsafe(32)
    sent_at = _now()
    expires_at = sent_at + VERIFICATION_TTL
    db.execute(
        """
        INSERT INTO email_verifications (account_type, account_id, token_hash, expires_at, sent_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(account_type, account_id) DO UPDATE SET
            token_hash = excluded.token_hash,
            expires_at = excluded.expires_at,
            sent_at = excluded.sent_at
        """,
        (
            account_type,
            account_id,
            hashlib.sha256(token.encode("utf-8")).hexdigest(),
            expires_at.isoformat(),
            sent_at.isoformat(),
        ),
    )
    _send_verification_email(email, name, token)


def _account_table(role: str) -> str:
    if role not in {"admin", "vendor"}:
        raise HTTPException(status_code=400, detail="Invalid role.")
    return "admins" if role == "admin" else "vendors"


@router.post("/register", status_code=status.HTTP_201_CREATED)
def register(request: RegistrationRequest, db: DBConn) -> dict[str, str]:
    email = _normalize_email(request.email)
    full_name = request.fullName.strip()
    business_name = request.businessName.strip()
    if not full_name or not business_name:
        raise HTTPException(status_code=400, detail="Name and business name are required.")
    if len(request.password.encode("utf-8")) > 72:
        raise HTTPException(status_code=400, detail="Password must be no longer than 72 bytes.")

    existing = db.execute(
        "SELECT 1 FROM vendors WHERE lower(email) = ?",
        (email,),
    ).fetchone()
    if existing:
        raise HTTPException(status_code=409, detail="An account with this email already exists.")

    password_hash = bcrypt.hashpw(request.password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode()
    try:
        with db:
            cursor = db.execute(
                """
                INSERT INTO vendors
                    (full_name, business_name, email, password, phone, business_address, status, email_verified)
                VALUES (?, ?, ?, ?, ?, ?, 'pending', 0)
                """,
                (
                    full_name,
                    business_name,
                    email,
                    password_hash,
                    request.phone.strip() if request.phone else None,
                    request.businessAddress.strip() if request.businessAddress else None,
                ),
            )
            _issue_verification(db, "vendor", cursor.lastrowid, email, full_name)
    except HTTPException:
        raise
    except Exception as exc:
        if "UNIQUE constraint failed" in str(exc):
            raise HTTPException(
                status_code=409,
                detail="An account with this email already exists.",
            ) from exc
        raise

    return {
        "message": "Registration submitted. Verify your email address before admin review.",
        "email": email,
    }


@router.post("/verify-email")
def verify_email(request: VerifyEmailRequest, db: DBConn) -> dict[str, str]:
    token_hash = hashlib.sha256(request.token.encode("utf-8")).hexdigest()
    verification = db.execute(
        "SELECT account_type, account_id, expires_at FROM email_verifications WHERE token_hash = ?",
        (token_hash,),
    ).fetchone()
    if not verification:
        raise HTTPException(status_code=400, detail="This verification link is invalid or has expired.")
    try:
        expires_at = datetime.fromisoformat(verification["expires_at"])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="This verification link is invalid or has expired.") from exc
    if expires_at <= _now():
        db.execute(
            "DELETE FROM email_verifications WHERE account_type = ? AND account_id = ?",
            (verification["account_type"], verification["account_id"]),
        )
        raise HTTPException(status_code=400, detail="This verification link is invalid or has expired.")

    table = _account_table(verification["account_type"])
    with db:
        result = db.execute(
            f"UPDATE {table} SET email_verified = 1 WHERE id = ?",
            (verification["account_id"],),
        )
        if result.rowcount != 1:
            raise HTTPException(status_code=400, detail="This verification link is invalid or has expired.")
        db.execute(
            "DELETE FROM email_verifications WHERE account_type = ? AND account_id = ?",
            (verification["account_type"], verification["account_id"]),
        )
    return {"message": "Email address verified. You can now sign in."}


@router.post("/resend-verification")
def resend_verification(request: ResendVerificationRequest, db: DBConn) -> dict[str, str]:
    table = _account_table(request.role)
    email = _normalize_email(request.email)
    account = db.execute(
        f"SELECT id, name AS display_name, 1 AS is_admin, email_verified FROM admins "
        "WHERE lower(email) = ?"
        if table == "admins"
        else "SELECT id, full_name AS display_name, 0 AS is_admin, email_verified FROM vendors "
        "WHERE lower(email) = ?",
        (email,),
    ).fetchone()
    if account and not account["email_verified"]:
        with db:
            _issue_verification(
                db,
                request.role,
                account["id"],
                email,
                account["display_name"],
            )
    return {
        "message": "If the account exists and needs verification, a verification email has been sent."
    }


@router.post("/login")
def login(request: LoginRequest, db: DBConn) -> dict:
    table = _account_table(request.role)
    email = _normalize_email(request.email)
    if len(request.password.encode("utf-8")) > 72:
        raise HTTPException(status_code=401, detail=f"Invalid {request.role} credentials.")
    account = db.execute(
        f"SELECT * FROM {table} WHERE lower(email) = ?",
        (email,),
    ).fetchone()
    try:
        password_valid = account is not None and bcrypt.checkpw(
            request.password.encode("utf-8"),
            account["password"].encode("utf-8"),
        )
    except (ValueError, TypeError):
        password_valid = False
    if not password_valid:
        raise HTTPException(status_code=401, detail=f"Invalid {request.role} credentials.")
    if not account["email_verified"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Verify your email address before signing in. Use the resend verification option if needed.",
            headers={"X-Email-Verification-Required": "true"},
        )

    if request.role == "vendor":
        if account["status"] == "pending":
            raise HTTPException(status_code=403, detail="Your account is still awaiting admin approval.")
        if account["status"] == "suspended":
            raise HTTPException(status_code=403, detail="Your account has been suspended. Contact the admin.")
        payload = {
            "id": account["id"],
            "role": "vendor",
            "name": account["full_name"],
            "businessName": account["business_name"],
            "email": account["email"],
        }
        user = {
            **payload,
            "status": account["status"],
        }
    else:
        payload = {
            "id": account["id"],
            "role": "admin",
            "name": account["name"],
            "email": account["email"],
        }
        user = payload

    expires_at = _now() + timedelta(days=7)
    token = jwt.encode(
        {**payload, "exp": expires_at},
        JWT_SECRET,
        algorithm=JWT_ALGORITHM,
    )
    return {"token": token, "user": user}


@router.post("/bootstrap-admin", status_code=status.HTTP_201_CREATED)
def bootstrap_admin(db: DBConn) -> dict[str, str]:
    """Create the first admin from environment credentials; the email still must be verified."""
    if db.execute("SELECT 1 FROM admins LIMIT 1").fetchone():
        raise HTTPException(status_code=409, detail="An administrator is already configured.")
    email = _normalize_email(os.getenv("BOOTSTRAP_ADMIN_EMAIL", ""))
    name = os.getenv("BOOTSTRAP_ADMIN_NAME", "").strip() or "ShopSense Administrator"
    password = os.getenv("BOOTSTRAP_ADMIN_PASSWORD", "")
    if not password:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD before bootstrapping an administrator.",
        )
    if len(password) < 12 or len(password.encode("utf-8")) > 72:
        raise HTTPException(
            status_code=400,
            detail="The bootstrap password must be 12-72 bytes long.",
        )
    password_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode()
    with db:
        cursor = db.execute(
            "INSERT INTO admins (name, email, password, email_verified) VALUES (?, ?, ?, 0)",
            (name, email, password_hash),
        )
        _issue_verification(db, "admin", cursor.lastrowid, email, name)
    return {"message": "Administrator created. Verify its email address before signing in."}

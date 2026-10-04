# ShopSense Python API

FastAPI is the application's backend for authentication, email verification, vendor and admin
operations, analytics, and AI/RAG. JavaScript is used by the React frontend only.

## Install and run

From the repository root on Windows:

```powershell
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r analytics_api\requirements.txt
Copy-Item .env.example .env
# Configure SMTP credentials, a strong JWT_SECRET, and the initial admin values in .env.
npm run dev
```

On macOS/Linux, use `python3 -m venv .venv` and the `.venv/bin/python` executable.
The startup command starts FastAPI on port 8000 and automatically uses the project virtual
environment when it exists.

## Email verification and accounts

Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, and `SMTP_FROM_EMAIL`.
Gmail users must use an app password. Email ownership is proven by a one-time verification
link that expires after 30 minutes; malformed addresses and unverified accounts cannot log in.
New vendor applications also require the existing administrator approval after email
verification.

Set `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_NAME`, and a unique
`BOOTSTRAP_ADMIN_PASSWORD` (12-72 bytes) in `.env`, then make the one-time request:

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:8000/api/auth/bootstrap-admin
```

Existing accounts are migrated as unverified. Their owners must use the sign-in page's resend
verification flow. Do not share admin or SMTP passwords or commit `.env`.

## Endpoints

Both the established `/api/*` frontend paths and native paths without `/api` are accepted.
All account, vendor, admin, AI, and analytics operations require the appropriate bearer JWT.

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Health check |
| POST | `/auth/register` | Register a vendor and send verification email |
| POST | `/auth/verify-email` | Verify a single-use email link |
| POST | `/auth/resend-verification` | Resend a pending email-verification link |
| POST | `/auth/login` | Verified admin or vendor login |
| POST | `/auth/bootstrap-admin` | Create the initial administrator from configured environment values |
| `/vendor/*` | Vendor profile, catalog, uploads, stock, and dashboard APIs |
| `/admin/*` | Admin dashboard, vendor review, and account management |
| `/analytics/*` | Vendor and historical reporting/analytics APIs |
| `/ai/*` | Python RAG assistant and grounded product-content generation |
| GET | `/docs` | Interactive API docs |

The Python API initializes and migrates the shared SQLite schema at startup and imports the
historical XLSX data when the analytics tables are empty. Set `DB_PATH` to override its
database location.

Gemini and OpenAI keys are optional. Without a configured provider, or when a provider is
unavailable, the assistant uses a grounded local response over the signed-in vendor's live
catalog.

## Tests

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s analytics_api -p "test_*.py" -v
```

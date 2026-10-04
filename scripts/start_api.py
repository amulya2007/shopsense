"""Start the Python-only ShopSense API using the project virtual environment."""

import os
import subprocess
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent.parent
VENV_PYTHON = PROJECT_ROOT / ".venv" / (
    "Scripts/python.exe" if os.name == "nt" else "bin/python"
)

if VENV_PYTHON.is_file() and Path(sys.executable).resolve() != VENV_PYTHON.resolve():
    result = subprocess.run(
        [str(VENV_PYTHON), str(Path(__file__).resolve()), *sys.argv[1:]],
        cwd=PROJECT_ROOT,
        env=os.environ.copy(),
        check=False,
    )
    raise SystemExit(result.returncode)

os.chdir(PROJECT_ROOT)

from dotenv import load_dotenv

load_dotenv(PROJECT_ROOT / ".env")
load_dotenv(PROJECT_ROOT / "server" / ".env")

import uvicorn

reload = "--reload" in sys.argv[1:]
if __name__ == "__main__":
    uvicorn.run(
        "analytics_api.main:app",
        app_dir=str(PROJECT_ROOT),
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PYTHON_API_PORT", "8000")),
        reload=reload,
    )

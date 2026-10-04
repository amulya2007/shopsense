"""Run Python backend tests with the project virtual environment when present."""

import os
import subprocess
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent.parent
VENV_PYTHON = PROJECT_ROOT / ".venv" / (
    "Scripts/python.exe" if os.name == "nt" else "bin/python"
)

python = VENV_PYTHON if VENV_PYTHON.is_file() else Path(sys.executable)
result = subprocess.run(
    [str(python), "-m", "pytest", "-q", "analytics_api"],
    cwd=PROJECT_ROOT,
    env=os.environ.copy(),
    check=False,
)
raise SystemExit(result.returncode)

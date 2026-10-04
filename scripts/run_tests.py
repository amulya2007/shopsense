"""Run Python backend tests with the project virtual environment when present."""

import os
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent.parent
VENV_PYTHON = PROJECT_ROOT / ".venv" / (
    "Scripts/python.exe" if os.name == "nt" else "bin/python"
)

if VENV_PYTHON.is_file() and Path(sys.executable).resolve() != VENV_PYTHON.resolve():
    os.execv(
        str(VENV_PYTHON),
        [
            str(VENV_PYTHON),
            "-m",
            "pytest",
            "-q",
            "analytics_api",
        ],
    )

os.chdir(PROJECT_ROOT)
os.execv(
    sys.executable,
    [
        sys.executable,
        "-m",
        "pytest",
        "-q",
        "analytics_api",
    ],
)

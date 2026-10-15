"""
NutriSense-AI — FastAPI backend entry point.

Run from the project root:
    python run.py
    uvicorn Backend.main:app --reload
"""
import pathlib

from dotenv import load_dotenv

# Load .env from the project root so env vars are available before any
# module (Neo4jClient, Settings, etc.) tries to read them.
_project_root = pathlib.Path(__file__).resolve().parent
load_dotenv(_project_root / ".env")

import uvicorn  # noqa: E402

if __name__ == "__main__":
    uvicorn.run("Backend.main:app", host="0.0.0.0", port=8000, reload=True)

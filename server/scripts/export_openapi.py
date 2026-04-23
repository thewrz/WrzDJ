"""Export the FastAPI OpenAPI schema to a JSON file.

Used by the dashboard's type-generation pipeline so that TypeScript types
can be generated from the backend contract without needing a live server.

Run from the server/ directory:
    .venv/bin/python scripts/export_openapi.py

Writes to server/openapi.json (relative to the repo root).
"""

from __future__ import annotations

import json
from pathlib import Path

from app.main import app


def export() -> Path:
    output = Path(__file__).resolve().parent.parent / "openapi.json"
    spec = app.openapi()
    output.write_text(json.dumps(spec, indent=2, sort_keys=True) + "\n")
    return output


if __name__ == "__main__":
    path = export()
    print(f"Wrote OpenAPI schema to {path}")

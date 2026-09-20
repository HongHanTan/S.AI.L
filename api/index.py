"""Vercel serverless entry point.

Vercel routes every request here and runs the ASGI app directly. The server
only ever reads a precomputed run.json, so none of the document-parsing or
model libraries are needed in the deployment bundle.
"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT))

# Only /tmp is writable on a serverless host. Firestore stays the system of
# record for review decisions; this is just the local pending-queue mirror.
os.environ.setdefault("SDOC_ALIAS_DIR", "/tmp/sdoc-aliases")

from web.app import create_app  # noqa: E402

app = create_app(run_path=str(ROOT / "run.json"))

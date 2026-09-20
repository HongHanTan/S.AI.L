"""Adapter over the organiser-supplied bundle layout."""
import json
from pathlib import Path


def load_emails(data_dir: str = "data") -> list[dict]:
    """Every email record, sorted by email_id."""
    inbox = Path(data_dir) / "inbox"
    return [
        json.loads(p.read_text(encoding="utf-8"))
        for p in sorted(inbox.glob("email_*.json"))
    ]


def read_bytes(data_dir: str, att_path: str) -> bytes:
    """Raw bytes of an attachment, given the path as it appears in the record."""
    return (Path(data_dir) / att_path).read_bytes()


def sample_submission(data_dir: str = "data") -> dict:
    return json.loads(
        (Path(data_dir) / "sample_submission.json").read_text(encoding="utf-8")
    )

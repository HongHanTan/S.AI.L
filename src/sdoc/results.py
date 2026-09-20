"""Persist a pipeline run so the web app can serve it without recomputing."""
import json
from dataclasses import asdict
from pathlib import Path


def save_run(results, emails_by_id: dict, path: str = "run.json") -> None:
    payload = {}
    for r in results:
        email = emails_by_id.get(r.email_id, {})
        payload[r.email_id] = {
            "subject": email.get("subject", ""),
            "from": email.get("from", ""),
            "category": r.category,
            "status": r.status,
            "review_reason": r.review_reason,
            "defect_fields": r.defect_fields,
            "attachment_count": len(email.get("attachments") or []),
            "verdicts": [asdict(v) for v in r.verdicts],
            "notes": r.notes,
        }
    Path(path).write_text(json.dumps(payload, indent=2), encoding="utf-8")


def load_run(path: str = "run.json") -> dict:
    p = Path(path)
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}

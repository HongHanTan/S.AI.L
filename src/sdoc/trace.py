"""Per-email evidence. Without this you cannot tell why a score moved."""
import json
from dataclasses import asdict
from pathlib import Path


def write_traces(results, path: str = "traces.json") -> None:
    payload = {
        r.email_id: {
            "category": r.category,
            "status": r.status,
            "review_reason": r.review_reason,
            "defect_fields": r.defect_fields,
            "verdicts": [asdict(v) for v in r.verdicts],
            "notes": r.notes,
        }
        for r in results
    }
    Path(path).write_text(json.dumps(payload, indent=2), encoding="utf-8")


def layer_counts(results) -> dict[str, int]:
    """How many field decisions each layer made — used to show the alias table
    reducing L4 calls between snapshots."""
    counts: dict[str, int] = {}
    for r in results:
        for v in r.verdicts:
            counts[v.decided_by] = counts.get(v.decided_by, 0) + 1
    return counts

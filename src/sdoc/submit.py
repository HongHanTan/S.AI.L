"""Build the submission object and send it to the scoring server."""
import json
import urllib.request
from pathlib import Path

from sdoc.models import EmailResult


def build_submission(results: list[EmailResult]) -> dict[str, dict]:
    return {r.email_id: r.to_submission_entry() for r in sorted(results, key=lambda x: x.email_id)}


def write_submission(submission: dict, path: str = "submission.json") -> None:
    Path(path).write_text(json.dumps(submission, indent=2), encoding="utf-8")


def post_submission(submission: dict, server: str = "http://localhost:8080") -> dict:
    data = json.dumps(submission).encode("utf-8")
    req = urllib.request.Request(
        server.rstrip("/") + "/submit",
        data=data,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())

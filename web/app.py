"""FastAPI app serving the four demo screens over a precomputed run."""
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from sdoc.compare.alias import AliasStore
from sdoc.firestore_store import FirestoreAliasStore
from sdoc.models import FIELDS
from sdoc.results import load_run

WEB_DIR = Path(__file__).parent


class ReviewDecision(BaseModel):
    field: str
    verdict: str


def create_app(run_path: str = "run.json", store: AliasStore | None = None) -> FastAPI:
    app = FastAPI(title="Shipping Document Verification")
    app.state.run_path = run_path
    app.state.store = store or FirestoreAliasStore()

    def run_data() -> dict:
        return load_run(app.state.run_path)

    @app.get("/api/emails")
    def list_emails(category: str | None = None, status: str | None = None):
        rows = []
        for eid, rec in sorted(run_data().items()):
            if category and rec["category"] != category:
                continue
            if status and rec["status"] != status:
                continue
            rows.append({
                "email_id": eid,
                "subject": rec.get("subject", ""),
                "category": rec["category"],
                "status": rec["status"],
                "review_reason": rec.get("review_reason"),
                "defect_fields": rec.get("defect_fields", []),
                "attachment_count": rec.get("attachment_count", 0),
            })
        return rows

    @app.get("/api/emails/{email_id}")
    def email_detail(email_id: str):
        rec = run_data().get(email_id)
        if rec is None:
            raise HTTPException(status_code=404, detail="unknown email_id")
        return {"email_id": email_id, **rec}

    @app.get("/api/review-queue")
    def review_queue():
        return [
            {"email_id": eid, "subject": rec.get("subject", ""),
             "review_reason": rec.get("review_reason"),
             "verdicts": rec.get("verdicts", [])}
            for eid, rec in sorted(run_data().items())
            if rec["status"] == "NEEDS_REVIEW"
        ]

    @app.post("/api/review/{email_id}")
    def submit_review(email_id: str, decision: ReviewDecision):
        rec = run_data().get(email_id)
        if rec is None:
            raise HTTPException(status_code=404, detail="unknown email_id")
        if decision.field not in FIELDS:
            raise HTTPException(status_code=400, detail="unknown field")
        if decision.verdict not in ("SAME", "DIFFERENT"):
            raise HTTPException(status_code=400, detail="verdict must be SAME or DIFFERENT")

        verdict = next((v for v in rec.get("verdicts", [])
                        if v["field_name"] == decision.field), None)
        if verdict is None:
            raise HTTPException(status_code=400, detail="field not compared on this email")

        app.state.store.record_human(
            str(verdict.get("si_value") or ""),
            str(verdict.get("bl_value") or ""),
            decision.verdict,
        )
        return {"recorded": True, "email_id": email_id, "field": decision.field,
                "verdict": decision.verdict}

    @app.get("/api/stats")
    def stats():
        data = run_data()
        categories: dict[str, int] = {}
        statuses: dict[str, int] = {}
        layers: dict[str, int] = {}
        for rec in data.values():
            categories[rec["category"]] = categories.get(rec["category"], 0) + 1
            statuses[rec["status"]] = statuses.get(rec["status"], 0) + 1
            for v in rec.get("verdicts", []):
                layers[v["decided_by"]] = layers.get(v["decided_by"], 0) + 1
        return {"total": len(data), "categories": categories,
                "statuses": statuses, "layers": layers}

    @app.get("/", response_class=HTMLResponse)
    def index():
        page = WEB_DIR / "static" / "index.html"
        if not page.exists():
            # Say what is wrong rather than returning an opaque 500, which on a
            # serverless host is otherwise indistinguishable from a crash.
            raise HTTPException(
                status_code=500,
                detail=f"index.html missing from the deployment at {page}",
            )
        return page.read_text(encoding="utf-8")

    static_dir = WEB_DIR / "static"
    if static_dir.exists():
        app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

    return app


app = create_app()

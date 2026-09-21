"""FastAPI app serving the demo screens over a precomputed run, plus a live
ad-hoc comparison endpoint for documents uploaded in the browser."""
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from sdoc.adhoc import UploadError, compare_uploads, process_typed_email
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

    @app.post("/api/compare")
    async def compare_documents(
        files: list[UploadFile] = File(...),  # noqa: B008 - FastAPI dependency
    ):
        """Compare two uploaded documents live.

        Deterministic only — no model call — so an API quota can never break
        this during a demo. Roles are detected from the documents themselves,
        so the two files may be uploaded in either order.
        """
        try:
            payload = [(f.filename or "document", await f.read()) for f in files]
            return compare_uploads(payload)
        except UploadError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/try-email")
    async def try_email(
        subject: str = Form(""),
        body: str = Form(""),
        sender: str = Form(""),
        files: list[UploadFile] = File(default=[]),  # noqa: B008
    ):
        """Run one hand-written email through the complete pipeline.

        Classification, gating, extraction and comparison — the same
        `process_email` the 520-email batch run calls. Attachments are
        optional and unlabelled; the documents say what they are.
        """
        try:
            payload = [(f.filename or "document", await f.read()) for f in files]
            return process_typed_email(subject, body, sender, payload)
        except UploadError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.get("/api/stats")
    def stats():
        """Summarise the run.

        The first four keys are the original contract. The rest exist so the
        dashboard can draw its charts without the browser downloading and
        re-aggregating the whole run.

        `statuses` counts every email, which flatters the OK figure because a
        spam email is also "OK". `comparison_statuses` counts only the emails
        that were actually put through a comparison, which is the number a
        reader of the dashboard means.
        """
        data = run_data()
        categories: dict[str, int] = {}
        statuses: dict[str, int] = {}
        layers: dict[str, int] = {}
        comparison_statuses: dict[str, int] = {}
        defects: dict[str, int] = {}
        review_reasons: dict[str, int] = {}
        verdicts: dict[str, int] = {}
        # Ten buckets of 0.1 across the token-set ratio, so the L3 thresholds
        # at 0.72 and 0.92 can be drawn against the real distribution.
        similarity = [0] * 10
        compared = 0

        for rec in data.values():
            categories[rec["category"]] = categories.get(rec["category"], 0) + 1
            statuses[rec["status"]] = statuses.get(rec["status"], 0) + 1

            if rec["category"] == "BL_COMPARISON":
                comparison_statuses[rec["status"]] = \
                    comparison_statuses.get(rec["status"], 0) + 1

            for f in rec.get("defect_fields") or []:
                defects[f] = defects.get(f, 0) + 1

            if rec["status"] == "NEEDS_REVIEW" and rec.get("review_reason"):
                reason = rec["review_reason"]
                review_reasons[reason] = review_reasons.get(reason, 0) + 1

            rec_verdicts = rec.get("verdicts") or []
            if rec_verdicts:
                compared += 1
            for v in rec_verdicts:
                layers[v["decided_by"]] = layers.get(v["decided_by"], 0) + 1
                verdicts[v["verdict"]] = verdicts.get(v["verdict"], 0) + 1
                score = v.get("similarity")
                if score is not None:
                    similarity[min(int(float(score) * 10), 9)] += 1

        return {
            "total": len(data),
            "categories": categories,
            "statuses": statuses,
            "layers": layers,
            "comparison_statuses": comparison_statuses,
            "defects": defects,
            "review_reasons": review_reasons,
            "verdicts": verdicts,
            "similarity": similarity,
            "emails_compared": compared,
            "fields_checked": sum(verdicts.values()),
            "fields": list(FIELDS),
        }

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

    @app.middleware("http")
    async def revalidate_static(request, call_next):
        """Make browsers revalidate the CSS and JS on every load.

        StaticFiles sends an ETag but no Cache-Control, so a browser is free to
        serve a heuristically cached copy — which means a redeploy can leave
        someone on the old front end with no way to tell. `no-cache` still lets
        the 304 path do its job; it only forbids using a copy without asking.
        """
        response = await call_next(request)
        if request.url.path.startswith("/static/"):
            response.headers["Cache-Control"] = "no-cache"
        return response

    static_dir = WEB_DIR / "static"
    if static_dir.exists():
        app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

    return app


app = create_app()

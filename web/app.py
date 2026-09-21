"""FastAPI app serving the demo screens over a precomputed run, plus a live
ad-hoc comparison endpoint for documents uploaded in the browser."""
import json
import os
import re
import sys
from pathlib import Path, PurePosixPath

WEB_DIR = Path(__file__).resolve().parent
ROOT = WEB_DIR.parent
if str(ROOT / "src") not in sys.path:
    sys.path.insert(0, str(ROOT / "src"))


def _load_local_env() -> None:
    """Load the Gemini key from the git-ignored root .env for local demos."""
    path = ROOT / ".env"
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key.strip() == "GEMINI_API_KEY":
            os.environ.setdefault("GEMINI_API_KEY", value.strip().strip('"').strip("'"))


_load_local_env()

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from sdoc.adhoc import UploadError, compare_uploads, inspect_uploads, process_typed_email
from sdoc.compare.alias import AliasStore
from sdoc.compare.similarity import DIFFERENT_AT, SAME_AT, band
from sdoc.firestore_store import FirestoreAliasStore
from sdoc.models import FIELDS
from sdoc.results import load_run

# An email_id is only ever a run.json key, but it arrives from the URL, so it
# is validated before it is ever joined onto a filesystem path.
_EMAIL_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

# Fixed results from the final held-out Averis Monash Hackathon evaluation.
# These are deliberately separate from the live run aggregates returned below:
# operational counts can change with run.json, while benchmark scores must only
# change after a new scored evaluation.
AVERIS_BENCHMARK = {
    "dataset": "Averis Monash Hackathon Dataset",
    "overall_score": 0.9734,
    "end_to_end_defect_rate": 0.978,
    "defects_caught": 45,
    "defects_total": 46,
    "stage3_defect_f1": 0.989,
    "defect_precision": 1.0,
    "classification_macro_f1": 0.955,
    "reliability": 0.947,
    "escalation_precision": 1.0,
}


def _resolve_inbox(explicit: str | None) -> Path | None:
    """Where the organiser bundle's email records live, if they are here at all.

    The deployed app ships only run.json, so this is normally absent and every
    caller has to cope with that.
    """
    # An explicit path is authoritative: if the caller named a directory, a
    # missing one means "no inbox", not "go and find another". Searching on
    # would let a deployment silently pick up a stray directory, and would
    # make tests depend on whether the organiser bundle happens to be present.
    if explicit:
        path = Path(explicit)
        return path if path.is_dir() else None

    candidates = [os.environ.get("SDOC_INBOX_DIR"),
                  str(ROOT / "data" / "inbox"), str(ROOT / "inbox")]
    for candidate in candidates:
        if candidate and Path(candidate).is_dir():
            return Path(candidate)
    return None


def _original_email(inbox_dir: Path | None, email_id: str) -> dict:
    """The raw body and attachment names for one email, best-effort.

    Strictly read-only and purely for inspection: the scored run stays the
    system of record, so a missing, malformed or unreadable inbox file returns
    nothing rather than changing what the API reports about the pipeline.
    """
    if inbox_dir is None or not _EMAIL_ID.match(email_id):
        return {}
    path = inbox_dir / f"{email_id}.json"
    try:
        # The regex already forbids separators; this also refuses a symlink
        # that points outside the inbox.
        if path.resolve().parent != inbox_dir.resolve():
            return {}
        record = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(record, dict):
        return {}
    attachments = record.get("attachments") or []
    if not isinstance(attachments, list):
        attachments = []
    return {
        "body": str(record.get("body") or ""),
        "attachment_names": [PurePosixPath(str(a)).name for a in attachments if a],
    }



class ReviewDecision(BaseModel):
    field: str
    verdict: str


def create_app(run_path: str = "run.json", store: AliasStore | None = None,
               inbox_dir: str | None = None) -> FastAPI:
    app = FastAPI(title="Shipping Document Verification")
    app.state.run_path = run_path
    app.state.store = store or FirestoreAliasStore()
    app.state.inbox_dir = _resolve_inbox(inbox_dir)

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
        # Enrichment is additive only: it can add body/attachment_names, never
        # override what the run concluded.
        return {"email_id": email_id, **rec,
                **_original_email(app.state.inbox_dir, email_id)}

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

    @app.post("/api/inspect")
    async def inspect_documents(files: list[UploadFile] = File(...)):  # noqa: B008
        """Return extracted previews and carrier/route inference."""
        try:
            payload = [(f.filename or "document", await f.read()) for f in files]
            return inspect_uploads(payload)
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
        # Only L3 verdicts carry a score; gate1 and L1 settle without one.
        bands = {"DIFFERENT": 0, "GRAY": 0, "SAME": 0}
        scored = 0

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
                    bands[band(score)] += 1
                    scored += 1

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
            "benchmark": dict(AVERIS_BENCHMARK),
            # yikkai's band summary, kept alongside the histogram buckets: it
            # names where the L3 thresholds actually sit, which the raw
            # buckets do not.
            "similarity_bands": {
                "scored": scored,
                "bands": bands,
                "different_at": DIFFERENT_AT,
                "same_at": SAME_AT,
            },
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
        # Same reasoning as the static mount: the shell names unversioned
        # assets, so if the shell itself is heuristically cached the client can
        # stay pinned to an old build no matter what /static now serves.
        return HTMLResponse(page.read_text(encoding="utf-8"),
                            headers={"cache-control": "no-cache"})

    class RevalidatedStatic(StaticFiles):
        """Serve the bundle with `no-cache`, meaning "revalidate every time".

        StaticFiles sends only ETag and Last-Modified. With no Cache-Control a
        browser falls back to heuristic freshness and may reuse app.js without
        asking, so a plain reload can keep running a stale bundle after a
        deploy. The filenames are unversioned, so revalidation is the only way
        to guarantee the client is on the code that was shipped. The ETag still
        makes the common case a 304 with an empty body.
        """

        async def get_response(self, path, scope):
            response = await super().get_response(path, scope)
            response.headers.setdefault("cache-control", "no-cache")
            return response

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
        app.mount("/static", RevalidatedStatic(directory=str(static_dir)), name="static")

    return app


app = create_app()

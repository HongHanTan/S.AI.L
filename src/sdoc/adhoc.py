"""Compare two uploaded documents on demand.

The inbox pipeline runs in batch and its results are precomputed. This path
serves the live demo: a user uploads a Shipping Instruction and a draft Bill of
Lading and gets the same seven-field report back immediately.

It is deliberately **deterministic only** — no model call anywhere. Extraction
already resolves the overwhelming majority of fields in code, and comparison
needs a model only for the narrow L3 gray band, which falls back to the band
midpoint here. That keeps an interactive demo instant, free, and impossible to
break with an API quota.

Roles are detected from the documents themselves, so the two files may be
uploaded in either order.
"""
from dataclasses import asdict

from sdoc.compare.ladder import compare_field
from sdoc.compare.rollup import rollup
from sdoc.doctype import assign_roles, detect_doc_type
from sdoc.docs.ingest import ingest
from sdoc.extract.engine import extract_all_fields, snippet_for
from sdoc.gates import post_extraction_gate
from sdoc.models import FIELDS

MAX_BYTES = 10 * 1024 * 1024  # 10 MB per file is far above any real SI or BL


class UploadError(ValueError):
    """A problem with what was uploaded, not with the documents' contents."""


def compare_uploads(files: list[tuple[str, bytes]]) -> dict:
    """Compare two uploaded documents.

    `files` is a list of (filename, raw_bytes). Returns a record shaped like a
    row of run.json, so the web UI renders it with the same report component
    it uses for inbox emails.
    """
    if len(files) != 2:
        raise UploadError("Upload exactly two documents: a Shipping Instruction "
                          "and a draft Bill of Lading.")
    for name, raw in files:
        if not raw:
            raise UploadError(f"{name} is empty.")
        if len(raw) > MAX_BYTES:
            raise UploadError(f"{name} is larger than {MAX_BYTES // (1024 * 1024)} MB.")

    docs = [ingest(name, raw) for name, raw in files]

    result = {
        "source": "upload",
        "documents": [
            {
                "filename": doc.path,
                "format": doc.fmt,
                "detected_type": detect_doc_type(doc),
                "error": doc.error,
            }
            for doc in docs
        ],
        "status": "NEEDS_REVIEW",
        "review_reason": None,
        "defect_fields": [],
        "verdicts": [],
        "notes": [],
    }

    unreadable = [d for d in docs if d.error]
    if unreadable:
        result["review_reason"] = "unreadable"
        result["notes"].append(
            "Could not read: "
            + ", ".join(f"{d.path} ({d.error})" for d in unreadable)
        )
        return result

    si_doc, bl_doc = assign_roles(docs)
    if si_doc is None or bl_doc is None:
        result["review_reason"] = "wrong_doc_type"
        detected = ", ".join(f"{d.path} looks like a "
                             f"{_describe(detect_doc_type(d))}" for d in docs)
        result["notes"].append(
            "Need one Shipping Instruction and one draft Bill of Lading. "
            + detected
        )
        return result

    si_fields = extract_all_fields(si_doc)
    bl_fields = extract_all_fields(bl_doc)
    result["si_filename"] = si_doc.path
    result["bl_filename"] = bl_doc.path

    if si_fields.get("_conflict") or bl_fields.get("_conflict"):
        result["review_reason"] = "missing_value"
        result["notes"].append(
            "A container table and its summary line disagree, so the totals "
            "cannot be trusted. That is a reading problem, not a discrepancy."
        )
        return result

    post_reason = post_extraction_gate(si_fields, bl_fields, FIELDS)

    verdicts = [
        compare_field(
            name,
            si_fields.get(name),
            bl_fields.get(name),
            adjudicator=None,          # deterministic: no model call
            si_snippet=snippet_for(si_doc, name),
            bl_snippet=snippet_for(bl_doc, name),
        )
        for name in FIELDS
    ]
    result["verdicts"] = [asdict(v) for v in verdicts]

    status, reason, defects = rollup(verdicts, post_reason)
    result["status"] = status
    result["review_reason"] = reason
    result["defect_fields"] = defects
    return result


def _describe(doc_type: str) -> str:
    return {
        "SI": "Shipping Instruction",
        "BL": "Bill of Lading",
    }.get(doc_type, "different document altogether")


# ---------------------------------------------------------------------------
# Full single-email run: classify, then compare if it is a comparison request.
# ---------------------------------------------------------------------------

def _fallback_classifier(email: dict) -> str:
    """Used only when no Gemini credential is configured.

    Deliberately crude, and the caller says so in the response — a weak
    heuristic presented as real classification would be worse than none.
    """
    return "BL_COMPARISON" if email.get("attachments") else "GENERAL"


def process_typed_email(
    subject: str,
    body: str,
    sender: str = "",
    files: list[tuple[str, bytes]] | None = None,
    classifier=None,
    settings=None,
) -> dict:
    """Run one hand-written email through the complete pipeline.

    This calls the same `pipeline.process_email` the 520-email batch run uses,
    so what the demo shows is the production path rather than a reimplementation
    of it. Attachments are optional and unlabelled: whether a document is the
    Shipping Instruction or the draft Bill of Lading is read from the document
    itself.
    """
    from sdoc.config import Settings
    from sdoc.pipeline import process_email

    files = files or []
    settings = settings or Settings()

    for name, raw in files:
        if not raw:
            raise UploadError(f"{name} is empty.")
        if len(raw) > MAX_BYTES:
            raise UploadError(f"{name} is larger than {MAX_BYTES // (1024 * 1024)} MB.")
    if not (subject.strip() or body.strip()):
        raise UploadError("Enter a subject or a body so there is something to classify.")

    by_name = {name: raw for name, raw in files}
    email = {
        "email_id": "typed_email",
        "from": sender.strip(),
        "subject": subject,
        "body": body,
        "attachments": list(by_name),
    }

    classifier_used = "gemini"
    if classifier is None:
        classifier, classifier_used = _default_classifier(settings)

    outcome = process_email(
        email,
        settings,
        classifier,
        adjudicator=None,           # deterministic comparison, as above
        read_bytes=lambda path: by_name[path],
    )

    docs = [ingest(name, raw) for name, raw in files]
    return {
        "source": "typed_email",
        "classifier": classifier_used,
        "category": outcome.category,
        "status": outcome.status,
        "review_reason": outcome.review_reason,
        "defect_fields": outcome.defect_fields,
        "verdicts": [asdict(v) for v in outcome.verdicts],
        "notes": outcome.notes,
        "documents": [
            {
                "filename": d.path,
                "format": d.fmt,
                "detected_type": detect_doc_type(d),
                "error": d.error,
            }
            for d in docs
        ],
    }


def _default_classifier(settings):
    """Gemini when a key is configured, otherwise an honest fallback."""
    from sdoc.classify import CATEGORIES, build_prompt
    from sdoc.gemini import GeminiClient

    # Tuned for an interactive request, not a batch run: one attempt, no
    # throttle, no long backoff. A serverless function times out long before
    # a rate-limit window reopens, so waiting would just hang the page.
    client = GeminiClient(retries=1, min_interval=0, backoff_seconds=0)
    if not client.api_key:
        return _fallback_classifier, "heuristic (no GEMINI_API_KEY configured)"

    def classify_one(email: dict) -> str:
        reply = client.generate_json(build_prompt([email]), default={})
        category = reply.get(email["email_id"]) if isinstance(reply, dict) else None
        if category not in CATEGORIES:
            return _fallback_classifier(email)
        if (category == "BL_COMPARISON"
                and not email.get("attachments")
                and not settings.attachmentless_is_comparison):
            return "GENERAL"
        return category

    return classify_one, "gemini"

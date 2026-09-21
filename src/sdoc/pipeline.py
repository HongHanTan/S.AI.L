"""Orchestration: classify -> ingest -> gate -> extract -> compare -> roll up."""
from sdoc.compare.ladder import compare_field
from sdoc.compare.rollup import rollup
from sdoc.config import Settings
from sdoc.country_rules import evaluate_country_rules
from sdoc.doctype import assign_roles
from sdoc.docs.ingest import ingest
from sdoc.extract.engine import extract_all_fields, snippet_for
from sdoc.gates import post_extraction_gate, pre_extraction_gate
from sdoc.inbox import load_emails
from sdoc.inbox import read_bytes as default_read_bytes
from sdoc.models import FIELDS, EmailResult
from sdoc.shipment_context import infer_shipment_context


def process_email(
    email: dict,
    settings: Settings,
    classifier,
    adjudicator=None,
    alias: dict | None = None,
    read_bytes=None,
    extract_fallback=None,
) -> EmailResult:
    eid = email["email_id"]
    result = EmailResult(email_id=eid, category=classifier(email))

    if result.category != "BL_COMPARISON":
        return result

    reader = read_bytes or (lambda p: default_read_bytes(settings.data_dir, p))
    docs = []
    for path in email.get("attachments", []):
        try:
            docs.append(ingest(path, reader(path)))
        except Exception as exc:
            result.notes.append(f"read failed for {path}: {type(exc).__name__}")

    gate_reason = pre_extraction_gate(docs, body=email.get("body", ""))
    if gate_reason == "nothing_to_compare":
        # A comparison request that arrived without documents and never
        # claimed to have any. There is no discrepancy to report and nothing
        # a human could fix, so it stays a clean OK.
        result.notes.append("no documents attached and none claimed")
        return result
    if gate_reason:
        result.status = "NEEDS_REVIEW"
        result.review_reason = gate_reason
        return result

    si_doc, bl_doc = assign_roles(docs)
    si_fields = extract_all_fields(si_doc)
    bl_fields = extract_all_fields(bl_doc)

    if extract_fallback is not None:
        si_fields = extract_fallback(si_doc, si_fields)
        bl_fields = extract_fallback(bl_doc, bl_fields)

    inferred = infer_shipment_context(docs, si_fields)
    compliance = evaluate_country_rules(si_fields, inferred)
    compliance["context"]["evidence"] = inferred["evidence"]
    result.shipment_context = compliance["context"]
    result.compliance_status = compliance["status"]
    result.compliance_findings = compliance["findings"]

    if si_fields.get("_conflict") or bl_fields.get("_conflict"):
        result.status = "NEEDS_REVIEW"
        result.review_reason = "missing_value"
        result.notes.append("summary and container table disagree")
        return result

    post_reason = post_extraction_gate(si_fields, bl_fields, FIELDS)

    result.verdicts = [
        compare_field(
            name,
            si_fields.get(name),
            bl_fields.get(name),
            alias=alias,
            adjudicator=adjudicator,
            uncertain_lean_same=settings.uncertain_lean_same,
            si_snippet=snippet_for(si_doc, name),
            bl_snippet=snippet_for(bl_doc, name),
        )
        for name in FIELDS
    ]

    status, reason, defects = rollup(result.verdicts, post_reason)
    result.status = status
    result.review_reason = reason
    result.defect_fields = defects
    return result


def run(settings: Settings, classifier, adjudicator=None, alias=None,
        extract_fallback=None) -> list[EmailResult]:
    return [
        process_email(e, settings, classifier, adjudicator, alias,
                      extract_fallback=extract_fallback)
        for e in load_emails(settings.data_dir)
    ]

"""Document-defect gates. Each maps 1:1 onto a permitted review reason.

A reading problem is never a discrepancy.
"""
import re

from sdoc.doctype import assign_roles
from sdoc.models import DocText

# Emails whose attachments genuinely went astray say so in the body. The
# reference set has only 5 missing_attachment cases, while 94 comparison
# requests legitimately carry no attachment at all — so attachment COUNT
# cannot decide this; the body has to.
_CLAIMS_MISSING = re.compile(
    r"appear(?:s)? to have been dropped"
    r"|still missing"
    r"|attachment[s]? (?:were|was|are|is) (?:missing|dropped|omitted)"
    r"|forgot to attach"
    r"|no attachment",
    re.I,
)


def claims_missing_attachment(body: str) -> bool:
    """True when the sender says an attachment should be here and is not."""
    return bool(_CLAIMS_MISSING.search(body or ""))


def pre_extraction_gate(docs: list[DocText], *, body: str = "") -> str | None:
    """Return a review reason, or None when the pair is usable.

    Returns the sentinel "nothing_to_compare" when a comparison email simply
    arrived without documents and never claimed to have any — the caller
    reports that as a clean OK, not an escalation.
    """
    if len(docs) < 2:
        if claims_missing_attachment(body):
            return "missing_attachment"
        return "nothing_to_compare"
    if any(d.error for d in docs):
        return "unreadable"
    si, bl = assign_roles(docs)
    if si is None or bl is None:
        return "wrong_doc_type"
    return None


def post_extraction_gate(si_fields: dict, bl_fields: dict, fields: tuple) -> str | None:
    """Return 'missing_value' when either document lacks a required field."""
    for name in fields:
        if not si_fields.get(name) or not bl_fields.get(name):
            return "missing_value"
    return None

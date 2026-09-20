"""Precedence. A confirmed DIFFERENT outranks a gate defect on another field —
catching the defect is what the end-to-end axis scores.
"""
from sdoc.models import FIELDS, FieldVerdict


def rollup(verdicts: list[FieldVerdict], gate_reason: str | None):
    """Return (status, review_reason, defect_fields)."""
    different = {v.field_name for v in verdicts if v.verdict == "DIFFERENT"}
    if different:
        return "MISMATCH", None, [f for f in FIELDS if f in different]

    if gate_reason:
        return "NEEDS_REVIEW", gate_reason, []

    if any(v.verdict == "MISSING" for v in verdicts):
        return "NEEDS_REVIEW", "missing_value", []

    return "OK", None, []

"""Gate 1 -> L1 -> L2 -> L3 -> L4 -> resolver.

Every field pair exits as SAME, DIFFERENT, or MISSING. MISSING means the value
could not be read, which the rollup turns into a review reason — never a
discrepancy.
"""
from sdoc.compare.canon import canon_party, canon_port, party_name
from sdoc.compare.similarity import GRAY_MIDPOINT, band, token_set_ratio
from sdoc.models import FieldVerdict

NUMERIC_FIELDS = ("container_count", "gross_weight_kg")
PORT_FIELDS = ("port_of_loading", "port_of_discharge")
PARTY_FIELDS = ("shipper", "consignee", "notify_party")


def _canon_for(field_name: str, value: str) -> str:
    if field_name in PORT_FIELDS:
        return canon_port(value)
    return canon_party(value)


def _comparable(field_name: str, value: str) -> str:
    """What L3 scores. Parties compare on name, not on address."""
    if field_name in PARTY_FIELDS:
        return party_name(value)
    return _canon_for(field_name, value)


def compare_field(
    field_name: str,
    si_value,
    bl_value,
    *,
    alias: dict | None = None,
    adjudicator=None,
    uncertain_lean_same: bool = True,
    si_snippet: str = "",
    bl_snippet: str = "",
) -> FieldVerdict:
    alias = alias or {}

    # Gate 1 — numerics never involve a model.
    if field_name in NUMERIC_FIELDS:
        if si_value is None or bl_value is None:
            return FieldVerdict(field_name, si_value, bl_value, "MISSING", "gate1")
        verdict = "SAME" if int(si_value) == int(bl_value) else "DIFFERENT"
        return FieldVerdict(field_name, si_value, bl_value, verdict, "gate1")

    if not si_value or not bl_value:
        return FieldVerdict(field_name, si_value, bl_value, "MISSING", "gate1")

    # L1 — canonicalize.
    si_canon = _canon_for(field_name, si_value)
    bl_canon = _canon_for(field_name, bl_value)
    if si_canon and si_canon == bl_canon:
        return FieldVerdict(field_name, si_value, bl_value, "SAME", "L1")

    # L2 — alias table.
    si_key, bl_key = alias.get(si_canon), alias.get(bl_canon)
    if si_key and bl_key and si_key == bl_key:
        return FieldVerdict(field_name, si_value, bl_value, "SAME", "L2")

    # L3 — similarity bands.
    score = token_set_ratio(_comparable(field_name, si_value),
                            _comparable(field_name, bl_value))
    verdict = band(score)
    if verdict in ("SAME", "DIFFERENT"):
        return FieldVerdict(field_name, si_value, bl_value, verdict, "L3", score)

    # L4 — adjudicate only the gray band.
    if adjudicator is None:
        fallback = "SAME" if score >= GRAY_MIDPOINT else "DIFFERENT"
        return FieldVerdict(field_name, si_value, bl_value, fallback, "L3", score)

    # `similarity` is passed through so a recording wrapper can apply the
    # alias-promotion guard (Task 14); the adjudicator itself ignores it.
    result = adjudicator(field_name=field_name, si_value=si_value,
                         bl_value=bl_value, si_snippet=si_snippet,
                         bl_snippet=bl_snippet, similarity=score) or {}
    got = result.get("verdict", "UNCERTAIN")
    if got in ("SAME", "DIFFERENT"):
        return FieldVerdict(field_name, si_value, bl_value, got, "L4", score,
                            result.get("reason", ""))

    # Resolver — UNCERTAIN does not escalate.
    if uncertain_lean_same:
        fallback = "SAME" if score >= GRAY_MIDPOINT else "DIFFERENT"
    else:
        fallback = "DIFFERENT" if score <= GRAY_MIDPOINT else "SAME"
    return FieldVerdict(field_name, si_value, bl_value, fallback, "resolver",
                        score, "uncertain, resolved against midpoint")

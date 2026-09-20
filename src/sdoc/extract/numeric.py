"""Container count and gross weight.

Three sources, consulted in priority order and cross-checked:
  1. a summary line  ("No. of Containers: 6 x 40'HC")
  2. the container table (count rows, sum the weight column)
  3. an inline labelled value

Where a summary and a table both exist they must agree. Disagreement is a
reading problem -> the caller raises missing_value; it is never a mismatch.

Measured against the bundle: counts are always "N x TYPE"; weights are
"NNN,NNN KG" or a bare integer. No MT units or number words occur.
"""
import re

from sdoc.extract.labels import field_for_label
from sdoc.models import DocText

_LEADING_INT = re.compile(r"^\s*(\d{1,4})\b")
_WEIGHT = re.compile(r"^(\d[\d,]*)\s*(?:KGS?|KILOS?)?\s*$", re.I)
_TABLE_START = ("CONTAINER NO.", "CONTAINER NO")
_CONTAINER_ID = re.compile(r"^[A-Z]{4}\d{7}$")


def parse_container_count(value: str) -> int | None:
    if not value:
        return None
    m = _LEADING_INT.match(value)
    return int(m.group(1)) if m else None


def parse_weight_kg(value: str) -> int | None:
    if not value:
        return None
    m = _WEIGHT.match(value.strip())
    if not m:
        return None
    digits = m.group(1).replace(",", "")
    return int(digits) if digits.isdigit() else None


def _from_summary(doc: DocText) -> tuple[int | None, int | None]:
    count = weight = None
    for line in doc.lines:
        if ":" not in line:
            continue
        label, _, value = line.partition(":")
        name = field_for_label(label)
        if name == "container_count" and count is None:
            count = parse_container_count(value.strip())
        elif name == "gross_weight_kg" and weight is None:
            weight = parse_weight_kg(value.strip())
    return count, weight


def _from_table(doc: DocText) -> tuple[int | None, int | None]:
    """Count container-id rows and sum the weights that follow them."""
    started = any(ln.strip().upper().startswith(_TABLE_START) for ln in doc.lines)
    if not started:
        return None, None

    rows = 0
    total = 0
    saw_weight = False
    pending = False
    for line in doc.lines:
        stripped = line.strip()
        if _CONTAINER_ID.match(stripped.upper()):
            rows += 1
            pending = True
            continue
        if pending:
            w = parse_weight_kg(stripped)
            if w is not None:
                total += w
                saw_weight = True
                pending = False
    if rows == 0:
        return None, None
    return rows, (total if saw_weight else None)


def extract_numeric_fields(doc: DocText) -> dict:
    s_count, s_weight = _from_summary(doc)
    t_count, t_weight = _from_table(doc)

    conflict = False
    if s_count is not None and t_count is not None and s_count != t_count:
        conflict = True
    if s_weight is not None and t_weight is not None and s_weight != t_weight:
        conflict = True

    return {
        "container_count": s_count if s_count is not None else t_count,
        "gross_weight_kg": s_weight if s_weight is not None else t_weight,
        "_conflict": conflict,
    }

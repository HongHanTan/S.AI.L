"""Extract 'Label on its own line, value beneath' layouts (.pdf).

A value runs until the next line that is itself a known label, or until a
line that looks like a table header.
"""
from sdoc.extract.labels import field_for_label, is_label_line
from sdoc.models import DocText

_TABLE_MARKERS = ("CONTAINER NO.", "DESCRIPTION", "GROSS WEIGHT (KG)")


def _is_boundary(line: str) -> bool:
    stripped = line.strip()
    if not stripped:
        return True
    if stripped.upper() in _TABLE_MARKERS:
        return True
    # Any known label ends the value — not just the seven compared fields.
    # "Ocean Vessel" must stop a port value even though we never compare it.
    return is_label_line(stripped)


_MAX_LABEL_LEN = 45


def _split_label_prefix(line: str) -> tuple[str | None, str]:
    """Split a collapsed "Label Value" line into its field and its value.

    Some PDF layouts run the label straight into the value with no separator:
    "Consignee (Non-Negotiable) BALL & DOGGETT AUSTRALIA PTY LTD". The longest
    matching label prefix wins, so "Consignee (Non-Negotiable)" is preferred
    over the shorter "Consignee". Returns (None, "") when the line does not
    begin with a known field label.
    """
    best: tuple[str, str] | None = None
    for end in range(1, min(len(line), _MAX_LABEL_LEN) + 1):
        field = field_for_label(line[:end])
        if field:
            best = (field, line[end:].strip())
    return best if best is not None else (None, "")


def extract_block(doc: DocText) -> dict[str, str]:
    found: dict[str, str] = {}
    lines = doc.lines
    for i, line in enumerate(lines):
        stripped = line.strip()
        if not stripped or ":" in stripped:
            continue

        name, inline_value = _split_label_prefix(stripped)
        if not name or name in found:
            continue

        parts: list[str] = []
        if inline_value:
            parts.append(inline_value)
        for nxt in lines[i + 1:]:
            if _is_boundary(nxt):
                break
            parts.append(nxt.strip())
        if parts:
            found[name] = "; ".join(parts)
    return found

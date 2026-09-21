"""Extract colon-labelled layouts (.txt, .xlsx, .docx, and some PDFs).

Indented lines following a labelled line are continuations of its value —
address blocks are written that way throughout the bundle. A blank labelled
line may also take its value from the next non-empty line. PyMuPDF commonly
produces that shape for visually side-by-side PDF columns::

    Shipper:
    ACME SDN BHD
"""
from sdoc.extract.labels import field_for_label
from sdoc.models import DocText


def extract_linear(doc: DocText) -> dict[str, str]:
    found: dict[str, str] = {}
    current: str | None = None
    awaiting_value = False
    for line in doc.lines:
        if not line.strip():
            current = None
            awaiting_value = False
            continue
        if ":" in line:
            label, _, value = line.partition(":")
            name = field_for_label(label)
            if name:
                if name not in found:
                    found[name] = value.strip()
                current = name if not value.strip().isdigit() else None
                awaiting_value = not value.strip()
                continue
            if current and awaiting_value:
                found[current] = line.strip()
                awaiting_value = False
                continue
            current = None
            awaiting_value = False
            continue
        if current and awaiting_value:
            found[current] = line.strip()
            awaiting_value = False
        elif current and (line.startswith((" ", "\t"))):
            found[current] = f"{found[current]}; {line.strip()}".strip("; ")
    return found

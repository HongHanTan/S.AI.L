"""Extract 'Label: value' layouts (.txt, .xlsx, .docx).

Indented lines following a labelled line are continuations of its value —
address blocks are written that way throughout the bundle.
"""
from sdoc.extract.labels import field_for_label
from sdoc.models import DocText


def extract_linear(doc: DocText) -> dict[str, str]:
    found: dict[str, str] = {}
    current: str | None = None
    for line in doc.lines:
        if not line.strip():
            current = None
            continue
        if ":" in line:
            label, _, value = line.partition(":")
            name = field_for_label(label)
            if name:
                if name not in found:
                    found[name] = value.strip()
                current = name if not value.strip().isdigit() else None
                continue
            current = None
            continue
        if current and (line.startswith((" ", "\t"))):
            found[current] = f"{found[current]}; {line.strip()}".strip("; ")
    return found

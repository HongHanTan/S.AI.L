"""Decide what each attachment actually is, from its header rather than its name.

Order matters. A Shipping Instruction may be headed "BILL OF LADING INSTRUCTION"
(every PDF SI in the bundle) or "BL INSTRUCTION" (xlsx). Testing for
"BILL OF LADING" first would misclassify all of them as Bills of Lading.
"""
from sdoc.models import DocText


def detect_doc_type(doc: DocText) -> str:
    head = doc.header
    if "INSTRUCTION" in head:
        return "SI"
    if "BILL OF LADING" in head:
        return "BL"
    return "OTHER"


def assign_roles(docs: list[DocText]) -> tuple[DocText | None, DocText | None]:
    """Pair one SI with one BL. The header wins; the filename is what lies."""
    si = bl = None
    for doc in docs:
        kind = detect_doc_type(doc)
        if kind == "SI" and si is None:
            si = doc
        elif kind == "BL" and bl is None:
            bl = doc
    return si, bl

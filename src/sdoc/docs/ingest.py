"""Turn attachment bytes into DocText, whatever the format."""
from pathlib import Path

from sdoc.models import DocText

MIN_USABLE_CHARS = 20


def ingest(path: str, raw: bytes) -> DocText:
    ext = Path(path).suffix.lower().lstrip(".")
    doc = DocText(path=path, fmt=ext)
    try:
        if ext == "txt":
            from sdoc.docs.txt import read_txt
            doc.lines = read_txt(raw)
        elif ext == "pdf":
            from sdoc.docs.pdf import read_pdf
            doc.lines = read_pdf(raw)
        elif ext == "docx":
            from sdoc.docs.docx_ import read_docx
            doc.lines = read_docx(raw)
        elif ext == "xlsx":
            from sdoc.docs.xlsx import read_xlsx
            doc.lines = read_xlsx(raw)
        else:
            doc.error = "unsupported_format"
            return doc
    except Exception as exc:  # a parse failure is a reading problem, not a crash
        doc.error = f"parse_failed: {type(exc).__name__}"
        return doc

    if len(doc.text.strip()) < MIN_USABLE_CHARS:
        doc.error = "too_short"
    return doc

import io

import fitz  # PyMuPDF


def read_pdf(raw: bytes) -> list[str]:
    """Text lines from a PDF. The bundle's PDFs are ReportLab text PDFs, so
    get_text() resolves them without OCR."""
    with fitz.open(stream=io.BytesIO(raw), filetype="pdf") as doc:
        text = "\n".join(page.get_text() for page in doc)
    return text.splitlines()

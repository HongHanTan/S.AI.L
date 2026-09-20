# Shipping Document Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Classify 520 shipping emails and, for document-comparison requests, compare seven fields between a Shipping Instruction and a draft Bill of Lading, producing a scored submission plus a deployed review UI.

**Architecture:** A staged pipeline — classify (Gemini) → ingest documents (code) → gate → extract (code, Gemini fallback) → compare via an L1→L4 escalation ladder → roll up to a status. Deterministic code owns extraction and decisions; the model classifies, rescues missing fields, and adjudicates a narrow similarity gray band. A FastAPI app on Cloud Run serves four screens over the same pipeline output.

**Tech Stack:** Python 3.14.3, PyMuPDF, python-docx, openpyxl, google-genai (Gemini), FastAPI + uvicorn, Firestore, Cloud Run, pytest.

**Spec:** `docs/superpowers/specs/2026-09-20-shipping-doc-verification-design.md`

## Global Constraints

- **Python 3.14.3 on Windows.** `sys.stdout` defaults to cp1252. Every file read/write MUST pass `encoding="utf-8"` explicitly. Never rely on the platform default.
- **The dataset lives at `data/`** (gitignored): `data/inbox/*.json` (520 records), `data/attachments/*`, `data/loader.py`, `data/sample_submission.json`.
- **Submission shape is fixed.** One JSON object keyed by `email_id`, containing every one of the 520 ids, each with exactly: `category`, `status`, `review_reason`, `defect_fields`, `has_defect`.
- **Category enum:** `BL_COMPARISON`, `SI_REQUEST`, `INVOICE_QUERY`, `GENERAL`, `SPAM`.
- **Status enum:** `OK`, `MISMATCH`, `NEEDS_REVIEW`.
- **Review reason enum:** `wrong_doc_type`, `missing_attachment`, `unreadable`, `missing_value`, or `null`.
- **Field enum (exact spelling):** `shipper`, `consignee`, `notify_party`, `port_of_loading`, `port_of_discharge`, `container_count`, `gross_weight_kg`.
- **Non-`BL_COMPARISON` emails** always emit `status: "OK"`, `has_defect: false`, `defect_fields: []`, `review_reason: null`.
- **A reading problem is never a discrepancy.** Anything the parser could not read reliably becomes a review reason, never a mismatch.
- **Tests never require `data/`.** Unit tests use inline fixtures. Integration tests that touch `data/` are marked `@pytest.mark.integration` and skip when the folder is absent.
- **Commit after every task.**

## Ground Truths Measured From The Data

These were verified directly and the code depends on them:

| Fact | Value |
|---|---|
| Emails / with attachments | 520 / 126 (124 pairs, 2 SI-only: `email_507`, `email_509`) |
| Attachment formats | 192 `.txt`, 28 `.pdf`, 22 `.xlsx`, 8 `.docx` |
| SI header variants | `SHIPPING INSTRUCTION` (txt), `BILL OF LADING INSTRUCTION` (all 14 pdf), `BL INSTRUCTION` (xlsx) |
| BL header variants | `BILL OF LADING (DRAFT)` (txt/pdf/docx), `BILL OF LADING` (xlsx) |
| Wrong-doc-type files | `email_501_BL.txt` (COMMERCIAL INVOICE), `email_502_BL.txt` + `email_504_BL.txt` (PACKING LIST), `email_503_BL.txt` + `email_505_BL.txt` (CERTIFICATE OF ORIGIN) |
| Non-ASCII label | `Gross Weight毛重(KGS)` — 51 files. Only one such variant. |
| Container count format | Always `N x TYPE` (e.g. `6 x 40'HC`). No number words, no `THREE (3)`. |
| Gross weight format | `NNN,NNN KG` (txt/pdf) or bare integer (xlsx). **No `MT`/tonne units anywhere.** |
| Garbled/truncated files | None found in `.txt`. |

---

## File Structure

```
src/sdoc/
  __init__.py
  models.py              dataclasses: DocText, Fields, FieldVerdict, EmailResult
  inbox.py               adapter over data/loader.py
  docs/
    __init__.py
    ingest.py            format dispatch → DocText
    txt.py  pdf.py  docx_.py  xlsx.py
  doctype.py             header detection, role assignment
  gates.py               pre- and post-extraction defect gates
  extract/
    __init__.py
    labels.py            label normalisation + variant map
    linear.py            "Label: value" extractor
    block.py             "Label\nvalue" (PDF) extractor
    numeric.py           container count / gross weight
    llm.py               Gemini fallback extraction
  compare/
    __init__.py
    canon.py             L1 canonicalization
    alias.py             L2 table, promotion, snapshots
    similarity.py        L3 token-set ratio + bands
    adjudicate.py        L4 Gemini adjudicator + resolver
    rollup.py            precedence → status
  gemini.py              client + content-hash disk cache
  classify.py            S1 classification
  config.py              tunable switches
  pipeline.py            orchestration
  submit.py              build submission + POST
  trace.py               per-email evidence log
web/
  app.py                 FastAPI, four screens
  templates/  static/
tests/
  ...mirrors src/sdoc/
Dockerfile
requirements.txt
```

---

## Task 1: Scaffold + scoreboard loop

Proves the submit pipe end-to-end before any intelligence exists. Nothing else is worth building until a score comes back.

**Files:**
- Create: `requirements.txt`, `pytest.ini`, `src/sdoc/__init__.py`, `src/sdoc/inbox.py`, `src/sdoc/models.py`, `src/sdoc/submit.py`
- Test: `tests/test_inbox.py`, `tests/test_submit.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `sdoc.inbox.load_emails(data_dir: str = "data") -> list[dict]`
  - `sdoc.models.EmailResult` dataclass with `.to_submission_entry() -> dict`
  - `sdoc.submit.build_submission(results: list[EmailResult]) -> dict[str, dict]`
  - `sdoc.submit.post_submission(submission: dict, server: str) -> dict`

- [ ] **Step 1: Create dependency and pytest config**

`requirements.txt`:
```
pymupdf>=1.24
python-docx>=1.1
openpyxl>=3.1
google-genai>=0.3
fastapi>=0.115
uvicorn>=0.30
jinja2>=3.1
google-cloud-firestore>=2.16
pytest>=8.0
```

`pytest.ini`:
```ini
[pytest]
pythonpath = src
testpaths = tests
markers =
    integration: requires the data/ bundle to be present
```

Run: `pip install -r requirements.txt`
Expected: all install successfully.

- [ ] **Step 2: Write the failing tests**

`tests/test_submit.py`:
```python
from sdoc.models import EmailResult
from sdoc.submit import build_submission


def test_general_email_entry_shape():
    r = EmailResult(email_id="email_001", category="GENERAL")
    assert r.to_submission_entry() == {
        "category": "GENERAL",
        "status": "OK",
        "review_reason": None,
        "defect_fields": [],
        "has_defect": False,
    }


def test_mismatch_entry_sets_defect_flag():
    r = EmailResult(
        email_id="email_004",
        category="BL_COMPARISON",
        status="MISMATCH",
        defect_fields=["consignee", "notify_party"],
    )
    entry = r.to_submission_entry()
    assert entry["has_defect"] is True
    assert entry["defect_fields"] == ["consignee", "notify_party"]
    assert entry["review_reason"] is None


def test_needs_review_entry_carries_reason():
    r = EmailResult(
        email_id="email_507",
        category="BL_COMPARISON",
        status="NEEDS_REVIEW",
        review_reason="missing_attachment",
    )
    entry = r.to_submission_entry()
    assert entry["status"] == "NEEDS_REVIEW"
    assert entry["review_reason"] == "missing_attachment"
    assert entry["has_defect"] is False


def test_build_submission_is_keyed_by_email_id():
    results = [
        EmailResult(email_id="email_002", category="SPAM"),
        EmailResult(email_id="email_001", category="GENERAL"),
    ]
    sub = build_submission(results)
    assert set(sub) == {"email_001", "email_002"}
    assert sub["email_002"]["category"] == "SPAM"
```

`tests/test_inbox.py`:
```python
import json

from sdoc.inbox import load_emails


def test_load_emails_reads_records(tmp_path):
    inbox = tmp_path / "inbox"
    inbox.mkdir()
    (inbox / "email_001.json").write_text(
        json.dumps({"email_id": "email_001", "from": "a@b.c",
                    "subject": "hi", "body": "x", "attachments": []}),
        encoding="utf-8",
    )
    emails = load_emails(str(tmp_path))
    assert len(emails) == 1
    assert emails[0]["email_id"] == "email_001"
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pytest tests/test_submit.py tests/test_inbox.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'sdoc'`

- [ ] **Step 4: Implement the models**

`src/sdoc/models.py`:
```python
"""Core data structures shared across the pipeline."""
from dataclasses import dataclass, field

FIELDS = (
    "shipper",
    "consignee",
    "notify_party",
    "port_of_loading",
    "port_of_discharge",
    "container_count",
    "gross_weight_kg",
)

CATEGORIES = ("BL_COMPARISON", "SI_REQUEST", "INVOICE_QUERY", "GENERAL", "SPAM")
REVIEW_REASONS = ("wrong_doc_type", "missing_attachment", "unreadable", "missing_value")


@dataclass
class DocText:
    """Text extracted from one attachment, plus how it was read."""
    path: str
    lines: list[str] = field(default_factory=list)
    fmt: str = ""
    error: str | None = None

    @property
    def text(self) -> str:
        return "\n".join(self.lines)

    @property
    def header(self) -> str:
        """First three non-empty lines, uppercased — used for doc-type detection."""
        non_empty = [ln.strip() for ln in self.lines if ln.strip()]
        return " ".join(non_empty[:3]).upper()


@dataclass
class FieldVerdict:
    """The outcome of comparing one field across both documents."""
    field_name: str
    si_value: str | None
    bl_value: str | None
    verdict: str          # "SAME" | "DIFFERENT"
    decided_by: str       # "gate1" | "L1" | "L2" | "L3" | "L4" | "resolver"
    similarity: float | None = None
    reason: str = ""


@dataclass
class EmailResult:
    """Everything the pipeline concluded about one email."""
    email_id: str
    category: str
    status: str = "OK"
    review_reason: str | None = None
    defect_fields: list[str] = field(default_factory=list)
    verdicts: list[FieldVerdict] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def to_submission_entry(self) -> dict:
        return {
            "category": self.category,
            "status": self.status,
            "review_reason": self.review_reason,
            "defect_fields": list(self.defect_fields),
            "has_defect": self.status == "MISMATCH",
        }
```

- [ ] **Step 5: Implement the inbox adapter and submitter**

`src/sdoc/inbox.py`:
```python
"""Adapter over the organiser-supplied bundle layout."""
import json
from pathlib import Path


def load_emails(data_dir: str = "data") -> list[dict]:
    """Every email record, sorted by email_id."""
    inbox = Path(data_dir) / "inbox"
    return [
        json.loads(p.read_text(encoding="utf-8"))
        for p in sorted(inbox.glob("email_*.json"))
    ]


def read_bytes(data_dir: str, att_path: str) -> bytes:
    """Raw bytes of an attachment, given the path as it appears in the record."""
    return (Path(data_dir) / att_path).read_bytes()


def sample_submission(data_dir: str = "data") -> dict:
    return json.loads(
        (Path(data_dir) / "sample_submission.json").read_text(encoding="utf-8")
    )
```

`src/sdoc/submit.py`:
```python
"""Build the submission object and send it to the scoring server."""
import json
import urllib.request
from pathlib import Path

from sdoc.models import EmailResult


def build_submission(results: list[EmailResult]) -> dict[str, dict]:
    return {r.email_id: r.to_submission_entry() for r in sorted(results, key=lambda x: x.email_id)}


def write_submission(submission: dict, path: str = "submission.json") -> None:
    Path(path).write_text(json.dumps(submission, indent=2), encoding="utf-8")


def post_submission(submission: dict, server: str = "http://localhost:8080") -> dict:
    data = json.dumps(submission).encode("utf-8")
    req = urllib.request.Request(
        server.rstrip("/") + "/submit",
        data=data,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pytest tests/test_submit.py tests/test_inbox.py -v`
Expected: PASS — 5 passed.

- [ ] **Step 7: Produce a baseline submission and score it**

Create `scripts/baseline.py`:
```python
"""Everything GENERAL. Proves the submit pipe works before any logic exists."""
import sys

from sdoc.inbox import load_emails
from sdoc.models import EmailResult
from sdoc.submit import build_submission, post_submission, write_submission

results = [EmailResult(email_id=e["email_id"], category="GENERAL") for e in load_emails()]
submission = build_submission(results)
write_submission(submission)
print(f"built {len(submission)} entries")

if len(sys.argv) > 1:
    print(post_submission(submission, sys.argv[1]))
```

Start the organiser's scoring server (from the `sdoc-hackathon-docker` bundle):
```bash
docker compose up --build
```

Run: `python scripts/baseline.py http://localhost:8080`
Expected: `built 520 entries` followed by a scoreboard dict containing `final_score`.

**This is the gate for Task 1.** If no score comes back, stop and fix the loop before continuing — every later task depends on it.

- [ ] **Step 8: Commit**

```bash
git add requirements.txt pytest.ini src/sdoc tests scripts
git commit -m "feat: scaffold pipeline and prove the scoreboard submit loop"
```

---

## Task 2: Document ingestion — txt and pdf

**Files:**
- Create: `src/sdoc/docs/__init__.py`, `src/sdoc/docs/txt.py`, `src/sdoc/docs/pdf.py`, `src/sdoc/docs/ingest.py`
- Test: `tests/docs/test_ingest.py`

**Interfaces:**
- Consumes: `sdoc.models.DocText`
- Produces: `sdoc.docs.ingest.ingest(path: str, raw: bytes) -> DocText` — dispatches on file extension; sets `DocText.error` rather than raising.

- [ ] **Step 1: Write the failing tests**

`tests/docs/test_ingest.py`:
```python
from sdoc.docs.ingest import ingest


def test_txt_ingest_splits_lines():
    raw = "SHIPPING INSTRUCTION\n\nShipper: ACME PTE LTD\n".encode("utf-8")
    doc = ingest("attachments/email_001_SI.txt", raw)
    assert doc.fmt == "txt"
    assert doc.error is None
    assert "Shipper: ACME PTE LTD" in doc.lines


def test_txt_ingest_tolerates_bad_bytes():
    doc = ingest("attachments/x_SI.txt", b"\xff\xfe SHIPPING INSTRUCTION")
    assert doc.error is None
    assert "SHIPPING INSTRUCTION" in doc.text


def test_header_is_first_three_nonempty_lines_uppercased():
    raw = "Bill of Lading (Draft)\n\n====\nShipper: X\n".encode("utf-8")
    doc = ingest("a_BL.txt", raw)
    assert doc.header.startswith("BILL OF LADING (DRAFT)")
    assert "SHIPPER" not in doc.header


def test_unknown_extension_is_an_error():
    doc = ingest("attachments/x.zip", b"PK\x03\x04")
    assert doc.error == "unsupported_format"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/docs/test_ingest.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'sdoc.docs'`

- [ ] **Step 3: Implement the txt and pdf readers**

`src/sdoc/docs/txt.py`:
```python
def read_txt(raw: bytes) -> list[str]:
    return raw.decode("utf-8", errors="replace").splitlines()
```

`src/sdoc/docs/pdf.py`:
```python
import io

import fitz  # PyMuPDF


def read_pdf(raw: bytes) -> list[str]:
    """Text lines from a PDF. The bundle's PDFs are ReportLab text PDFs, so
    get_text() resolves them without OCR."""
    with fitz.open(stream=io.BytesIO(raw), filetype="pdf") as doc:
        text = "\n".join(page.get_text() for page in doc)
    return text.splitlines()
```

- [ ] **Step 4: Implement the dispatcher**

`src/sdoc/docs/ingest.py`:
```python
"""Turn attachment bytes into DocText, whatever the format."""
from pathlib import Path

from sdoc.models import DocText

MIN_USABLE_CHARS = 50


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
```

`src/sdoc/docs/__init__.py`: empty file.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/docs/test_ingest.py -v`
Expected: PASS — 4 passed.

- [ ] **Step 6: Commit**

```bash
git add src/sdoc/docs tests/docs
git commit -m "feat: ingest txt and pdf attachments into DocText"
```

---

## Task 3: Document ingestion — docx and xlsx

`.xlsx` is the silent scoring hole: 22 attachments, mentioned only in `loader.py`'s docstring. Its sheets use **inline strings** (no `sharedStrings.xml`), so the stdlib fallback must read `<is><t>` nodes.

**Files:**
- Create: `src/sdoc/docs/docx_.py`, `src/sdoc/docs/xlsx.py`
- Test: `tests/docs/test_docx_xlsx.py`

**Interfaces:**
- Produces: `read_docx(raw: bytes) -> list[str]`, `read_xlsx(raw: bytes) -> list[str]`. Both emit `"Label: value"` lines so the linear extractor handles them unchanged.

- [ ] **Step 1: Write the failing tests**

`tests/docs/test_docx_xlsx.py`:
```python
import io
import zipfile

import pytest
from docx import Document

from sdoc.docs.docx_ import read_docx
from sdoc.docs.xlsx import read_xlsx

SHEET_XML = """<?xml version="1.0"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData>
<row r="1"><c r="A1" t="inlineStr"><is><t>APRIL FAR EAST (M) SDN BHD</t></is></c></row>
<row r="3"><c r="A3" t="inlineStr"><is><t>BL INSTRUCTION</t></is></c>
           <c r="B3" t="inlineStr"><is><t>3815798123</t></is></c></row>
<row r="4"><c r="A4" t="inlineStr"><is><t>CONSIGNEE</t></is></c>
           <c r="B4" t="inlineStr"><is><t>BALL &amp; DOGGETT | 43-45 METRO RD</t></is></c></row>
<row r="5"><c r="A5" t="inlineStr"><is><t>Load Port</t></is></c>
           <c r="B5" t="inlineStr"><is><t>SINGAPORE</t></is></c></row>
</sheetData></worksheet>"""


def _xlsx_bytes() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("xl/worksheets/sheet1.xml", SHEET_XML)
        z.writestr("[Content_Types].xml", "<Types/>")
    return buf.getvalue()


def test_xlsx_emits_label_colon_value_lines():
    lines = read_xlsx(_xlsx_bytes())
    assert "CONSIGNEE: BALL & DOGGETT | 43-45 METRO RD" in lines
    assert "Load Port: SINGAPORE" in lines


def test_xlsx_header_row_appears_in_first_lines():
    lines = read_xlsx(_xlsx_bytes())
    non_empty = [x for x in lines if x.strip()]
    assert any("BL INSTRUCTION" in x for x in non_empty[:3])


def test_xlsx_decodes_html_entities():
    assert "&amp;" not in "\n".join(read_xlsx(_xlsx_bytes()))


def test_docx_reads_paragraphs_and_tables():
    doc = Document()
    doc.add_paragraph("BILL OF LADING (DRAFT)")
    table = doc.add_table(rows=1, cols=2)
    table.cell(0, 0).text = "Load Port"
    table.cell(0, 1).text = "SINGAPORE"
    buf = io.BytesIO()
    doc.save(buf)

    lines = read_docx(buf.getvalue())
    assert "BILL OF LADING (DRAFT)" in lines
    assert "Load Port: SINGAPORE" in lines
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/docs/test_docx_xlsx.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'sdoc.docs.docx_'`

- [ ] **Step 3: Implement the docx reader**

`src/sdoc/docs/docx_.py`:
```python
"""Read .docx paragraphs and tables into 'Label: value' lines."""
import io

from docx import Document


def read_docx(raw: bytes) -> list[str]:
    doc = Document(io.BytesIO(raw))
    lines = [p.text.strip() for p in doc.paragraphs if p.text.strip()]
    for table in doc.tables:
        for row in table.rows:
            cells = [c.text.strip() for c in row.cells]
            if len(cells) >= 2 and cells[0] and cells[1]:
                lines.append(f"{cells[0]}: {cells[1]}")
            elif cells and cells[0]:
                lines.append(cells[0])
    return lines
```

- [ ] **Step 4: Implement the xlsx reader**

`src/sdoc/docs/xlsx.py`:
```python
"""Read .xlsx label/value sheets into 'Label: value' lines.

openpyxl is the primary path; a stdlib zipfile+XML fallback keeps the 22 xlsx
attachments working even if the dependency is unavailable. The bundle's sheets
use inline strings, so there is no sharedStrings.xml to consult.
"""
import html
import io
import re
import zipfile

_ROW = re.compile(rb"<row[^>]*>(.*?)</row>", re.S)
_CELL = re.compile(rb"<c\b[^>]*>(.*?)</c>", re.S)
_TEXT = re.compile(rb"<t[^>]*>(.*?)</t>", re.S)


def _rows_to_lines(rows: list[list[str]]) -> list[str]:
    lines = []
    for cells in rows:
        cells = [html.unescape(c).strip() for c in cells if c is not None]
        cells = [c for c in cells if c]
        if len(cells) >= 2:
            lines.append(f"{cells[0]}: {cells[1]}")
        elif len(cells) == 1:
            lines.append(cells[0])
    return lines


def _read_with_stdlib(raw: bytes) -> list[list[str]]:
    rows = []
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        names = [n for n in z.namelist() if n.startswith("xl/worksheets/sheet")]
        for name in sorted(names):
            blob = z.read(name)
            for row_match in _ROW.finditer(blob):
                cells = []
                for cell_match in _CELL.finditer(row_match.group(1)):
                    texts = _TEXT.findall(cell_match.group(1))
                    cells.append(
                        " ".join(t.decode("utf-8", "replace") for t in texts)
                    )
                rows.append(cells)
    return rows


def _read_with_openpyxl(raw: bytes) -> list[list[str]]:
    import openpyxl

    wb = openpyxl.load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
    rows = []
    for ws in wb.worksheets:
        for row in ws.iter_rows(values_only=True):
            rows.append(["" if v is None else str(v) for v in row])
    wb.close()
    return rows


def read_xlsx(raw: bytes) -> list[str]:
    try:
        rows = _read_with_openpyxl(raw)
    except Exception:
        rows = _read_with_stdlib(raw)
    if not any(any(c.strip() for c in r) for r in rows):
        rows = _read_with_stdlib(raw)
    return _rows_to_lines(rows)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/docs/test_docx_xlsx.py -v`
Expected: PASS — 4 passed.

- [ ] **Step 6: Add an integration test over the real bundle**

`tests/docs/test_ingest_integration.py`:
```python
from pathlib import Path

import pytest

from sdoc.docs.ingest import ingest

DATA = Path("data")
pytestmark = pytest.mark.skipif(not DATA.exists(), reason="data/ bundle absent")


@pytest.mark.integration
def test_every_attachment_ingests_without_error():
    failures = []
    for p in sorted((DATA / "attachments").iterdir()):
        doc = ingest(str(p), p.read_bytes())
        if doc.error:
            failures.append((p.name, doc.error))
    assert failures == [], f"{len(failures)} attachments failed: {failures[:10]}"


@pytest.mark.integration
def test_attachment_count_matches_expectation():
    assert len(list((DATA / "attachments").iterdir())) == 250
```

Run: `pytest tests/docs -v -m integration`
Expected: PASS — all 250 attachments ingest with no error.

- [ ] **Step 7: Commit**

```bash
git add src/sdoc/docs tests/docs
git commit -m "feat: ingest docx and xlsx attachments, with stdlib xlsx fallback"
```

---

## Task 4: Doc-type detection, role assignment, and gates

This task fixes the first bug found in the prior plan. All 14 PDF Shipping Instructions are headed `BILL OF LADING INSTRUCTION`; a substring test for `BILL OF LADING` before `INSTRUCTION` destroys every PDF comparison.

**Files:**
- Create: `src/sdoc/doctype.py`, `src/sdoc/gates.py`
- Test: `tests/test_doctype.py`, `tests/test_gates.py`

**Interfaces:**
- Consumes: `sdoc.models.DocText`
- Produces:
  - `sdoc.doctype.detect_doc_type(doc: DocText) -> str` returning `"SI"`, `"BL"` or `"OTHER"`
  - `sdoc.doctype.assign_roles(docs: list[DocText]) -> tuple[DocText | None, DocText | None]` returning `(si, bl)`
  - `sdoc.gates.pre_extraction_gate(docs: list[DocText]) -> str | None` returning a review reason or `None`

- [ ] **Step 1: Write the failing tests**

`tests/test_doctype.py`:
```python
from sdoc.doctype import assign_roles, detect_doc_type
from sdoc.models import DocText


def doc(path, *lines):
    return DocText(path=path, lines=list(lines), fmt=path.rsplit(".", 1)[-1])


def test_shipping_instruction_header():
    assert detect_doc_type(doc("a_SI.txt", "SHIPPING INSTRUCTION", "====")) == "SI"


def test_bill_of_lading_instruction_is_an_SI_not_a_BL():
    """All 14 PDF SIs in the bundle use this header. Ordering matters."""
    assert detect_doc_type(doc("a_SI.pdf", "BILL OF LADING INSTRUCTION")) == "SI"


def test_bl_instruction_xlsx_variant_is_an_SI():
    d = doc("a_SI.xlsx", "APRIL FAR EAST (M) SDN BHD", "BL INSTRUCTION: 3815798123")
    assert detect_doc_type(d) == "SI"


def test_draft_bill_of_lading_is_a_BL():
    assert detect_doc_type(doc("a_BL.txt", "BILL OF LADING (DRAFT)", "====")) == "BL"


def test_bill_of_lading_xlsx_variant_is_a_BL():
    d = doc("a_BL.xlsx", "ASIA PACIFIC PAPERBOARD TRADING PTE LTD",
            "BILL OF LADING: 3154303911")
    assert detect_doc_type(d) == "BL"


def test_packing_list_is_other():
    assert detect_doc_type(doc("a_BL.txt", "PACKING LIST", "====")) == "OTHER"


def test_commercial_invoice_is_other():
    assert detect_doc_type(doc("a_BL.txt", "COMMERCIAL INVOICE", "====")) == "OTHER"


def test_body_mentioning_bill_of_lading_does_not_vote():
    d = doc("a_SI.txt", "SHIPPING INSTRUCTION", "====", "Shipper: X",
            "Please issue the bill of lading promptly")
    assert detect_doc_type(d) == "SI"


def test_assign_roles_uses_header_not_filename():
    si = doc("email_009_BL.txt", "SHIPPING INSTRUCTION")
    bl = doc("email_009_SI.txt", "BILL OF LADING (DRAFT)")
    got_si, got_bl = assign_roles([si, bl])
    assert got_si.path.endswith("_BL.txt")
    assert got_bl.path.endswith("_SI.txt")


def test_assign_roles_returns_none_when_no_bl():
    si = doc("a_SI.txt", "SHIPPING INSTRUCTION")
    other = doc("a_BL.txt", "PACKING LIST")
    got_si, got_bl = assign_roles([si, other])
    assert got_si is not None
    assert got_bl is None
```

`tests/test_gates.py`:
```python
from sdoc.gates import pre_extraction_gate
from sdoc.models import DocText


def doc(path, *lines, error=None):
    return DocText(path=path, lines=list(lines), fmt="txt", error=error)


def test_no_attachments_is_missing_attachment():
    assert pre_extraction_gate([]) == "missing_attachment"


def test_single_attachment_is_missing_attachment():
    assert pre_extraction_gate([doc("a_SI.txt", "SHIPPING INSTRUCTION")]) == "missing_attachment"


def test_unreadable_doc_wins_over_doc_type():
    docs = [doc("a_SI.txt", "SHIPPING INSTRUCTION"),
            doc("a_BL.txt", error="parse_failed: RuntimeError")]
    assert pre_extraction_gate(docs) == "unreadable"


def test_wrong_doc_type_when_bl_is_a_packing_list():
    docs = [doc("a_SI.txt", "SHIPPING INSTRUCTION", "===="),
            doc("a_BL.txt", "PACKING LIST", "====")]
    assert pre_extraction_gate(docs) == "wrong_doc_type"


def test_two_shipping_instructions_is_wrong_doc_type():
    docs = [doc("a_SI.txt", "SHIPPING INSTRUCTION"),
            doc("a_BL.txt", "SHIPPING INSTRUCTION")]
    assert pre_extraction_gate(docs) == "wrong_doc_type"


def test_valid_pair_passes():
    docs = [doc("a_SI.txt", "SHIPPING INSTRUCTION", "===="),
            doc("a_BL.txt", "BILL OF LADING (DRAFT)", "====")]
    assert pre_extraction_gate(docs) is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_doctype.py tests/test_gates.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'sdoc.doctype'`

- [ ] **Step 3: Implement doc-type detection**

`src/sdoc/doctype.py`:
```python
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
```

- [ ] **Step 4: Implement the gates**

`src/sdoc/gates.py`:
```python
"""Document-defect gates. Each maps 1:1 onto a permitted review reason.

A reading problem is never a discrepancy.
"""
from sdoc.doctype import assign_roles
from sdoc.models import DocText


def pre_extraction_gate(docs: list[DocText]) -> str | None:
    """Return a review reason, or None when the pair is usable."""
    if len(docs) < 2:
        return "missing_attachment"
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/test_doctype.py tests/test_gates.py -v`
Expected: PASS — 16 passed.

- [ ] **Step 6: Add an integration check against the known wrong-doc-type set**

Append to `tests/docs/test_ingest_integration.py`:
```python
from sdoc.doctype import detect_doc_type

WRONG_DOC_EMAILS = {"email_501", "email_502", "email_503", "email_504", "email_505"}


@pytest.mark.integration
def test_all_pdf_shipping_instructions_detect_as_SI():
    for p in sorted((DATA / "attachments").glob("*_SI.pdf")):
        doc = ingest(str(p), p.read_bytes())
        assert detect_doc_type(doc) == "SI", f"{p.name} misdetected"


@pytest.mark.integration
def test_known_wrong_documents_detect_as_other():
    for eid in sorted(WRONG_DOC_EMAILS):
        p = DATA / "attachments" / f"{eid}_BL.txt"
        doc = ingest(str(p), p.read_bytes())
        assert detect_doc_type(doc) == "OTHER", f"{p.name} should be OTHER"
```

Run: `pytest tests/docs -v -m integration`
Expected: PASS — 14 PDF SIs detect as SI, 5 known bad documents detect as OTHER.

- [ ] **Step 7: Commit**

```bash
git add src/sdoc/doctype.py src/sdoc/gates.py tests
git commit -m "feat: header-ordered doc-type detection and defect gates"
```

---

## Task 5: Label normalisation and the variant map

51 files carry `Gross Weight毛重(KGS)` — a label with CJK characters spliced into it. One normalisation rule (drop non-ASCII, then drop parenthesised segments) resolves it along with every other variant.

**Files:**
- Create: `src/sdoc/extract/__init__.py`, `src/sdoc/extract/labels.py`
- Test: `tests/extract/test_labels.py`

**Interfaces:**
- Produces:
  - `sdoc.extract.labels.normalize_label(raw: str) -> str`
  - `sdoc.extract.labels.field_for_label(raw: str) -> str | None`

- [ ] **Step 1: Write the failing tests**

`tests/extract/test_labels.py`:
```python
import pytest

from sdoc.extract.labels import field_for_label, normalize_label


def test_strips_cjk_characters_from_label():
    assert normalize_label("Gross Weight毛重(KGS)") == "GROSS WEIGHT"


def test_strips_parenthesised_codes():
    assert normalize_label("Port of Loading (POL)") == "PORT OF LOADING"


def test_collapses_punctuation_and_case():
    assert normalize_label("No. of Containers") == "NO OF CONTAINERS"
    assert normalize_label("Shipper/Exporter") == "SHIPPER EXPORTER"


@pytest.mark.parametrize("label,expected", [
    ("Shipper", "shipper"),
    ("SHIPPER", "shipper"),
    ("Shipper/Exporter", "shipper"),
    ("Shipper (Principal or Seller)", "shipper"),
    ("Consignee", "consignee"),
    ("Consignee (Non-Negotiable)", "consignee"),
    ("To the Order of", "consignee"),
    ("Notify", "notify_party"),
    ("Notify Party", "notify_party"),
    ("Notify Party/Intermediate Consignee", "notify_party"),
    ("Port of Loading", "port_of_loading"),
    ("POL", "port_of_loading"),
    ("Port of Loading (POL)", "port_of_loading"),
    ("Load Port", "port_of_loading"),
    ("PORT OF LOADING", "port_of_loading"),
    ("Port of Discharge", "port_of_discharge"),
    ("POD", "port_of_discharge"),
    ("Discharge Port", "port_of_discharge"),
    ("Port of Discharge (POD)", "port_of_discharge"),
    ("Total Containers", "container_count"),
    ("Container Count", "container_count"),
    ("No. of Containers", "container_count"),
    ("No. of Containers or Packages", "container_count"),
    ("Gross Wt (kgs)", "gross_weight_kg"),
    ("Gross Weight (KG)", "gross_weight_kg"),
    ("GROSS WEIGHT", "gross_weight_kg"),
    ("TOTAL Gross Wt (kgs)", "gross_weight_kg"),
    ("Gross Weight毛重(KGS)", "gross_weight_kg"),
])
def test_known_labels_map_to_fields(label, expected):
    assert field_for_label(label) == expected


@pytest.mark.parametrize("label", [
    "Vessel", "Voyage", "Voy. No", "HS Code", "Freight", "OC No.",
    "Booking Ref", "Commodity", "Description of Goods",
    "Export Carrier (vessel, voyage)", "Ocean Vessel", "B/L No.",
])
def test_irrelevant_labels_map_to_nothing(label):
    assert field_for_label(label) is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/extract/test_labels.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'sdoc.extract'`

- [ ] **Step 3: Implement normalisation and the map**

`src/sdoc/extract/labels.py`:
```python
"""Map the ~45 observed label spellings onto the seven canonical fields.

Normalisation drops non-ASCII characters first: 51 attachments use the label
'Gross Weight<CJK>(KGS)', where the CJK run sits inside the label text.
"""
import re
import unicodedata

_PARENS = re.compile(r"\(.*?\)")
_NON_ALPHA = re.compile(r"[^A-Za-z ]")
_SPACES = re.compile(r"\s+")

_VARIANTS: dict[str, list[str]] = {
    "shipper": [
        "Shipper", "Shipper/Exporter", "Shipper (Principal or Seller)",
    ],
    "consignee": [
        "Consignee", "Consignee (Non-Negotiable)", "To the Order of",
    ],
    "notify_party": [
        "Notify", "Notify Party", "Notify Party/Intermediate Consignee",
    ],
    "port_of_loading": [
        "Port of Loading", "POL", "Load Port", "Port of Loading (POL)",
    ],
    "port_of_discharge": [
        "Port of Discharge", "POD", "Discharge Port", "Port of Discharge (POD)",
    ],
    "container_count": [
        "Total Containers", "Container Count", "No. of Containers",
        "No. of Containers or Packages", "Number of Containers",
        "Containers", "Total No. of Containers",
    ],
    "gross_weight_kg": [
        "Gross Wt (kgs)", "Gross Weight (KG)", "Gross Weight", "Gross Wt",
        "TOTAL Gross Wt (kgs)", "Total Gross Weight", "Gross Weight (KGS)",
    ],
}


def normalize_label(raw: str) -> str:
    s = unicodedata.normalize("NFKC", raw)
    s = "".join(ch for ch in s if ord(ch) < 128)
    s = _PARENS.sub(" ", s)
    s = _NON_ALPHA.sub(" ", s)
    return _SPACES.sub(" ", s).strip().upper()


LABEL_TO_FIELD: dict[str, str] = {}
for _field, _labels in _VARIANTS.items():
    for _label in _labels:
        LABEL_TO_FIELD[normalize_label(_label)] = _field


def field_for_label(raw: str) -> str | None:
    return LABEL_TO_FIELD.get(normalize_label(raw))
```

`src/sdoc/extract/__init__.py`: empty file.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/extract/test_labels.py -v`
Expected: PASS — 43 passed.

- [ ] **Step 5: Commit**

```bash
git add src/sdoc/extract tests/extract
git commit -m "feat: label normalisation handling CJK-contaminated field labels"
```

---

## Task 6: Linear and block field extractors

Two layouts, one field set. `.txt`/`.xlsx`/`.docx` use `Label: value`; `.pdf` puts the label on its own line with the value beneath.

**Files:**
- Create: `src/sdoc/extract/linear.py`, `src/sdoc/extract/block.py`, `src/sdoc/extract/engine.py`
- Test: `tests/extract/test_extractors.py`

**Interfaces:**
- Consumes: `sdoc.extract.labels.field_for_label`, `sdoc.models.DocText`
- Produces:
  - `sdoc.extract.linear.extract_linear(doc: DocText) -> dict[str, str]`
  - `sdoc.extract.block.extract_block(doc: DocText) -> dict[str, str]`
  - `sdoc.extract.engine.extract_text_fields(doc: DocText) -> dict[str, str]` — chooses the layout and merges results.
  - `sdoc.extract.engine.snippet_for(doc: DocText, field_name: str) -> str` — surrounding lines, for L4 evidence.

- [ ] **Step 1: Write the failing tests**

`tests/extract/test_extractors.py`:
```python
from sdoc.extract.engine import extract_text_fields, snippet_for
from sdoc.models import DocText

TXT_SI = DocText(path="a_SI.txt", fmt="txt", lines="""SHIPPING INSTRUCTION
========================================

Shipper (Principal or Seller): ASIA PACIFIC PAPERBOARD TRADING PTE LTD
  80 RAFFLES PLACE, #50-01 UOB PLAZA 1; SINGAPORE 048624
CONSIGNEE: ROXCEL TRADING GMBH
  OPERNRING 3-5; 1010 VIENNA, AUSTRIA
Notify Party: ROXCEL TRADING GMBH
Port of Loading: SINGAPORE (SGSIN)
Port of Discharge (POD): MOMBASA, KENYA (KEMBA)
No. of Containers: 3 x 40'HC
Gross Weight毛重(KGS): 67,311 KG
Vessel: VISION 202 V.002""".splitlines())

PDF_SI = DocText(path="a_SI.pdf", fmt="pdf", lines="""BILL OF LADING INSTRUCTION
B/L NUMBER: OOLU3584143842    BOOKING NO. PSGSE4981829
Shipper
APRIL FINE PAPER TRADING
ON BEHALF OF VITAL SOLUTIONS PTE LTD
77 ROBINSON ROAD, #21-01
SINGAPORE 068896
Consignee
BALL & DOGGETT AUSTRALIA PTY LTD
43-45 METROPOLITAN ROAD
ENFIELD NSW 2136, AUSTRALIA
Notify Party
PACIFIC OFFICE (M) SDN BHD
LOT 6, JALAN P/7
POL
BUATAN, INDONESIA
Port of Discharge (POD)
FREMANTLE, AUSTRALIA
Ocean Vessel
SOLID 16 V.044NW2""".splitlines())


def test_linear_extracts_all_five_text_fields():
    got = extract_text_fields(TXT_SI)
    assert got["shipper"].startswith("ASIA PACIFIC PAPERBOARD TRADING")
    assert got["consignee"].startswith("ROXCEL TRADING GMBH")
    assert got["notify_party"].startswith("ROXCEL TRADING GMBH")
    assert got["port_of_loading"] == "SINGAPORE (SGSIN)"
    assert got["port_of_discharge"] == "MOMBASA, KENYA (KEMBA)"


def test_linear_captures_continuation_lines_into_the_value():
    got = extract_text_fields(TXT_SI)
    assert "RAFFLES PLACE" in got["shipper"]


def test_linear_handles_cjk_contaminated_label():
    assert extract_text_fields(TXT_SI)["gross_weight_kg"] == "67,311 KG"


def test_block_layout_extracts_multiline_values():
    got = extract_text_fields(PDF_SI)
    assert got["shipper"].startswith("APRIL FINE PAPER TRADING")
    assert "ROBINSON ROAD" in got["shipper"]
    assert got["consignee"].startswith("BALL & DOGGETT AUSTRALIA PTY LTD")
    assert got["port_of_loading"] == "BUATAN, INDONESIA"
    assert got["port_of_discharge"] == "FREMANTLE, AUSTRALIA"


def test_block_layout_stops_at_the_next_known_label():
    got = extract_text_fields(PDF_SI)
    assert "Consignee" not in got["shipper"]
    assert "PACIFIC OFFICE" not in got["consignee"]


def test_snippet_returns_surrounding_context():
    snip = snippet_for(TXT_SI, "consignee")
    assert "ROXCEL TRADING GMBH" in snip
    assert len(snip) <= 400
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/extract/test_extractors.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'sdoc.extract.engine'`

- [ ] **Step 3: Implement the linear extractor**

`src/sdoc/extract/linear.py`:
```python
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
```

- [ ] **Step 4: Implement the block extractor**

`src/sdoc/extract/block.py`:
```python
"""Extract 'Label on its own line, value beneath' layouts (.pdf).

A value runs until the next line that is itself a known label, or until a
line that looks like a table header.
"""
from sdoc.extract.labels import field_for_label
from sdoc.models import DocText

_TABLE_MARKERS = ("CONTAINER NO.", "DESCRIPTION", "GROSS WEIGHT (KG)")


def _is_boundary(line: str) -> bool:
    stripped = line.strip()
    if not stripped:
        return True
    if stripped.upper() in _TABLE_MARKERS:
        return True
    return field_for_label(stripped) is not None


def extract_block(doc: DocText) -> dict[str, str]:
    found: dict[str, str] = {}
    lines = doc.lines
    for i, line in enumerate(lines):
        stripped = line.strip()
        if not stripped or ":" in stripped:
            continue
        name = field_for_label(stripped)
        if not name or name in found:
            continue
        parts: list[str] = []
        for nxt in lines[i + 1:]:
            if _is_boundary(nxt):
                break
            parts.append(nxt.strip())
        if parts:
            found[name] = "; ".join(parts)
    return found
```

- [ ] **Step 5: Implement the engine that picks a layout**

`src/sdoc/extract/engine.py`:
```python
"""Choose an extraction layout and merge what each finds."""
from sdoc.extract.block import extract_block
from sdoc.extract.labels import field_for_label
from sdoc.extract.linear import extract_linear
from sdoc.models import DocText

TEXT_FIELDS = ("shipper", "consignee", "notify_party",
               "port_of_loading", "port_of_discharge")


def extract_text_fields(doc: DocText) -> dict[str, str]:
    """Run both layouts; linear wins where they disagree, block fills gaps."""
    linear = extract_linear(doc)
    block = extract_block(doc)
    merged = dict(block)
    merged.update({k: v for k, v in linear.items() if v})
    return merged


def snippet_for(doc: DocText, field_name: str, width: int = 3) -> str:
    """The lines around where a field was found — evidence for L4 and the UI."""
    for i, line in enumerate(doc.lines):
        label = line.partition(":")[0] if ":" in line else line
        if field_for_label(label.strip()) == field_name:
            lo = max(0, i - 1)
            chunk = [x.strip() for x in doc.lines[lo:i + width + 1] if x.strip()]
            return " | ".join(chunk)[:400]
    return ""
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pytest tests/extract/test_extractors.py -v`
Expected: PASS — 6 passed.

- [ ] **Step 7: Commit**

```bash
git add src/sdoc/extract tests/extract
git commit -m "feat: linear and block field extractors with evidence snippets"
```

---

## Task 7: Numeric extraction with table cross-check

This fixes the second bug found in the prior plan. In PDFs the container count and gross weight live in a table — `parse number + unit` on a labelled line never fires. Three sources are consulted and cross-checked.

Measured: container counts are always `N x TYPE`. Weights are `NNN,NNN KG` or a bare integer. **No `MT` units, no number words, no `THREE (3)` forms exist in this dataset** — do not build parsers for them.

**Files:**
- Create: `src/sdoc/extract/numeric.py`
- Modify: `src/sdoc/extract/engine.py` (add `extract_all_fields`)
- Test: `tests/extract/test_numeric.py`

**Interfaces:**
- Consumes: `sdoc.extract.labels.field_for_label`, `sdoc.models.DocText`
- Produces:
  - `sdoc.extract.numeric.parse_container_count(value: str) -> int | None`
  - `sdoc.extract.numeric.parse_weight_kg(value: str) -> int | None`
  - `sdoc.extract.numeric.extract_numeric_fields(doc: DocText) -> dict` with keys `container_count`, `gross_weight_kg`, `_conflict`
  - `sdoc.extract.engine.extract_all_fields(doc: DocText) -> dict`

- [ ] **Step 1: Write the failing tests**

`tests/extract/test_numeric.py`:
```python
from sdoc.extract.numeric import (
    extract_numeric_fields,
    parse_container_count,
    parse_weight_kg,
)
from sdoc.models import DocText


def test_parse_container_count_takes_leading_integer():
    assert parse_container_count("6 x 40'HC") == 6
    assert parse_container_count("15 x 20'GP") == 15
    assert parse_container_count("1 x 20'FCL") == 1


def test_parse_container_count_rejects_prose():
    assert parse_container_count("COATED IVORY BOARD") is None
    assert parse_container_count("") is None


def test_parse_weight_strips_thousands_separators_and_unit():
    assert parse_weight_kg("131,322 KG") == 131322
    assert parse_weight_kg("67,311 KG") == 67311
    assert parse_weight_kg("341715") == 341715


def test_parse_weight_rejects_unparseable():
    assert parse_weight_kg("PREPAID") is None
    assert parse_weight_kg("") is None


def test_summary_lines_are_preferred():
    doc = DocText(path="a.txt", fmt="txt", lines=[
        "No. of Containers: 3 x 40'HC",
        "Gross Weight (KG): 67,311 KG",
    ])
    got = extract_numeric_fields(doc)
    assert got["container_count"] == 3
    assert got["gross_weight_kg"] == 67311


def test_table_rows_are_counted_and_summed_when_no_summary():
    doc = DocText(path="a.pdf", fmt="pdf", lines="""CONTAINER NO.
DESCRIPTION
GROSS WEIGHT (KG)
PURJ4736471
40'HC UNCOATED WOODFREE PAPER IN REA
21,887
WBFO6773592
40'HC UNCOATED WOODFREE PAPER IN REA
21,887
KWKX5625881
40'HC UNCOATED WOODFREE PAPER IN REA
21,887""".splitlines())
    got = extract_numeric_fields(doc)
    assert got["container_count"] == 3
    assert got["gross_weight_kg"] == 65661


def test_agreeing_summary_and_table_resolve_cleanly():
    """6 containers x 21,887 = 131,322 — the real email_059 shape."""
    rows = []
    for tag in ["PURJ4736471", "WBFO6773592", "KWKX5625881",
                "KHOD4732104", "MTNH2595327", "QOPJ7016873"]:
        rows += [tag, "40'HC UNCOATED WOODFREE PAPER IN REA", "21,887"]
    doc = DocText(path="a.pdf", fmt="pdf", lines=(
        ["CONTAINER NO.", "DESCRIPTION", "GROSS WEIGHT (KG)"] + rows
        + ["No. of Containers: 6 x 40'HC", "TOTAL Gross Wt (kgs): 131,322 KG"]))
    got = extract_numeric_fields(doc)
    assert got["container_count"] == 6
    assert got["gross_weight_kg"] == 131322
    assert got["_conflict"] is False


def test_disagreeing_summary_and_table_flag_a_conflict():
    """A reading problem, never a discrepancy."""
    doc = DocText(path="a.pdf", fmt="pdf", lines=[
        "CONTAINER NO.", "DESCRIPTION", "GROSS WEIGHT (KG)",
        "AAA1111111", "40'HC PAPER", "10,000",
        "BBB2222222", "40'HC PAPER", "10,000",
        "No. of Containers: 5 x 40'HC",
    ])
    got = extract_numeric_fields(doc)
    assert got["_conflict"] is True
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/extract/test_numeric.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'sdoc.extract.numeric'`

- [ ] **Step 3: Implement the numeric parsers**

`src/sdoc/extract/numeric.py`:
```python
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
```

- [ ] **Step 4: Extend the engine to produce all seven fields**

Append to `src/sdoc/extract/engine.py`:
```python
from sdoc.extract.numeric import extract_numeric_fields


def extract_all_fields(doc: DocText) -> dict:
    """All seven fields plus a _conflict flag from the numeric cross-check."""
    fields = dict(extract_text_fields(doc))
    numeric = extract_numeric_fields(doc)
    fields["container_count"] = numeric["container_count"]
    fields["gross_weight_kg"] = numeric["gross_weight_kg"]
    fields["_conflict"] = numeric["_conflict"]
    return fields
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/extract -v`
Expected: PASS — all extract tests pass.

- [ ] **Step 6: Add an integration test measuring extraction coverage**

`tests/extract/test_extract_integration.py`:
```python
from pathlib import Path

import pytest

from sdoc.docs.ingest import ingest
from sdoc.extract.engine import extract_all_fields
from sdoc.models import FIELDS

DATA = Path("data")
pytestmark = pytest.mark.skipif(not DATA.exists(), reason="data/ bundle absent")


@pytest.mark.integration
def test_deterministic_extraction_covers_most_fields():
    """Report coverage so regressions are visible. The threshold is deliberately
    loose — the Gemini fallback in Task 12 closes the remainder."""
    total = filled = 0
    gaps: dict[str, int] = {}
    for p in sorted((DATA / "attachments").iterdir()):
        doc = ingest(str(p), p.read_bytes())
        if doc.error:
            continue
        got = extract_all_fields(doc)
        for name in FIELDS:
            total += 1
            if got.get(name):
                filled += 1
            else:
                gaps[name] = gaps.get(name, 0) + 1
    coverage = filled / total
    print(f"\ncoverage={coverage:.3f} gaps={sorted(gaps.items(), key=lambda x: -x[1])}")
    assert coverage > 0.90, f"coverage {coverage:.3f} too low; gaps={gaps}"
```

Run: `pytest tests/extract -v -m integration -s`
Expected: PASS, and the printed `gaps` dict names exactly which fields need the Gemini fallback.

- [ ] **Step 7: Commit**

```bash
git add src/sdoc/extract tests/extract
git commit -m "feat: numeric extraction from summary lines and container tables"
```

---

## Task 8: L1 canonicalization and L3 similarity

**Files:**
- Create: `src/sdoc/compare/__init__.py`, `src/sdoc/compare/canon.py`, `src/sdoc/compare/similarity.py`
- Test: `tests/compare/test_canon.py`, `tests/compare/test_similarity.py`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `sdoc.compare.canon.canon_port(value: str) -> str`
  - `sdoc.compare.canon.canon_party(value: str) -> str`
  - `sdoc.compare.canon.party_name(value: str) -> str`
  - `sdoc.compare.similarity.token_set_ratio(a: str, b: str) -> float`
  - `sdoc.compare.similarity.band(score: float) -> str` returning `"SAME"`, `"DIFFERENT"` or `"GRAY"`
  - Module constants `SAME_AT = 0.92`, `DIFFERENT_AT = 0.72`, `GRAY_MIDPOINT = 0.82`

- [ ] **Step 1: Write the failing tests**

`tests/compare/test_canon.py`:
```python
from sdoc.compare.canon import canon_party, canon_port, party_name


def test_port_drops_country_and_parenthesised_code():
    assert canon_port("NANTONG, CHINA (CNNTG)") == "NANTONG"
    assert canon_port("SINGAPORE (SGSIN)") == "SINGAPORE"
    assert canon_port("MOMBASA, KENYA (KEMBA)") == "MOMBASA"


def test_port_handles_bare_names():
    assert canon_port("SINGAPORE") == "SINGAPORE"
    assert canon_port("PORT KLANG (WESTPORT), MALAYSIA") == "PORT KLANG"


def test_port_is_case_insensitive():
    assert canon_port("nantong, china") == canon_port("NANTONG, CHINA")


def test_party_drops_legal_suffixes():
    assert canon_party("ACME TRADING PTE LTD") == "ACME TRADING"
    assert canon_party("ACME TRADING SDN BHD") == "ACME TRADING"
    assert canon_party("ACME TRADING CO., LTD") == "ACME TRADING"
    assert canon_party("ACME TRADING GMBH") == "ACME TRADING"
    assert canon_party("ACME TRADING PTY LTD") == "ACME TRADING"
    assert canon_party("ACME TRADING FZ-LLC") == "ACME TRADING"
    assert canon_party("ACME TRADING INC.") == "ACME TRADING"


def test_party_name_stops_at_the_address():
    value = "ROXCEL TRADING GMBH; OPERNRING 3-5; 1010 VIENNA, AUSTRIA"
    assert party_name(value) == "ROXCEL TRADING"


def test_party_name_handles_pipe_separator():
    value = "BALL & DOGGETT AUSTRALIA PTY LTD | 43-45 METROPOLITAN ROAD"
    assert party_name(value) == "BALL DOGGETT AUSTRALIA"
```

`tests/compare/test_similarity.py`:
```python
from sdoc.compare.similarity import band, token_set_ratio


def test_identical_strings_score_one():
    assert token_set_ratio("ACME TRADING", "ACME TRADING") == 1.0


def test_reordered_tokens_still_match():
    assert token_set_ratio("TRADING ACME", "ACME TRADING") == 1.0


def test_unrelated_strings_score_low():
    assert token_set_ratio("EAST BRIGHT", "UAB NOVAKOPA") < 0.5


def test_bands_apply_the_spec_thresholds():
    assert band(1.0) == "SAME"
    assert band(0.92) == "SAME"
    assert band(0.80) == "GRAY"
    assert band(0.72) == "DIFFERENT"
    assert band(0.10) == "DIFFERENT"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/compare -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'sdoc.compare'`

- [ ] **Step 3: Implement canonicalization**

`src/sdoc/compare/canon.py`:
```python
"""L1 — strip away the formatting differences that are not discrepancies."""
import re

_PARENS = re.compile(r"\(.*?\)")
_PUNCT = re.compile(r"[^A-Z0-9 ]")
_SPACES = re.compile(r"\s+")

_LEGAL_SUFFIXES = (
    "PTE LTD", "PTY LTD", "CO LTD", "SDN BHD", "FZ LLC", "FZE", "GMBH",
    "LLC", "LTD", "INC", "CORP", "BV", "NV", "SA", "AG", "PLC", "LIMITED",
)


def _base(value: str) -> str:
    s = (value or "").upper()
    s = _PARENS.sub(" ", s)
    s = _PUNCT.sub(" ", s)
    return _SPACES.sub(" ", s).strip()


def canon_port(value: str) -> str:
    """Ports: drop parenthesised codes and any trailing country."""
    s = _PARENS.sub(" ", (value or "").upper())
    s = s.split(",")[0]
    s = _PUNCT.sub(" ", s)
    return _SPACES.sub(" ", s).strip()


def canon_party(value: str) -> str:
    """Parties: drop legal suffixes and flatten to a comparable name."""
    s = _base(value)
    changed = True
    while changed:
        changed = False
        for suffix in _LEGAL_SUFFIXES:
            if s.endswith(" " + suffix):
                s = s[: -(len(suffix) + 1)].strip()
                changed = True
    return s


def party_name(value: str) -> str:
    """The name portion only — everything before the first address separator.

    Addresses in this dataset follow the name after ';' or '|'. Comparing whole
    blobs lets an identical address carry a match between two genuinely
    different companies (email_004: EAST BRIGHT vs UAB NOVAKOPA, same address).
    """
    head = re.split(r"[;|]", value or "", maxsplit=1)[0]
    return canon_party(head)
```

- [ ] **Step 4: Implement similarity bands**

`src/sdoc/compare/similarity.py`:
```python
"""L3 — token-set similarity with a deliberately narrow gray band."""
SAME_AT = 0.92
DIFFERENT_AT = 0.72
GRAY_MIDPOINT = 0.82


def token_set_ratio(a: str, b: str) -> float:
    """Jaccard overlap of token sets. Order-insensitive, dependency-free."""
    ta = {t for t in (a or "").split() if t}
    tb = {t for t in (b or "").split() if t}
    if not ta and not tb:
        return 1.0
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def band(score: float) -> str:
    if score >= SAME_AT:
        return "SAME"
    if score <= DIFFERENT_AT:
        return "DIFFERENT"
    return "GRAY"
```

`src/sdoc/compare/__init__.py`: empty file.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/compare -v`
Expected: PASS — 12 passed.

- [ ] **Step 6: Commit**

```bash
git add src/sdoc/compare tests/compare
git commit -m "feat: L1 canonicalization and L3 similarity bands"
```

---

## Task 9: Comparison ladder and rollup

The ladder walks Gate 1 → L1 → L2 → L3, with L4 injected as a callable so this task needs no network. Task 13 supplies the real adjudicator.

**Files:**
- Create: `src/sdoc/compare/ladder.py`, `src/sdoc/compare/rollup.py`, `src/sdoc/config.py`
- Test: `tests/compare/test_ladder.py`, `tests/compare/test_rollup.py`

**Interfaces:**
- Consumes: `sdoc.compare.canon`, `sdoc.compare.similarity`, `sdoc.models.FieldVerdict`, `sdoc.models.FIELDS`
- Produces:
  - `sdoc.compare.ladder.compare_field(field_name, si_value, bl_value, *, alias=None, adjudicator=None, uncertain_lean_same=True, si_snippet="", bl_snippet="") -> FieldVerdict`. The `adjudicator` callable takes keyword arguments `field_name`, `si_value`, `bl_value`, `si_snippet`, `bl_snippet`, `similarity` and returns `{"verdict": str, "reason": str}`. `similarity` is the L3 score, passed through so Task 14's recording wrapper can apply the promotion guard.
  - `sdoc.compare.rollup.rollup(verdicts: list[FieldVerdict], gate_reason: str | None) -> tuple[str, str | None, list[str]]`
  - `sdoc.config.Settings` dataclass and module-level `SETTINGS`

- [ ] **Step 1: Write the failing tests**

`tests/compare/test_ladder.py`:
```python
import pytest

from sdoc.compare.ladder import compare_field

# Token-set ratio of these two is exactly 0.80 — inside the gray band
# (0.72, 0.92) and just below the 0.82 midpoint. Every gray-band test below
# depends on that, so do not change these strings.
GRAY_A = "ACME GLOBAL TRADING HOLDINGS GROUP"
GRAY_B = "ACME GLOBAL TRADING HOLDINGS"


def test_gray_values_sit_in_the_band():
    """Guards the fixtures the gray-band tests rely on."""
    from sdoc.compare.similarity import band, token_set_ratio
    score = token_set_ratio(GRAY_A, GRAY_B)
    assert score == pytest.approx(0.80)
    assert band(score) == "GRAY"


def test_numeric_equal_is_same_without_a_model():
    v = compare_field("container_count", 6, 6)
    assert v.verdict == "SAME"
    assert v.decided_by == "gate1"


def test_numeric_unequal_is_different():
    v = compare_field("container_count", 3, 4)
    assert v.verdict == "DIFFERENT"
    assert v.decided_by == "gate1"


def test_numeric_never_calls_the_adjudicator():
    calls = []

    def spy(**kwargs):
        calls.append(kwargs)
        return {"verdict": "SAME"}

    compare_field("gross_weight_kg", 100, 200, adjudicator=spy)
    assert calls == []


def test_missing_numeric_is_missing_not_different():
    v = compare_field("container_count", None, 4)
    assert v.verdict == "MISSING"


def test_l1_resolves_formatting_differences():
    v = compare_field("port_of_loading", "NANTONG, CHINA (CNNTG)", "NANTONG")
    assert v.verdict == "SAME"
    assert v.decided_by == "L1"


def test_l1_resolves_legal_suffix_differences():
    v = compare_field("shipper", "ACME TRADING PTE LTD", "ACME TRADING")
    assert v.verdict == "SAME"
    assert v.decided_by == "L1"


def test_l2_alias_table_resolves_known_pairs():
    alias = {"ACME": "GLOBEX", "GLOBEX": "GLOBEX"}
    v = compare_field("shipper", "ACME", "GLOBEX", alias=alias)
    assert v.verdict == "SAME"
    assert v.decided_by == "L2"


def test_different_companies_at_the_same_address_are_different():
    """email_004: identical address, genuinely different consignee."""
    si = "EAST BRIGHT FZ-LLC; RAKEZ AMENITY CENTER; AL HAMRA, RAK, UAE"
    bl = "UAB NOVAKOPA; RAKEZ AMENITY CENTER; AL HAMRA, RAK, UAE"
    v = compare_field("consignee", si, bl)
    assert v.verdict == "DIFFERENT"


def test_gray_band_calls_the_adjudicator():
    seen = {}

    def adjudicator(**kwargs):
        seen.update(kwargs)
        return {"verdict": "SAME", "reason": "same entity abbreviated"}

    v = compare_field("shipper", GRAY_A, GRAY_B, adjudicator=adjudicator)
    assert v.decided_by == "L4"
    assert seen["field_name"] == "shipper"
    assert v.verdict == "SAME"


def test_adjudicator_uncertain_falls_back_to_the_midpoint():
    """0.80 is below the 0.82 midpoint, so an UNCERTAIN leans DIFFERENT."""
    v = compare_field("shipper", GRAY_A, GRAY_B,
                      adjudicator=lambda **kw: {"verdict": "UNCERTAIN"})
    assert v.decided_by == "resolver"
    assert v.verdict == "DIFFERENT"


def test_uncertain_lean_is_switchable():
    v = compare_field("shipper", GRAY_A, GRAY_B,
                      adjudicator=lambda **kw: {"verdict": "UNCERTAIN"},
                      uncertain_lean_same=False)
    assert v.decided_by == "resolver"
    assert v.verdict == "DIFFERENT"


def test_adjudicator_receives_the_similarity_score():
    """Task 14's promotion guard needs it; without it no L4 alias is ever
    promoted, because the guard compares against a default of 0.0."""
    seen = {}

    def adjudicator(**kwargs):
        seen.update(kwargs)
        return {"verdict": "SAME"}

    v = compare_field("shipper", GRAY_A, GRAY_B, adjudicator=adjudicator)
    assert v.decided_by == "L4"
    assert seen["similarity"] == pytest.approx(0.80)


def test_missing_text_value_is_never_a_difference():
    v = compare_field("shipper", "", "ACME TRADING")
    assert v.verdict == "MISSING"
```

`tests/compare/test_rollup.py`:
```python
from sdoc.compare.rollup import rollup
from sdoc.models import FieldVerdict


def v(name, verdict):
    return FieldVerdict(field_name=name, si_value="a", bl_value="b",
                        verdict=verdict, decided_by="L1")


def test_all_same_is_ok():
    verdicts = [v(n, "SAME") for n in ("shipper", "consignee")]
    assert rollup(verdicts, None) == ("OK", None, [])


def test_any_different_is_a_mismatch():
    verdicts = [v("shipper", "SAME"), v("consignee", "DIFFERENT")]
    status, reason, fields = rollup(verdicts, None)
    assert status == "MISMATCH"
    assert reason is None
    assert fields == ["consignee"]


def test_defect_fields_keep_canonical_order():
    verdicts = [v("gross_weight_kg", "DIFFERENT"), v("consignee", "DIFFERENT")]
    _, _, fields = rollup(verdicts, None)
    assert fields == ["consignee", "gross_weight_kg"]


def test_gate_defect_without_a_difference_is_needs_review():
    assert rollup([v("shipper", "SAME")], "missing_attachment") == (
        "NEEDS_REVIEW", "missing_attachment", [])


def test_a_confirmed_difference_outranks_a_gate_defect():
    verdicts = [v("consignee", "DIFFERENT"), v("shipper", "MISSING")]
    status, reason, fields = rollup(verdicts, "missing_value")
    assert status == "MISMATCH"
    assert reason is None
    assert fields == ["consignee"]


def test_missing_verdicts_alone_produce_needs_review():
    verdicts = [v("shipper", "MISSING"), v("consignee", "SAME")]
    status, reason, _ = rollup(verdicts, None)
    assert status == "NEEDS_REVIEW"
    assert reason == "missing_value"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/compare/test_ladder.py tests/compare/test_rollup.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'sdoc.compare.ladder'`

- [ ] **Step 3: Implement the settings object**

`src/sdoc/config.py`:
```python
"""Tunable switches. Both are decisions the data cannot settle a priori;
each is A/B tested on the scoreboard and the result recorded in docs/scores.md.
"""
from dataclasses import dataclass


@dataclass
class Settings:
    # Treat an attachment-less "confirm docs" email as a comparison request
    # (-> missing_attachment) or leave it GENERAL.
    attachmentless_is_comparison: bool = False
    # Which way an L4 UNCERTAIN leans when it falls back to the midpoint.
    uncertain_lean_same: bool = True
    data_dir: str = "data"
    server: str = "http://localhost:8080"
    alias_snapshot: str | None = None
    use_llm_fallback: bool = True


SETTINGS = Settings()
```

- [ ] **Step 4: Implement the ladder**

`src/sdoc/compare/ladder.py`:
```python
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
```

- [ ] **Step 5: Implement the rollup**

`src/sdoc/compare/rollup.py`:
```python
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
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pytest tests/compare -v`
Expected: PASS — all compare tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/sdoc/compare src/sdoc/config.py tests/compare
git commit -m "feat: comparison ladder and rollup precedence"
```

---

## Task 10: Wire the deterministic pipeline and take a real score

First end-to-end run. Classification is still a placeholder heuristic; everything else is real. This is the baseline Gemini has to beat.

**Files:**
- Create: `src/sdoc/pipeline.py`, `src/sdoc/trace.py`, `scripts/run.py`, `docs/scores.md`
- Delete: `scripts/baseline.py` — Task 1's throwaway prover, fully superseded by `scripts/run.py`. Remove it in this task's commit rather than leaving dead code behind.
- Test: `tests/test_pipeline.py`

**Interfaces:**
- Consumes: every module built so far.
- Produces:
  - `sdoc.pipeline.process_email(email, settings, classifier, adjudicator=None, alias=None, read_bytes=None, extract_fallback=None) -> EmailResult`
  - `sdoc.pipeline.run(settings, classifier, adjudicator=None, alias=None) -> list[EmailResult]`
  - `sdoc.trace.write_traces(results, path="traces.json") -> None`

- [ ] **Step 1: Write the failing test**

`tests/test_pipeline.py`:
```python
from sdoc.config import Settings
from sdoc.pipeline import process_email

SI = """SHIPPING INSTRUCTION
========================================

Shipper: APRIL FAR EAST (M) SDN BHD
Consignee (Non-Negotiable): EAST BRIGHT FZ-LLC
Notify: EAST BRIGHT FZ-LLC
Port of Loading (POL): NANTONG, CHINA (CNNTG)
POD: KARACHI, PAKISTAN (PKKHI)
Total Containers: 6 x 40'HC
Gross Wt (kgs): 131,058 KG
"""

BL_MATCHING = SI.replace("SHIPPING INSTRUCTION", "BILL OF LADING (DRAFT)")
BL_WRONG_CONSIGNEE = BL_MATCHING.replace(
    "Consignee (Non-Negotiable): EAST BRIGHT FZ-LLC",
    "To the Order of: UAB NOVAKOPA")
BL_WRONG_COUNT = BL_MATCHING.replace("Total Containers: 6 x 40'HC",
                                     "Container Count: 4 x 40'HC")
BL_PACKING_LIST = "PACKING LIST\n====\nShipper: APRIL FAR EAST (M) SDN BHD\n"


def make_reader(si_text, bl_text):
    def read(path):
        return (si_text if path.endswith("_SI.txt") else bl_text).encode("utf-8")
    return read


def email(attachments=("attachments/e_SI.txt", "attachments/e_BL.txt")):
    return {"email_id": "email_x", "from": "a@b.c", "subject": "check docs",
            "body": "please check", "attachments": list(attachments)}


def run_one(si, bl, attachments=("attachments/e_SI.txt", "attachments/e_BL.txt")):
    return process_email(email(attachments), Settings(),
                         classifier=lambda e: "BL_COMPARISON",
                         read_bytes=make_reader(si, bl))


def test_matching_documents_are_ok():
    r = run_one(SI, BL_MATCHING)
    assert r.status == "OK"
    assert r.defect_fields == []


def test_consignee_mismatch_is_flagged():
    r = run_one(SI, BL_WRONG_CONSIGNEE)
    assert r.status == "MISMATCH"
    assert "consignee" in r.defect_fields


def test_container_count_mismatch_is_flagged():
    r = run_one(SI, BL_WRONG_COUNT)
    assert r.status == "MISMATCH"
    assert r.defect_fields == ["container_count"]


def test_missing_attachment_is_needs_review():
    r = run_one(SI, BL_MATCHING, attachments=("attachments/e_SI.txt",))
    assert r.status == "NEEDS_REVIEW"
    assert r.review_reason == "missing_attachment"


def test_packing_list_instead_of_bl_is_wrong_doc_type():
    r = run_one(SI, BL_PACKING_LIST)
    assert r.status == "NEEDS_REVIEW"
    assert r.review_reason == "wrong_doc_type"


def test_non_comparison_email_short_circuits():
    r = process_email(email(()), Settings(), classifier=lambda e: "SPAM",
                      read_bytes=lambda p: b"")
    assert r.category == "SPAM"
    assert r.to_submission_entry()["has_defect"] is False
    assert r.to_submission_entry()["status"] == "OK"
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pytest tests/test_pipeline.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'sdoc.pipeline'`

- [ ] **Step 3: Implement the pipeline**

`src/sdoc/pipeline.py`:
```python
"""Orchestration: classify -> ingest -> gate -> extract -> compare -> roll up."""
from sdoc.compare.ladder import compare_field
from sdoc.compare.rollup import rollup
from sdoc.config import Settings
from sdoc.doctype import assign_roles
from sdoc.docs.ingest import ingest
from sdoc.extract.engine import extract_all_fields, snippet_for
from sdoc.gates import post_extraction_gate, pre_extraction_gate
from sdoc.inbox import load_emails
from sdoc.inbox import read_bytes as default_read_bytes
from sdoc.models import FIELDS, EmailResult


def process_email(
    email: dict,
    settings: Settings,
    classifier,
    adjudicator=None,
    alias: dict | None = None,
    read_bytes=None,
    extract_fallback=None,
) -> EmailResult:
    eid = email["email_id"]
    result = EmailResult(email_id=eid, category=classifier(email))

    if result.category != "BL_COMPARISON":
        return result

    reader = read_bytes or (lambda p: default_read_bytes(settings.data_dir, p))
    docs = []
    for path in email.get("attachments", []):
        try:
            docs.append(ingest(path, reader(path)))
        except Exception as exc:
            result.notes.append(f"read failed for {path}: {type(exc).__name__}")

    gate_reason = pre_extraction_gate(docs)
    if gate_reason:
        result.status = "NEEDS_REVIEW"
        result.review_reason = gate_reason
        return result

    si_doc, bl_doc = assign_roles(docs)
    si_fields = extract_all_fields(si_doc)
    bl_fields = extract_all_fields(bl_doc)

    if extract_fallback is not None:
        si_fields = extract_fallback(si_doc, si_fields)
        bl_fields = extract_fallback(bl_doc, bl_fields)

    if si_fields.get("_conflict") or bl_fields.get("_conflict"):
        result.status = "NEEDS_REVIEW"
        result.review_reason = "missing_value"
        result.notes.append("summary and container table disagree")
        return result

    post_reason = post_extraction_gate(si_fields, bl_fields, FIELDS)

    result.verdicts = [
        compare_field(
            name,
            si_fields.get(name),
            bl_fields.get(name),
            alias=alias,
            adjudicator=adjudicator,
            uncertain_lean_same=settings.uncertain_lean_same,
            si_snippet=snippet_for(si_doc, name),
            bl_snippet=snippet_for(bl_doc, name),
        )
        for name in FIELDS
    ]

    status, reason, defects = rollup(result.verdicts, post_reason)
    result.status = status
    result.review_reason = reason
    result.defect_fields = defects
    return result


def run(settings: Settings, classifier, adjudicator=None, alias=None,
        extract_fallback=None) -> list[EmailResult]:
    return [
        process_email(e, settings, classifier, adjudicator, alias,
                      extract_fallback=extract_fallback)
        for e in load_emails(settings.data_dir)
    ]
```

- [ ] **Step 4: Implement the trace log**

`src/sdoc/trace.py`:
```python
"""Per-email evidence. Without this you cannot tell why a score moved."""
import json
from dataclasses import asdict
from pathlib import Path


def write_traces(results, path: str = "traces.json") -> None:
    payload = {
        r.email_id: {
            "category": r.category,
            "status": r.status,
            "review_reason": r.review_reason,
            "defect_fields": r.defect_fields,
            "verdicts": [asdict(v) for v in r.verdicts],
            "notes": r.notes,
        }
        for r in results
    }
    Path(path).write_text(json.dumps(payload, indent=2), encoding="utf-8")


def layer_counts(results) -> dict[str, int]:
    """How many field decisions each layer made — used to show the alias table
    reducing L4 calls between snapshots."""
    counts: dict[str, int] = {}
    for r in results:
        for v in r.verdicts:
            counts[v.decided_by] = counts.get(v.decided_by, 0) + 1
    return counts
```

- [ ] **Step 5: Add the runner with a placeholder classifier**

`scripts/run.py`:
```python
"""Run the pipeline and optionally score it.

    python scripts/run.py                         # build submission.json only
    python scripts/run.py http://localhost:8080   # build and score
"""
import sys

from sdoc.config import SETTINGS
from sdoc.pipeline import run
from sdoc.submit import build_submission, post_submission, write_submission
from sdoc.trace import layer_counts, write_traces


def heuristic_classifier(email: dict) -> str:
    """Placeholder until Task 12 replaces this with Gemini."""
    return "BL_COMPARISON" if email.get("attachments") else "GENERAL"


results = run(SETTINGS, heuristic_classifier)
submission = build_submission(results)
write_submission(submission)
write_traces(results)

counts: dict[str, int] = {}
for r in results:
    counts[r.status] = counts.get(r.status, 0) + 1
print(f"{len(submission)} entries; statuses={counts}; layers={layer_counts(results)}")

if len(sys.argv) > 1:
    print(post_submission(submission, sys.argv[1]))
```

- [ ] **Step 6: Run the tests, then the real pipeline**

Run: `pytest tests/test_pipeline.py -v`
Expected: PASS — 6 passed.

Run: `python scripts/run.py http://localhost:8080`
Expected: `520 entries`, a status breakdown, and a `final_score` **above the Task 1 baseline**.

- [ ] **Step 7: Start the score log**

`docs/scores.md`:
```markdown
# Scoreboard log

Every row is one submission. Record what changed, so a score movement is
attributable to a specific decision.

| # | Change | final_score | Stage-1 F1 | Stage-3 F1 | Notes |
|---|---|---|---|---|---|
| 1 | baseline, everything GENERAL | | | | proves the submit loop |
| 2 | deterministic pipeline, heuristic classifier | | | | |
```

- [ ] **Step 8: Commit**

```bash
git rm scripts/baseline.py
git add src/sdoc/pipeline.py src/sdoc/trace.py scripts/run.py tests/test_pipeline.py docs/scores.md
git commit -m "feat: wire the deterministic pipeline and record a real score"
```

---

## Task 11: Gemini client with content-hash caching

Caching is what makes scoreboard iteration cheap. Build it before any model call exists.

**Files:**
- Create: `src/sdoc/gemini.py`
- Test: `tests/test_gemini.py`

**Interfaces:**
- Produces:
  - `sdoc.gemini.cache_key(prompt: str, model: str) -> str`
  - `sdoc.gemini.GeminiClient(model="gemini-2.0-flash", cache_dir=".cache", api_key=None)` with `.generate_json(prompt: str, *, default: dict | list) -> dict | list`
  - The client tolerates fenced JSON, retries twice on transport errors, and returns `default` rather than raising.

- [ ] **Step 1: Write the failing tests**

`tests/test_gemini.py`:
```python
import json

from sdoc.gemini import GeminiClient, cache_key, parse_json_response


def test_cache_key_is_stable_and_prompt_sensitive():
    a = cache_key("hello", "gemini-2.0-flash")
    assert a == cache_key("hello", "gemini-2.0-flash")
    assert a != cache_key("hello!", "gemini-2.0-flash")
    assert a != cache_key("hello", "other-model")


def test_parse_json_handles_fenced_output():
    assert parse_json_response('```json\n{"verdict": "SAME"}\n```') == {"verdict": "SAME"}


def test_parse_json_handles_bare_output():
    assert parse_json_response('{"verdict": "DIFFERENT"}') == {"verdict": "DIFFERENT"}


def test_parse_json_returns_none_on_garbage():
    assert parse_json_response("I think they are the same.") is None


def test_client_reads_from_cache_without_calling_the_model(tmp_path):
    client = GeminiClient(cache_dir=str(tmp_path), api_key="unused")
    key = cache_key("PROMPT", client.model)
    (tmp_path / f"{key}.json").write_text(json.dumps({"verdict": "SAME"}),
                                          encoding="utf-8")

    def explode(prompt):
        raise AssertionError("model must not be called when cached")

    client._call = explode
    assert client.generate_json("PROMPT", default={}) == {"verdict": "SAME"}


def test_client_writes_to_cache_after_a_call(tmp_path):
    client = GeminiClient(cache_dir=str(tmp_path), api_key="unused")
    client._call = lambda prompt: '{"verdict": "DIFFERENT"}'
    assert client.generate_json("P", default={}) == {"verdict": "DIFFERENT"}

    client._call = lambda prompt: (_ for _ in ()).throw(AssertionError("cached"))
    assert client.generate_json("P", default={}) == {"verdict": "DIFFERENT"}


def test_client_returns_default_when_the_model_fails(tmp_path):
    client = GeminiClient(cache_dir=str(tmp_path), api_key="unused", retries=1)
    client._call = lambda prompt: (_ for _ in ()).throw(RuntimeError("boom"))
    assert client.generate_json("P", default={"verdict": "UNCERTAIN"}) == {
        "verdict": "UNCERTAIN"}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_gemini.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'sdoc.gemini'`

- [ ] **Step 3: Implement the client**

`src/sdoc/gemini.py`:
```python
"""Gemini access with a content-hash disk cache.

The cache is what makes scoreboard iteration cheap: a full re-run after a
comparison-logic change costs no model calls at all.
"""
import hashlib
import json
import os
import re
from pathlib import Path

_FENCE = re.compile(r"```(?:json)?\s*(.*?)```", re.S)

DEFAULT_MODEL = "gemini-2.0-flash"


def cache_key(prompt: str, model: str) -> str:
    return hashlib.sha256(f"{model}\x00{prompt}".encode("utf-8")).hexdigest()[:32]


def parse_json_response(text: str):
    """Pull JSON out of a model response, fenced or bare. None if absent."""
    if not text:
        return None
    candidates = []
    fenced = _FENCE.search(text)
    if fenced:
        candidates.append(fenced.group(1))
    candidates.append(text)
    for chunk in candidates:
        chunk = chunk.strip()
        start = min((i for i in (chunk.find("{"), chunk.find("[")) if i != -1),
                    default=-1)
        if start == -1:
            continue
        end = max(chunk.rfind("}"), chunk.rfind("]"))
        if end <= start:
            continue
        try:
            return json.loads(chunk[start:end + 1])
        except json.JSONDecodeError:
            continue
    return None


class GeminiClient:
    def __init__(self, model: str = DEFAULT_MODEL, cache_dir: str = ".cache",
                 api_key: str | None = None, retries: int = 2):
        self.model = model
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.api_key = api_key or os.environ.get("GEMINI_API_KEY", "")
        self.retries = retries
        self._client = None
        self.calls = 0

    def _ensure_client(self):
        if self._client is None:
            from google import genai
            self._client = genai.Client(api_key=self.api_key)
        return self._client

    def _call(self, prompt: str) -> str:
        client = self._ensure_client()
        response = client.models.generate_content(model=self.model, contents=prompt)
        return response.text

    def generate_json(self, prompt: str, *, default):
        path = self.cache_dir / f"{cache_key(prompt, self.model)}.json"
        if path.exists():
            try:
                return json.loads(path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                pass

        for _ in range(max(1, self.retries)):
            try:
                self.calls += 1
                parsed = parse_json_response(self._call(prompt))
            except Exception:
                continue
            if parsed is not None:
                path.write_text(json.dumps(parsed), encoding="utf-8")
                return parsed
        return default
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_gemini.py -v`
Expected: PASS — 7 passed.

- [ ] **Step 5: Commit**

```bash
git add src/sdoc/gemini.py tests/test_gemini.py
git commit -m "feat: Gemini client with content-hash disk cache"
```

---

## Task 12: Gemini classification

The 30% macro-F1 axis. Emails are batched to keep the call count at roughly 26 rather than 520, and every batch is cached.

Misleading subjects are the reason this is a model job: `TO CONFIRM DOCS …` appears both on genuine comparison requests and on attachment-less general chatter, and `Draft BL … amend BL 050` is an operational update, not a comparison request.

**Files:**
- Create: `src/sdoc/classify.py`
- Modify: `scripts/run.py`
- Test: `tests/test_classify.py`

**Interfaces:**
- Consumes: `sdoc.gemini.GeminiClient`
- Produces:
  - `sdoc.classify.build_prompt(batch: list[dict]) -> str`
  - `sdoc.classify.classify_all(emails: list[dict], client, batch_size=20, settings=None) -> dict[str, str]`
  - `sdoc.classify.make_classifier(mapping: dict[str, str])` returning a callable suitable for `pipeline.run`

- [ ] **Step 1: Write the failing tests**

`tests/test_classify.py`:
```python
from sdoc.classify import build_prompt, classify_all, make_classifier
from sdoc.config import Settings


class FakeClient:
    """Returns whatever the test queues, recording the prompts it saw."""

    def __init__(self, replies):
        self.replies = list(replies)
        self.prompts = []

    def generate_json(self, prompt, *, default):
        self.prompts.append(prompt)
        return self.replies.pop(0) if self.replies else default


def emails(n, with_attachments=()):
    out = []
    for i in range(1, n + 1):
        eid = f"email_{i:03d}"
        out.append({"email_id": eid, "from": "a@b.c", "subject": f"s{i}",
                    "body": "b", "attachments": ["x_SI.txt"] if eid in with_attachments else []})
    return out


def test_prompt_lists_every_category_and_every_email():
    prompt = build_prompt(emails(3))
    for category in ("BL_COMPARISON", "SI_REQUEST", "INVOICE_QUERY", "GENERAL", "SPAM"):
        assert category in prompt
    for eid in ("email_001", "email_002", "email_003"):
        assert eid in prompt


def test_prompt_states_attachment_presence():
    prompt = build_prompt(emails(2, with_attachments={"email_001"}))
    assert "attachments: 1" in prompt
    assert "attachments: 0" in prompt


def test_classify_all_batches_and_merges():
    client = FakeClient([
        {"email_001": "SPAM", "email_002": "GENERAL"},
        {"email_003": "BL_COMPARISON"},
    ])
    got = classify_all(emails(3), client, batch_size=2)
    assert got == {"email_001": "SPAM", "email_002": "GENERAL",
                   "email_003": "BL_COMPARISON"}
    assert len(client.prompts) == 2


def test_unknown_category_falls_back_to_general():
    client = FakeClient([{"email_001": "NONSENSE"}])
    assert classify_all(emails(1), client, batch_size=20) == {"email_001": "GENERAL"}


def test_missing_email_in_the_reply_falls_back_to_general():
    client = FakeClient([{}])
    assert classify_all(emails(2), client, batch_size=20) == {
        "email_001": "GENERAL", "email_002": "GENERAL"}


def test_attachmentless_comparison_is_downgraded_by_default():
    """The switch is off by default: no attachments means it is not a
    comparison request."""
    client = FakeClient([{"email_001": "BL_COMPARISON"}])
    got = classify_all(emails(1), client, batch_size=20, settings=Settings())
    assert got["email_001"] == "GENERAL"


def test_attachmentless_comparison_is_kept_when_the_switch_is_on():
    client = FakeClient([{"email_001": "BL_COMPARISON"}])
    settings = Settings(attachmentless_is_comparison=True)
    got = classify_all(emails(1), client, batch_size=20, settings=settings)
    assert got["email_001"] == "BL_COMPARISON"


def test_make_classifier_returns_a_lookup_callable():
    classifier = make_classifier({"email_001": "SPAM"})
    assert classifier({"email_id": "email_001"}) == "SPAM"
    assert classifier({"email_id": "email_999"}) == "GENERAL"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_classify.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'sdoc.classify'`

- [ ] **Step 3: Implement classification**

`src/sdoc/classify.py`:
```python
"""Stage 1 — sort the inbox into five categories.

This is a model job rather than a keyword job because the subjects mislead:
"TO CONFIRM DOCS ..." appears on genuine comparison requests and on
attachment-less chatter alike.
"""
import json

from sdoc.config import Settings
from sdoc.models import CATEGORIES

_INSTRUCTIONS = """You are triaging a shipping operations team's inbox.

Classify each email into exactly one category:

BL_COMPARISON - asks someone to check, verify, confirm or compare a draft Bill
  of Lading against a Shipping Instruction. Normally carries both documents.
SI_REQUEST    - asks for a NEW Shipping Instruction to be created, submitted or
  sent. Nothing is being checked.
INVOICE_QUERY - about billing, charges, invoices, debit or credit notes,
  detention or demurrage.
GENERAL       - operational updates, schedules, summaries, amendments, status
  reports, and anything else legitimate.
SPAM          - unsolicited marketing, phishing, account warnings.

Judge the request the sender is actually making. Subjects are often misleading
and reused across categories; the body and the attachments matter more.
An email that merely mentions a BL is not a comparison request unless it asks
for the documents to be checked against each other.

Return ONLY a JSON object mapping every email_id to its category, e.g.
{"email_001": "SPAM", "email_002": "BL_COMPARISON"}
"""


def build_prompt(batch: list[dict]) -> str:
    parts = [_INSTRUCTIONS, "", f"Categories: {', '.join(CATEGORIES)}", "", "Emails:"]
    for email in batch:
        attachments = email.get("attachments") or []
        names = ", ".join(a.rsplit("/", 1)[-1] for a in attachments) or "none"
        body = (email.get("body") or "")[:600].replace("\n", " ")
        parts.append(
            f"---\nemail_id: {email['email_id']}\n"
            f"from: {email.get('from', '')}\n"
            f"subject: {email.get('subject', '')}\n"
            f"attachments: {len(attachments)} ({names})\n"
            f"body: {body}"
        )
    return "\n".join(parts)


def classify_all(emails: list[dict], client, batch_size: int = 20,
                 settings: Settings | None = None) -> dict[str, str]:
    settings = settings or Settings()
    out: dict[str, str] = {}

    for start in range(0, len(emails), batch_size):
        batch = emails[start:start + batch_size]
        reply = client.generate_json(build_prompt(batch), default={})
        if not isinstance(reply, dict):
            reply = {}
        for email in batch:
            eid = email["email_id"]
            category = reply.get(eid, "GENERAL")
            if category not in CATEGORIES:
                category = "GENERAL"
            if (category == "BL_COMPARISON"
                    and not email.get("attachments")
                    and not settings.attachmentless_is_comparison):
                category = "GENERAL"
            out[eid] = category
    return out


def make_classifier(mapping: dict[str, str]):
    def classifier(email: dict) -> str:
        return mapping.get(email["email_id"], "GENERAL")
    return classifier
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_classify.py -v`
Expected: PASS — 8 passed.

- [ ] **Step 5: Use it in the runner**

Replace the classifier section of `scripts/run.py`:
```python
"""Run the pipeline and optionally score it.

    set GEMINI_API_KEY=...
    python scripts/run.py                         # build submission.json only
    python scripts/run.py http://localhost:8080   # build and score
"""
import sys

from sdoc.classify import classify_all, make_classifier
from sdoc.config import SETTINGS
from sdoc.gemini import GeminiClient
from sdoc.inbox import load_emails
from sdoc.pipeline import run
from sdoc.submit import build_submission, post_submission, write_submission
from sdoc.trace import layer_counts, write_traces

client = GeminiClient()
emails = load_emails(SETTINGS.data_dir)

mapping = classify_all(emails, client, settings=SETTINGS)
classifier = make_classifier(mapping)

results = run(SETTINGS, classifier)
submission = build_submission(results)
write_submission(submission)
write_traces(results)

statuses: dict[str, int] = {}
categories: dict[str, int] = {}
for r in results:
    statuses[r.status] = statuses.get(r.status, 0) + 1
    categories[r.category] = categories.get(r.category, 0) + 1

print(f"{len(submission)} entries")
print(f"categories={categories}")
print(f"statuses={statuses}")
print(f"layers={layer_counts(results)} gemini_calls={client.calls}")

if len(sys.argv) > 1:
    print(post_submission(submission, sys.argv[1]))
```

- [ ] **Step 6: Run the real classification and score it**

```bash
set GEMINI_API_KEY=<your key>
python scripts/run.py http://localhost:8080
```
Expected: roughly 26 Gemini calls on the first run, **0 on an immediate second run** (cache hit), and a materially higher Stage-1 F1 than Task 10. Add a row to `docs/scores.md`.

Sanity check the category spread against what the data can support: at most ~126 emails have attachments, so `BL_COMPARISON` far above that number means the classifier is over-triggering.

- [ ] **Step 7: Commit**

```bash
git add src/sdoc/classify.py scripts/run.py tests/test_classify.py docs/scores.md
git commit -m "feat: Gemini batch classification for the Stage-1 axis"
```

---

## Task 13: Gemini fallback extraction and the L4 adjudicator

Both model jobs that remain. The fallback closes the extraction gaps that Task 7's coverage test printed; the adjudicator resolves only the narrow gray band.

**Files:**
- Create: `src/sdoc/extract/llm.py`, `src/sdoc/compare/adjudicate.py`
- Modify: `scripts/run.py`
- Test: `tests/extract/test_llm.py`, `tests/compare/test_adjudicate.py`

**Interfaces:**
- Consumes: `sdoc.gemini.GeminiClient`, `sdoc.models.FIELDS`
- Produces:
  - `sdoc.extract.llm.make_fallback(client)` returning `fallback(doc: DocText, fields: dict) -> dict`
  - `sdoc.compare.adjudicate.make_adjudicator(client)` returning a callable matching the ladder's adjudicator signature

- [ ] **Step 1: Write the failing tests**

`tests/extract/test_llm.py`:
```python
from sdoc.extract.llm import make_fallback
from sdoc.models import DocText

DOC = DocText(path="a_SI.txt", fmt="txt",
              lines=["SHIPPING INSTRUCTION", "Shipper: ACME PTE LTD"])


class FakeClient:
    def __init__(self, reply):
        self.reply = reply
        self.prompts = []

    def generate_json(self, prompt, *, default):
        self.prompts.append(prompt)
        return self.reply


def test_fallback_is_skipped_when_nothing_is_missing():
    client = FakeClient({})
    fallback = make_fallback(client)
    complete = {name: "x" for name in
                ("shipper", "consignee", "notify_party", "port_of_loading",
                 "port_of_discharge")}
    complete.update({"container_count": 1, "gross_weight_kg": 2})
    fallback(DOC, complete)
    assert client.prompts == []


def test_fallback_fills_only_the_missing_fields():
    client = FakeClient({"consignee": "ROXCEL TRADING GMBH"})
    fallback = make_fallback(client)
    got = fallback(DOC, {"shipper": "ACME PTE LTD", "consignee": None})
    assert got["shipper"] == "ACME PTE LTD"
    assert got["consignee"] == "ROXCEL TRADING GMBH"


def test_fallback_asks_only_about_missing_fields():
    client = FakeClient({})
    fallback = make_fallback(client)
    fallback(DOC, {"shipper": "ACME PTE LTD", "consignee": None})
    prompt = client.prompts[0]
    assert "consignee" in prompt
    assert "shipper" not in prompt.split("Fields to find:")[1]


def test_fallback_coerces_numeric_fields_to_int():
    client = FakeClient({"container_count": "6 x 40'HC",
                         "gross_weight_kg": "131,322 KG"})
    fallback = make_fallback(client)
    got = fallback(DOC, {"container_count": None, "gross_weight_kg": None})
    assert got["container_count"] == 6
    assert got["gross_weight_kg"] == 131322


def test_fallback_leaves_a_field_missing_when_the_model_returns_nothing():
    client = FakeClient({"consignee": ""})
    fallback = make_fallback(client)
    got = fallback(DOC, {"consignee": None})
    assert not got["consignee"]
```

`tests/compare/test_adjudicate.py`:
```python
from sdoc.compare.adjudicate import make_adjudicator


class FakeClient:
    def __init__(self, reply):
        self.reply = reply
        self.prompts = []

    def generate_json(self, prompt, *, default):
        self.prompts.append(prompt)
        return self.reply if self.reply is not None else default


def test_adjudicator_returns_the_model_verdict():
    adjudicator = make_adjudicator(FakeClient({"verdict": "SAME", "reason": "abbrev"}))
    got = adjudicator(field_name="shipper", si_value="A", bl_value="B",
                      si_snippet="s", bl_snippet="t")
    assert got["verdict"] == "SAME"
    assert got["reason"] == "abbrev"


def test_prompt_carries_both_values_and_both_snippets():
    client = FakeClient({"verdict": "DIFFERENT"})
    adjudicator = make_adjudicator(client)
    adjudicator(field_name="consignee", si_value="EAST BRIGHT",
                bl_value="UAB NOVAKOPA", si_snippet="SI CTX", bl_snippet="BL CTX")
    prompt = client.prompts[0]
    for token in ("consignee", "EAST BRIGHT", "UAB NOVAKOPA", "SI CTX", "BL CTX"):
        assert token in prompt


def test_unknown_verdict_becomes_uncertain():
    adjudicator = make_adjudicator(FakeClient({"verdict": "MAYBE"}))
    got = adjudicator(field_name="shipper", si_value="A", bl_value="B",
                      si_snippet="", bl_snippet="")
    assert got["verdict"] == "UNCERTAIN"


def test_client_failure_becomes_uncertain():
    adjudicator = make_adjudicator(FakeClient(None))
    got = adjudicator(field_name="shipper", si_value="A", bl_value="B",
                      si_snippet="", bl_snippet="")
    assert got["verdict"] == "UNCERTAIN"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/extract/test_llm.py tests/compare/test_adjudicate.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'sdoc.extract.llm'`

- [ ] **Step 3: Implement the fallback extractor**

`src/sdoc/extract/llm.py`:
```python
"""Gemini fallback extraction — only for fields the deterministic parser missed."""
from sdoc.extract.numeric import parse_container_count, parse_weight_kg
from sdoc.models import FIELDS

NUMERIC = ("container_count", "gross_weight_kg")

_INSTRUCTIONS = """Extract the requested fields from this shipping document.

Return ONLY a JSON object mapping each requested field name to the value exactly
as it appears in the document. Use an empty string when a field is genuinely
absent. Do not infer, calculate, or invent values.

For parties, include the company name and its address if one is given.
For ports, give the port as written.
For container_count, give the number of containers.
For gross_weight_kg, give the total gross weight.
"""


def make_fallback(client):
    def fallback(doc, fields: dict) -> dict:
        missing = [f for f in FIELDS if not fields.get(f)]
        if not missing:
            return fields

        prompt = (
            f"{_INSTRUCTIONS}\n"
            f"Fields to find: {', '.join(missing)}\n\n"
            f"Document:\n{doc.text[:6000]}"
        )
        reply = client.generate_json(prompt, default={})
        if not isinstance(reply, dict):
            return fields

        out = dict(fields)
        for name in missing:
            raw = reply.get(name)
            if raw in (None, ""):
                continue
            text = str(raw).strip()
            if name == "container_count":
                out[name] = parse_container_count(text)
            elif name == "gross_weight_kg":
                out[name] = parse_weight_kg(text)
            else:
                out[name] = text
        return out

    return fallback
```

- [ ] **Step 4: Implement the adjudicator**

`src/sdoc/compare/adjudicate.py`:
```python
"""L4 — classify a relationship in the gray band. Never produces a value."""
_TEMPLATE = """These two values were extracted from the {field} field of a
Shipping Instruction and a draft Bill of Lading for the same shipment.

SI value:   "{si_value}"
SI context: "{si_snippet}"
BL value:   "{bl_value}"
BL context: "{bl_snippet}"

Do these refer to the same real-world entity?

SAME      - same entity, differing only in formatting, abbreviation, code vs
            name, address detail, or legal-suffix style
DIFFERENT - genuinely different entities
UNCERTAIN - you cannot tell from the evidence given

Return {{"verdict": ..., "reason": "<one sentence>"}}
Answer UNCERTAIN only if the two values give you no basis at all to decide.
If one reading is even slightly better supported, choose it."""

VERDICTS = ("SAME", "DIFFERENT", "UNCERTAIN")


def make_adjudicator(client):
    def adjudicate(*, field_name, si_value, bl_value, si_snippet="",
                   bl_snippet="", similarity=0.0):
        # `similarity` is accepted so the ladder can pass it through to the
        # alias-promotion guard; it plays no part in the prompt.
        prompt = _TEMPLATE.format(
            field=field_name, si_value=si_value, bl_value=bl_value,
            si_snippet=si_snippet, bl_snippet=bl_snippet,
        )
        reply = client.generate_json(prompt, default={"verdict": "UNCERTAIN"})
        if not isinstance(reply, dict):
            return {"verdict": "UNCERTAIN", "reason": ""}
        verdict = str(reply.get("verdict", "UNCERTAIN")).upper()
        if verdict not in VERDICTS:
            verdict = "UNCERTAIN"
        return {"verdict": verdict, "reason": reply.get("reason", "")}

    return adjudicate
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/extract/test_llm.py tests/compare/test_adjudicate.py -v`
Expected: PASS — 9 passed.

- [ ] **Step 6: Wire both into the runner**

In `scripts/run.py`, replace the `results = run(SETTINGS, classifier)` line with:
```python
from sdoc.compare.adjudicate import make_adjudicator
from sdoc.extract.llm import make_fallback

results = run(
    SETTINGS,
    classifier,
    adjudicator=make_adjudicator(client),
    extract_fallback=make_fallback(client) if SETTINGS.use_llm_fallback else None,
)
```

- [ ] **Step 7: Run and score**

Run: `python scripts/run.py http://localhost:8080`
Expected: higher end-to-end and Stage-3 scores than Task 12; `layers=` now shows a small `L4` count. Add a row to `docs/scores.md`.

- [ ] **Step 8: Commit**

```bash
git add src/sdoc/extract/llm.py src/sdoc/compare/adjudicate.py scripts/run.py tests docs/scores.md
git commit -m "feat: Gemini fallback extraction and gray-band adjudicator"
```

---

## Task 14: Alias table with promotion and snapshot pinning

The self-improving loop. Scored runs pin a read-only snapshot; promotions collect in a pending queue and are applied by an explicit step, so A/B tests stay reproducible while the table still learns.

**Files:**
- Create: `src/sdoc/compare/alias.py`, `scripts/aliases.py`
- Modify: `scripts/run.py`
- Test: `tests/compare/test_alias.py`

**Interfaces:**
- Consumes: `sdoc.compare.canon.canon_party`, `sdoc.compare.similarity.token_set_ratio`
- Produces:
  - `sdoc.compare.alias.AliasStore(root=".aliases")` with `.load(snapshot: str | None) -> dict[str, str]`, `.record_pending(entry: dict)`, `.promote() -> str` (returns the new snapshot id), `.latest() -> str | None`, `.record_human(si_value, bl_value, verdict)`
  - `sdoc.compare.alias.PROMOTION_GUARD = 0.85`

- [ ] **Step 1: Write the failing tests**

`tests/compare/test_alias.py`:
```python
from sdoc.compare.alias import PROMOTION_GUARD, AliasStore


def store(tmp_path):
    return AliasStore(root=str(tmp_path))


def test_a_fresh_store_is_empty(tmp_path):
    assert store(tmp_path).load(None) == {}


def test_l4_same_above_the_guard_is_promoted(tmp_path):
    s = store(tmp_path)
    s.record_pending({"si_value": "ACME GLOBAL TRADING HOLDINGS",
                      "bl_value": "ACME GLOBAL TRADING HOLDING",
                      "verdict": "SAME", "source": "l4", "similarity": 0.90})
    snapshot = s.promote()
    table = s.load(snapshot)
    assert table["ACME GLOBAL TRADING HOLDINGS"] == table["ACME GLOBAL TRADING HOLDING"]


def test_l4_same_below_the_guard_is_not_promoted(tmp_path):
    s = store(tmp_path)
    s.record_pending({"si_value": "ACME", "bl_value": "GLOBEX",
                      "verdict": "SAME", "source": "l4",
                      "similarity": PROMOTION_GUARD - 0.01})
    assert s.load(s.promote()) == {}


def test_different_verdicts_are_never_promoted(tmp_path):
    s = store(tmp_path)
    s.record_pending({"si_value": "ACME", "bl_value": "GLOBEX",
                      "verdict": "DIFFERENT", "source": "l4", "similarity": 0.95})
    assert s.load(s.promote()) == {}


def test_a_human_same_is_promoted_regardless_of_similarity(tmp_path):
    s = store(tmp_path)
    s.record_human("EAST BRIGHT", "EB TRADING", "SAME")
    assert s.load(s.promote()) != {}


def test_a_human_different_blocks_future_promotion(tmp_path):
    s = store(tmp_path)
    s.record_human("ACME GLOBAL TRADING", "ACME GLOBAL TRADE", "DIFFERENT")
    s.promote()
    s.record_pending({"si_value": "ACME GLOBAL TRADING",
                      "bl_value": "ACME GLOBAL TRADE",
                      "verdict": "SAME", "source": "l4", "similarity": 0.95})
    assert s.load(s.promote()) == {}


def test_a_human_different_removes_an_existing_link(tmp_path):
    s = store(tmp_path)
    s.record_pending({"si_value": "ACME GLOBAL TRADING",
                      "bl_value": "ACME GLOBAL TRADE",
                      "verdict": "SAME", "source": "l4", "similarity": 0.95})
    first = s.promote()
    assert s.load(first) != {}

    s.record_human("ACME GLOBAL TRADING", "ACME GLOBAL TRADE", "DIFFERENT")
    assert s.load(s.promote()) == {}


def test_snapshots_are_immutable_once_written(tmp_path):
    s = store(tmp_path)
    s.record_pending({"si_value": "A CORP", "bl_value": "A CORPORATION",
                      "verdict": "SAME", "source": "human", "similarity": 1.0})
    first = s.promote()
    first_table = s.load(first)

    s.record_pending({"si_value": "B CORP", "bl_value": "B CORPORATION",
                      "verdict": "SAME", "source": "human", "similarity": 1.0})
    second = s.promote()

    assert s.load(first) == first_table
    assert len(s.load(second)) > len(first_table)


def test_latest_returns_the_newest_snapshot(tmp_path):
    s = store(tmp_path)
    s.record_pending({"si_value": "A CORP", "bl_value": "A CORPORATION",
                      "verdict": "SAME", "source": "human", "similarity": 1.0})
    first = s.promote()
    s.record_pending({"si_value": "B CORP", "bl_value": "B CORPORATION",
                      "verdict": "SAME", "source": "human", "similarity": 1.0})
    second = s.promote()
    assert s.latest() == second
    assert first != second
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/compare/test_alias.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'sdoc.compare.alias'`

- [ ] **Step 3: Implement the alias store**

`src/sdoc/compare/alias.py`:
```python
"""L2 alias table: learns, but only between runs.

A growing table makes runs stateful, which would destroy the attributable
score deltas the scoreboard log depends on. So a scored run pins a read-only
snapshot and writes promotions to a pending queue; `promote()` folds the queue
into a new numbered snapshot.

Human decisions outrank model decisions: a human DIFFERENT removes any existing
link and permanently blocks that pair from being promoted again.
"""
import json
from pathlib import Path

from sdoc.compare.canon import canon_party

PROMOTION_GUARD = 0.85


def _pair_key(a: str, b: str) -> str:
    return "||".join(sorted([a, b]))


class AliasStore:
    def __init__(self, root: str = ".aliases"):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.pending_path = self.root / "pending.jsonl"
        self.blocked_path = self.root / "blocked.json"

    # -- writing -------------------------------------------------------
    def record_pending(self, entry: dict) -> None:
        with self.pending_path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry) + "\n")

    def record_human(self, si_value: str, bl_value: str, verdict: str) -> None:
        self.record_pending({
            "si_value": si_value, "bl_value": bl_value,
            "verdict": verdict, "source": "human", "similarity": 1.0,
        })

    # -- reading -------------------------------------------------------
    def _snapshots(self) -> list[Path]:
        return sorted(self.root.glob("snapshot_*.json"))

    def latest(self) -> str | None:
        snaps = self._snapshots()
        return snaps[-1].stem.split("_", 1)[1] if snaps else None

    def load(self, snapshot: str | None) -> dict[str, str]:
        if snapshot is None:
            snapshot = self.latest()
        if snapshot is None:
            return {}
        path = self.root / f"snapshot_{snapshot}.json"
        if not path.exists():
            return {}
        return json.loads(path.read_text(encoding="utf-8"))

    def _blocked(self) -> set[str]:
        if not self.blocked_path.exists():
            return set()
        return set(json.loads(self.blocked_path.read_text(encoding="utf-8")))

    # -- promotion -----------------------------------------------------
    def promote(self) -> str:
        """Fold the pending queue into a new snapshot. Returns its id."""
        table = dict(self.load(None))
        blocked = self._blocked()

        entries = []
        if self.pending_path.exists():
            for line in self.pending_path.read_text(encoding="utf-8").splitlines():
                if line.strip():
                    entries.append(json.loads(line))

        # Human DIFFERENT first: it removes links and blocks the pair forever.
        for entry in entries:
            if entry.get("source") == "human" and entry.get("verdict") == "DIFFERENT":
                a = canon_party(entry["si_value"])
                b = canon_party(entry["bl_value"])
                blocked.add(_pair_key(a, b))
                for key in (a, b):
                    table.pop(key, None)

        for entry in entries:
            if entry.get("verdict") != "SAME":
                continue
            a = canon_party(entry["si_value"])
            b = canon_party(entry["bl_value"])
            if not a or not b or _pair_key(a, b) in blocked:
                continue
            if entry.get("source") != "human" and \
                    float(entry.get("similarity", 0.0)) < PROMOTION_GUARD:
                continue
            key = table.get(a) or table.get(b) or a
            table[a] = key
            table[b] = key

        snapshot = f"{len(self._snapshots()) + 1:04d}"
        (self.root / f"snapshot_{snapshot}.json").write_text(
            json.dumps(table, indent=2), encoding="utf-8")
        self.blocked_path.write_text(json.dumps(sorted(blocked)), encoding="utf-8")
        self.pending_path.unlink(missing_ok=True)
        return snapshot
```

- [ ] **Step 4: Add the promotion CLI**

`scripts/aliases.py`:
```python
"""Fold pending alias decisions into a new snapshot.

    python scripts/aliases.py promote
    python scripts/aliases.py show
"""
import sys

from sdoc.compare.alias import AliasStore

store = AliasStore()
command = sys.argv[1] if len(sys.argv) > 1 else "show"

if command == "promote":
    snapshot = store.promote()
    print(f"created snapshot {snapshot} with {len(store.load(snapshot))} entries")
else:
    latest = store.latest()
    table = store.load(latest)
    print(f"latest snapshot: {latest}; {len(table)} entries")
    for key, value in list(table.items())[:20]:
        print(f"  {key} -> {value}")
```

- [ ] **Step 5: Feed L4 verdicts into the pending queue from the runner**

In `scripts/run.py`, wrap the adjudicator so its verdicts are recorded, and load the pinned snapshot:
```python
from sdoc.compare.alias import AliasStore

store = AliasStore()
alias_table = store.load(SETTINGS.alias_snapshot)
base_adjudicator = make_adjudicator(client)


def recording_adjudicator(**kwargs):
    result = base_adjudicator(**kwargs)
    store.record_pending({
        "si_value": kwargs["si_value"],
        "bl_value": kwargs["bl_value"],
        "verdict": result["verdict"],
        "source": "l4",
        "similarity": kwargs.get("similarity", 0.0),
        "field": kwargs["field_name"],
    })
    return result


results = run(
    SETTINGS,
    classifier,
    adjudicator=recording_adjudicator,
    alias=alias_table,
    extract_fallback=make_fallback(client) if SETTINGS.use_llm_fallback else None,
)
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pytest tests/compare/test_alias.py -v`
Expected: PASS — 9 passed.

- [ ] **Step 7: Demonstrate the loop reducing L4 calls**

```bash
python scripts/run.py http://localhost:8080     # note layers={... 'L4': N}
python scripts/aliases.py promote               # creates snapshot 0001
python scripts/run.py http://localhost:8080     # L4 count should drop
```
Expected: the second run's `L4` count is lower than the first while the score does not regress. **Record both runs in `docs/scores.md` with their snapshot ids** — this is the demo beat for the video.

- [ ] **Step 8: Commit**

```bash
git add src/sdoc/compare/alias.py scripts/aliases.py scripts/run.py tests/compare/test_alias.py docs/scores.md
git commit -m "feat: alias table with promotion guard and pinned snapshots"
```

---

## Task 15: A/B the two switches and lock the best configuration

**Files:**
- Create: `scripts/ab_test.py`
- Modify: `src/sdoc/config.py`, `docs/scores.md`
- Test: none (this task is measurement, not new behaviour)

**Interfaces:**
- Consumes: `sdoc.config.Settings`, `sdoc.pipeline.run`, `sdoc.submit.post_submission`
- Produces: `scripts/ab_test.py` printing a score per configuration.

- [ ] **Step 1: Write the A/B harness**

`scripts/ab_test.py`:
```python
"""Score every combination of the two tunable switches.

    python scripts/ab_test.py http://localhost:8080

Classification is cached per switch value, so this costs far fewer model calls
than four full runs.
"""
import itertools
import sys
from dataclasses import replace

from sdoc.classify import classify_all, make_classifier
from sdoc.compare.adjudicate import make_adjudicator
from sdoc.compare.alias import AliasStore
from sdoc.config import SETTINGS
from sdoc.extract.llm import make_fallback
from sdoc.gemini import GeminiClient
from sdoc.inbox import load_emails
from sdoc.pipeline import run
from sdoc.submit import build_submission, post_submission

server = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8080"
client = GeminiClient()
emails = load_emails(SETTINGS.data_dir)
alias_table = AliasStore().load(SETTINGS.alias_snapshot)

rows = []
for attachmentless, lean_same in itertools.product([False, True], [True, False]):
    settings = replace(SETTINGS,
                       attachmentless_is_comparison=attachmentless,
                       uncertain_lean_same=lean_same)
    mapping = classify_all(emails, client, settings=settings)
    results = run(settings, make_classifier(mapping),
                  adjudicator=make_adjudicator(client),
                  alias=alias_table,
                  extract_fallback=make_fallback(client))
    score = post_submission(build_submission(results), server)
    rows.append((attachmentless, lean_same, score.get("final_score")))
    print(f"attachmentless={attachmentless} lean_same={lean_same} "
          f"-> {score.get('final_score')}")

print("\nbest:", max(rows, key=lambda r: r[2] or 0))
```

- [ ] **Step 2: Run the A/B sweep**

Run: `python scripts/ab_test.py http://localhost:8080`
Expected: four scored configurations and a printed winner.

- [ ] **Step 3: Set the winning defaults**

Edit `src/sdoc/config.py` so `Settings` defaults match the winning combination, and add a comment recording the measured scores, for example:
```python
    # Measured 2026-09-21: False/True scored 0.xx vs True/True 0.yy.
    attachmentless_is_comparison: bool = False
    uncertain_lean_same: bool = True
```

- [ ] **Step 4: Record every configuration in the score log**

Add one row per configuration to `docs/scores.md`, then a final row for the locked defaults.

- [ ] **Step 5: Run the full test suite**

Run: `pytest -v`
Expected: PASS — every unit test green.

Run: `pytest -v -m integration`
Expected: PASS — every integration test green.

- [ ] **Step 6: Commit**

```bash
git add scripts/ab_test.py src/sdoc/config.py docs/scores.md
git commit -m "feat: A/B both tunable switches and lock the winning defaults"
```

---

## Task 16: Results store and the FastAPI backend

The web app reads a precomputed run rather than re-running the pipeline per request, so the live demo stays fast and costs no model calls while judges click.

**Files:**
- Create: `src/sdoc/results.py`, `web/__init__.py`, `web/app.py`
- Test: `tests/test_web_api.py`

**Interfaces:**
- Consumes: `sdoc.trace`, `sdoc.compare.alias.AliasStore`
- Produces:
  - `sdoc.results.save_run(results, path="run.json") -> None`
  - `sdoc.results.load_run(path="run.json") -> dict`
  - `web.app.create_app(run_path="run.json", store=None) -> FastAPI` exposing:
    - `GET /api/emails` — list with `email_id`, `subject`, `category`, `status`, `attachment_count`
    - `GET /api/emails/{email_id}` — full record including per-field verdicts
    - `GET /api/review-queue` — every `NEEDS_REVIEW` case with its reason
    - `POST /api/review/{email_id}` — body `{"field": str, "verdict": "SAME"|"DIFFERENT"}`, records a human decision
    - `GET /api/stats` — category counts, status counts, layer counts

- [ ] **Step 1: Write the failing tests**

`tests/test_web_api.py`:
```python
import json

import pytest
from fastapi.testclient import TestClient

from sdoc.compare.alias import AliasStore
from web.app import create_app

RUN = {
    "email_001": {"subject": "Spam offer", "category": "SPAM", "status": "OK",
                  "review_reason": None, "defect_fields": [], "attachment_count": 0,
                  "verdicts": [], "notes": []},
    "email_004": {"subject": "Check docs", "category": "BL_COMPARISON",
                  "status": "MISMATCH", "review_reason": None,
                  "defect_fields": ["consignee"], "attachment_count": 2,
                  "verdicts": [
                      {"field_name": "consignee", "si_value": "EAST BRIGHT",
                       "bl_value": "UAB NOVAKOPA", "verdict": "DIFFERENT",
                       "decided_by": "L3", "similarity": 0.1, "reason": ""},
                      {"field_name": "shipper", "si_value": "ACME",
                       "bl_value": "ACME", "verdict": "SAME",
                       "decided_by": "L1", "similarity": None, "reason": ""}],
                  "notes": []},
    "email_507": {"subject": "Confirm docs", "category": "BL_COMPARISON",
                  "status": "NEEDS_REVIEW", "review_reason": "missing_attachment",
                  "defect_fields": [], "attachment_count": 1,
                  "verdicts": [], "notes": []},
}


@pytest.fixture
def client(tmp_path):
    run_path = tmp_path / "run.json"
    run_path.write_text(json.dumps(RUN), encoding="utf-8")
    store = AliasStore(root=str(tmp_path / "aliases"))
    return TestClient(create_app(run_path=str(run_path), store=store)), store


def test_list_emails_returns_every_record(client):
    c, _ = client
    body = c.get("/api/emails").json()
    assert len(body) == 3
    assert {r["email_id"] for r in body} == {"email_001", "email_004", "email_507"}


def test_list_emails_can_filter_by_category(client):
    c, _ = client
    body = c.get("/api/emails", params={"category": "SPAM"}).json()
    assert [r["email_id"] for r in body] == ["email_001"]


def test_email_detail_includes_field_verdicts(client):
    c, _ = client
    body = c.get("/api/emails/email_004").json()
    assert body["status"] == "MISMATCH"
    assert body["defect_fields"] == ["consignee"]
    assert len(body["verdicts"]) == 2


def test_unknown_email_is_404(client):
    c, _ = client
    assert c.get("/api/emails/email_999").status_code == 404


def test_review_queue_lists_only_needs_review(client):
    c, _ = client
    body = c.get("/api/review-queue").json()
    assert [r["email_id"] for r in body] == ["email_507"]
    assert body[0]["review_reason"] == "missing_attachment"


def test_posting_a_review_records_a_human_decision(client):
    c, store = client
    response = c.post("/api/review/email_004",
                      json={"field": "consignee", "verdict": "SAME"})
    assert response.status_code == 200
    assert store.pending_path.exists()
    recorded = store.pending_path.read_text(encoding="utf-8")
    assert '"source": "human"' in recorded
    assert "EAST BRIGHT" in recorded


def test_posting_a_review_for_an_unknown_field_is_400(client):
    c, _ = client
    assert c.post("/api/review/email_004",
                  json={"field": "nonexistent", "verdict": "SAME"}).status_code == 400


def test_stats_summarise_the_run(client):
    c, _ = client
    body = c.get("/api/stats").json()
    assert body["categories"]["BL_COMPARISON"] == 2
    assert body["statuses"]["MISMATCH"] == 1
    assert body["total"] == 3
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_web_api.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'web'`

- [ ] **Step 3: Implement the results store**

`src/sdoc/results.py`:
```python
"""Persist a pipeline run so the web app can serve it without recomputing."""
import json
from dataclasses import asdict
from pathlib import Path


def save_run(results, emails_by_id: dict, path: str = "run.json") -> None:
    payload = {}
    for r in results:
        email = emails_by_id.get(r.email_id, {})
        payload[r.email_id] = {
            "subject": email.get("subject", ""),
            "from": email.get("from", ""),
            "category": r.category,
            "status": r.status,
            "review_reason": r.review_reason,
            "defect_fields": r.defect_fields,
            "attachment_count": len(email.get("attachments") or []),
            "verdicts": [asdict(v) for v in r.verdicts],
            "notes": r.notes,
        }
    Path(path).write_text(json.dumps(payload, indent=2), encoding="utf-8")


def load_run(path: str = "run.json") -> dict:
    p = Path(path)
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}
```

- [ ] **Step 4: Implement the API**

`web/app.py`:
```python
"""FastAPI app serving the four demo screens over a precomputed run."""
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from sdoc.compare.alias import AliasStore
from sdoc.models import FIELDS
from sdoc.results import load_run

WEB_DIR = Path(__file__).parent


class ReviewDecision(BaseModel):
    field: str
    verdict: str


def create_app(run_path: str = "run.json", store: AliasStore | None = None) -> FastAPI:
    app = FastAPI(title="Shipping Document Verification")
    app.state.run_path = run_path
    app.state.store = store or AliasStore()

    def run_data() -> dict:
        return load_run(app.state.run_path)

    @app.get("/api/emails")
    def list_emails(category: str | None = None, status: str | None = None):
        rows = []
        for eid, rec in sorted(run_data().items()):
            if category and rec["category"] != category:
                continue
            if status and rec["status"] != status:
                continue
            rows.append({
                "email_id": eid,
                "subject": rec.get("subject", ""),
                "category": rec["category"],
                "status": rec["status"],
                "review_reason": rec.get("review_reason"),
                "defect_fields": rec.get("defect_fields", []),
                "attachment_count": rec.get("attachment_count", 0),
            })
        return rows

    @app.get("/api/emails/{email_id}")
    def email_detail(email_id: str):
        rec = run_data().get(email_id)
        if rec is None:
            raise HTTPException(status_code=404, detail="unknown email_id")
        return {"email_id": email_id, **rec}

    @app.get("/api/review-queue")
    def review_queue():
        return [
            {"email_id": eid, "subject": rec.get("subject", ""),
             "review_reason": rec.get("review_reason"),
             "verdicts": rec.get("verdicts", [])}
            for eid, rec in sorted(run_data().items())
            if rec["status"] == "NEEDS_REVIEW"
        ]

    @app.post("/api/review/{email_id}")
    def submit_review(email_id: str, decision: ReviewDecision):
        rec = run_data().get(email_id)
        if rec is None:
            raise HTTPException(status_code=404, detail="unknown email_id")
        if decision.field not in FIELDS:
            raise HTTPException(status_code=400, detail="unknown field")
        if decision.verdict not in ("SAME", "DIFFERENT"):
            raise HTTPException(status_code=400, detail="verdict must be SAME or DIFFERENT")

        verdict = next((v for v in rec.get("verdicts", [])
                        if v["field_name"] == decision.field), None)
        if verdict is None:
            raise HTTPException(status_code=400, detail="field not compared on this email")

        app.state.store.record_human(
            str(verdict.get("si_value") or ""),
            str(verdict.get("bl_value") or ""),
            decision.verdict,
        )
        return {"recorded": True, "email_id": email_id, "field": decision.field,
                "verdict": decision.verdict}

    @app.get("/api/stats")
    def stats():
        data = run_data()
        categories: dict[str, int] = {}
        statuses: dict[str, int] = {}
        layers: dict[str, int] = {}
        for rec in data.values():
            categories[rec["category"]] = categories.get(rec["category"], 0) + 1
            statuses[rec["status"]] = statuses.get(rec["status"], 0) + 1
            for v in rec.get("verdicts", []):
                layers[v["decided_by"]] = layers.get(v["decided_by"], 0) + 1
        return {"total": len(data), "categories": categories,
                "statuses": statuses, "layers": layers}

    @app.get("/", response_class=HTMLResponse)
    def index():
        return (WEB_DIR / "static" / "index.html").read_text(encoding="utf-8")

    static_dir = WEB_DIR / "static"
    if static_dir.exists():
        app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

    return app


app = create_app()
```

`web/__init__.py`: empty file.

- [ ] **Step 5: Extend the runner to save a run**

Append to `scripts/run.py`, before the submit block:
```python
from sdoc.results import save_run

save_run(results, {e["email_id"]: e for e in emails})
```

- [ ] **Step 6: Run tests to verify they pass**

Create a placeholder `web/static/index.html` containing `<h1>Shipping Document Verification</h1>` so the index route resolves, then:

Run: `pytest tests/test_web_api.py -v`
Expected: PASS — 8 passed.

- [ ] **Step 7: Commit**

```bash
git add src/sdoc/results.py web scripts/run.py tests/test_web_api.py
git commit -m "feat: results store and FastAPI backend for the demo screens"
```

---

## Task 17: The four screens

One single-page app hitting the API from Task 16. Plain HTML/CSS/JS — no build step, nothing to break during a live demo.

**Files:**
- Create: `web/static/index.html`, `web/static/app.js`, `web/static/style.css`
- Test: `tests/test_web_pages.py`

**Interfaces:**
- Consumes: the Task 16 API.
- Produces: four views — Inbox, Report, Evidence, Review — switched client-side.

- [ ] **Step 1: Write the failing test**

`tests/test_web_pages.py`:
```python
import json

import pytest
from fastapi.testclient import TestClient

from web.app import create_app


@pytest.fixture
def client(tmp_path):
    (tmp_path / "run.json").write_text(json.dumps({}), encoding="utf-8")
    return TestClient(create_app(run_path=str(tmp_path / "run.json")))


def test_index_serves_html(client):
    response = client.get("/")
    assert response.status_code == 200
    assert "<html" in response.text.lower() or "<!doctype" in response.text.lower()


def test_index_declares_all_four_views(client):
    text = client.get("/").text
    for view in ("inbox", "report", "evidence", "review"):
        assert view in text.lower()


def test_static_assets_are_served(client):
    assert client.get("/static/app.js").status_code == 200
    assert client.get("/static/style.css").status_code == 200
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pytest tests/test_web_pages.py -v`
Expected: FAIL — the index contains none of the four view names, and the static assets 404.

- [ ] **Step 3: Write the page shell**

`web/static/index.html`:
```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Shipping Document Verification</title>
  <link rel="stylesheet" href="/static/style.css">
</head>
<body>
  <header>
    <h1>Shipping Document Verification</h1>
    <nav>
      <button data-view="inbox" class="active">Inbox</button>
      <button data-view="report">Report</button>
      <button data-view="evidence">Evidence</button>
      <button data-view="review">Review queue</button>
    </nav>
  </header>

  <section id="stats"></section>

  <main>
    <div id="inbox" class="view"></div>
    <div id="report" class="view" hidden></div>
    <div id="evidence" class="view" hidden></div>
    <div id="review" class="view" hidden></div>
  </main>

  <script src="/static/app.js"></script>
</body>
</html>
```

- [ ] **Step 4: Write the stylesheet**

`web/static/style.css`:
```css
:root {
  --bg: #f7f7f5; --panel: #fff; --ink: #1c1c1a; --muted: #6b6b66;
  --line: #e2e2dd; --ok: #1a7f57; --bad: #b3261e; --warn: #9a6400;
}
* { box-sizing: border-box; }
body { margin: 0; padding: 0 16px 48px; background: var(--bg); color: var(--ink);
  font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
header { padding: 20px 0 12px; }
h1 { font-size: 20px; margin: 0 0 12px; }
nav { display: flex; flex-wrap: wrap; gap: 8px; }
nav button { padding: 8px 14px; border: 1px solid var(--line); border-radius: 999px;
  background: var(--panel); color: var(--ink); cursor: pointer; font: inherit; }
nav button.active { background: var(--ink); color: var(--bg); border-color: var(--ink); }
#stats { display: flex; flex-wrap: wrap; gap: 10px; margin: 12px 0 20px; }
.tile { background: var(--panel); border: 1px solid var(--line); border-radius: 10px;
  padding: 10px 14px; min-width: 110px; }
.tile b { display: block; font-size: 20px; }
.tile span { color: var(--muted); font-size: 12px; }
table { width: 100%; border-collapse: collapse; background: var(--panel);
  border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--line);
  vertical-align: top; }
th { background: #efefe9; font-weight: 600; }
tr:last-child td { border-bottom: 0; }
.table-wrap { overflow-x: auto; }
.pill { display: inline-block; padding: 2px 9px; border-radius: 999px;
  font-size: 12px; font-weight: 600; }
.OK { background: #e3f3ec; color: var(--ok); }
.MISMATCH { background: #fbe6e4; color: var(--bad); }
.NEEDS_REVIEW { background: #fbf0d9; color: var(--warn); }
.row-click { cursor: pointer; }
.row-click:hover { background: #fafaf7; }
.diff { color: var(--bad); font-weight: 600; }
.same { color: var(--muted); }
.muted { color: var(--muted); }
.card { background: var(--panel); border: 1px solid var(--line);
  border-radius: 10px; padding: 16px; margin-bottom: 14px; }
.card h3 { margin: 0 0 10px; font-size: 15px; }
button.action { padding: 5px 11px; margin-right: 6px; border: 1px solid var(--line);
  border-radius: 6px; background: var(--bg); cursor: pointer; font: inherit; }
button.action:hover { background: var(--ink); color: var(--bg); }
code { background: #efefe9; padding: 1px 5px; border-radius: 4px; font-size: 12px; }
```

- [ ] **Step 5: Write the app logic**

`web/static/app.js`:
```javascript
const state = { emails: [], selected: null };

const el = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function api(path, options) {
  const response = await fetch(path, options);
  if (!response.ok) throw new Error(`${path} -> ${response.status}`);
  return response.json();
}

function show(view) {
  document.querySelectorAll(".view").forEach((n) => (n.hidden = n.id !== view));
  document.querySelectorAll("nav button").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === view));
  if (view === "report") renderReport();
  if (view === "evidence") renderEvidence();
  if (view === "review") renderReview();
}

async function renderStats() {
  const s = await api("/api/stats");
  const tiles = [
    ["Emails", s.total],
    ["Comparisons", s.categories.BL_COMPARISON || 0],
    ["Mismatches", s.statuses.MISMATCH || 0],
    ["Needs review", s.statuses.NEEDS_REVIEW || 0],
    ["Model calls (L4)", s.layers.L4 || 0],
  ];
  el("stats").innerHTML = tiles
    .map(([label, value]) => `<div class="tile"><b>${value}</b><span>${label}</span></div>`)
    .join("");
}

async function renderInbox() {
  state.emails = await api("/api/emails");
  const rows = state.emails.map((e) => `
    <tr class="row-click" data-id="${e.email_id}">
      <td><code>${e.email_id}</code></td>
      <td>${esc(e.subject).slice(0, 70)}</td>
      <td>${e.category}</td>
      <td>${e.attachment_count}</td>
      <td><span class="pill ${e.status}">${e.status}</span></td>
      <td>${esc((e.defect_fields || []).join(", ") || e.review_reason || "")}</td>
    </tr>`).join("");

  el("inbox").innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>ID</th><th>Subject</th><th>Category</th><th>Att.</th>
    <th>Status</th><th>Detail</th></tr></thead><tbody>${rows}</tbody></table></div>`;

  el("inbox").querySelectorAll(".row-click").forEach((row) =>
    row.addEventListener("click", () => {
      state.selected = row.dataset.id;
      show("report");
    }));
}

function verdictRows(detail) {
  return (detail.verdicts || []).map((v) => {
    const differs = v.verdict === "DIFFERENT";
    return `<tr>
      <td>${v.field_name}</td>
      <td class="${differs ? "diff" : ""}">${esc(v.si_value)}</td>
      <td class="${differs ? "diff" : ""}">${esc(v.bl_value)}</td>
      <td class="${differs ? "diff" : "same"}">${v.verdict}</td>
    </tr>`;
  }).join("");
}

async function renderReport() {
  if (!state.selected) {
    el("report").innerHTML =
      `<p class="muted">Pick an email in the Inbox to see its report.</p>`;
    return;
  }
  const d = await api(`/api/emails/${state.selected}`);
  const headline = d.status === "MISMATCH"
    ? `<p class="diff">Mismatch in: ${esc(d.defect_fields.join(", "))}</p>`
    : d.status === "NEEDS_REVIEW"
      ? `<p class="muted">Sent for review — ${esc(d.review_reason)}</p>`
      : `<p class="same">No mismatch detected.</p>`;

  el("report").innerHTML = `<div class="card">
    <h3><code>${d.email_id}</code> — ${esc(d.subject)}</h3>
    <p class="muted">${d.category} &middot; <span class="pill ${d.status}">${d.status}</span></p>
    ${headline}
    <div class="table-wrap"><table>
      <thead><tr><th>Field</th><th>SI value</th><th>BL value</th><th>Result</th></tr></thead>
      <tbody>${verdictRows(d) || `<tr><td colspan="4" class="muted">No comparison ran.</td></tr>`}</tbody>
    </table></div></div>`;
}

async function renderEvidence() {
  if (!state.selected) {
    el("evidence").innerHTML =
      `<p class="muted">Pick an email in the Inbox to trace its decisions.</p>`;
    return;
  }
  const d = await api(`/api/emails/${state.selected}`);
  const rows = (d.verdicts || []).map((v) => `<tr>
      <td>${v.field_name}</td>
      <td><code>${v.decided_by}</code></td>
      <td>${v.similarity == null ? "&mdash;" : v.similarity.toFixed(3)}</td>
      <td>${esc(v.reason) || "&mdash;"}</td>
    </tr>`).join("");

  el("evidence").innerHTML = `<div class="card">
    <h3>Decision trace &mdash; <code>${d.email_id}</code></h3>
    <p class="muted">Which layer settled each field. L1 canonicalization, L2 alias
    table, L3 similarity, L4 model adjudication, resolver for an uncertain L4.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Field</th><th>Decided by</th><th>Similarity</th><th>Reason</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="4" class="muted">No comparison ran.</td></tr>`}</tbody>
    </table></div></div>`;
}

async function renderReview() {
  const queue = await api("/api/review-queue");
  if (!queue.length) {
    el("review").innerHTML = `<p class="muted">Review queue is empty.</p>`;
    return;
  }
  el("review").innerHTML = queue.map((item) => `
    <div class="card">
      <h3><code>${item.email_id}</code> &mdash; ${esc(item.subject)}</h3>
      <p class="muted">Reason: <b>${esc(item.review_reason)}</b></p>
      ${(item.verdicts || []).map((v) => `
        <div>
          <b>${v.field_name}</b><br>
          <span class="muted">SI:</span> ${esc(v.si_value)}<br>
          <span class="muted">BL:</span> ${esc(v.bl_value)}<br>
          <button class="action" data-id="${item.email_id}"
                  data-field="${v.field_name}" data-verdict="SAME">Same entity</button>
          <button class="action" data-id="${item.email_id}"
                  data-field="${v.field_name}" data-verdict="DIFFERENT">Different</button>
        </div><hr>`).join("") ||
        `<p class="muted">No field comparison ran — resolve the document problem first.</p>`}
    </div>`).join("");

  el("review").querySelectorAll("button.action").forEach((button) =>
    button.addEventListener("click", async () => {
      await api(`/api/review/${button.dataset.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field: button.dataset.field,
                               verdict: button.dataset.verdict }),
      });
      button.parentElement.innerHTML =
        `<p class="same">Recorded: ${button.dataset.field} &rarr; ${button.dataset.verdict}.
         It enters the alias table at the next promotion.</p>`;
    }));
}

document.querySelectorAll("nav button").forEach((b) =>
  b.addEventListener("click", () => show(b.dataset.view)));

renderStats();
renderInbox();
```

- [ ] **Step 6: Run the tests, then look at it**

Run: `pytest tests/test_web_pages.py -v`
Expected: PASS — 3 passed.

Run: `uvicorn web.app:app --reload --port 8000`
Open `http://localhost:8000` and confirm: the inbox lists 520 rows, clicking one opens its report, the Evidence tab names the deciding layer per field, and the Review queue accepts a decision.

- [ ] **Step 7: Commit**

```bash
git add web/static tests/test_web_pages.py
git commit -m "feat: inbox, report, evidence and review-queue screens"
```

---

## Task 18: Firestore persistence for review decisions

Firestore becomes the system of record for human decisions and alias snapshots, with the local JSON store as the offline mirror. On Cloud Run a container restart must not lose what a reviewer taught the system.

**Files:**
- Create: `src/sdoc/firestore_store.py`
- Modify: `web/app.py`
- Test: `tests/test_firestore_store.py`

**Interfaces:**
- Consumes: `sdoc.compare.alias.AliasStore`
- Produces: `sdoc.firestore_store.FirestoreAliasStore(project=None, root=".aliases", client=None)` — an `AliasStore` subclass that mirrors `record_human` and `record_pending` writes into Firestore and reads pending entries back on startup. Falls back silently to local-only when Firestore is unreachable.

- [ ] **Step 1: Write the failing tests**

`tests/test_firestore_store.py`:
```python
from sdoc.firestore_store import FirestoreAliasStore


class FakeDoc:
    def __init__(self, data):
        self._data = data

    def to_dict(self):
        return self._data


class FakeCollection:
    def __init__(self):
        self.written = []
        self.docs = []

    def add(self, data):
        self.written.append(data)
        return None, None

    def stream(self):
        return iter(self.docs)


class FakeFirestore:
    def __init__(self):
        self.collections = {}

    def collection(self, name):
        return self.collections.setdefault(name, FakeCollection())


def test_human_decision_is_mirrored_to_firestore(tmp_path):
    fake = FakeFirestore()
    store = FirestoreAliasStore(root=str(tmp_path), client=fake)
    store.record_human("EAST BRIGHT", "EB TRADING", "SAME")

    written = fake.collection("alias_decisions").written
    assert len(written) == 1
    assert written[0]["si_value"] == "EAST BRIGHT"
    assert written[0]["source"] == "human"
    assert store.pending_path.exists()


def test_firestore_failure_still_writes_locally(tmp_path):
    class Broken:
        def collection(self, name):
            raise RuntimeError("no network")

    store = FirestoreAliasStore(root=str(tmp_path), client=Broken())
    store.record_human("A", "B", "SAME")
    assert store.pending_path.exists()


def test_pending_entries_are_restored_from_firestore(tmp_path):
    fake = FakeFirestore()
    fake.collection("alias_decisions").docs = [
        FakeDoc({"si_value": "A CORP", "bl_value": "A CORPORATION",
                 "verdict": "SAME", "source": "human", "similarity": 1.0})]
    store = FirestoreAliasStore(root=str(tmp_path), client=fake)
    store.restore_pending()
    assert "A CORP" in store.pending_path.read_text(encoding="utf-8")


def test_no_client_degrades_to_local_only(tmp_path):
    store = FirestoreAliasStore(root=str(tmp_path), client=None, project=None)
    store.record_human("A", "B", "SAME")
    assert store.pending_path.exists()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_firestore_store.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'sdoc.firestore_store'`

- [ ] **Step 3: Implement the Firestore-backed store**

`src/sdoc/firestore_store.py`:
```python
"""Firestore as the system of record for review decisions.

Cloud Run containers are ephemeral; without this a reviewer's decision would
vanish on the next cold start. Local JSON remains the mirror the batch pipeline
reads, so nothing requires network access to run.
"""
import json
import os

from sdoc.compare.alias import AliasStore

COLLECTION = "alias_decisions"


class FirestoreAliasStore(AliasStore):
    def __init__(self, project: str | None = None, root: str = ".aliases",
                 client=None):
        super().__init__(root=root)
        self.project = project or os.environ.get("GOOGLE_CLOUD_PROJECT")
        self._client = client
        self._tried = client is not None

    def _firestore(self):
        if not self._tried:
            self._tried = True
            try:
                from google.cloud import firestore
                self._client = firestore.Client(project=self.project)
            except Exception:
                self._client = None
        return self._client

    def record_pending(self, entry: dict) -> None:
        super().record_pending(entry)
        client = self._firestore()
        if client is None:
            return
        try:
            client.collection(COLLECTION).add(entry)
        except Exception:
            pass  # local mirror already holds it

    def restore_pending(self) -> int:
        """Re-materialise Firestore decisions into the local pending queue."""
        client = self._firestore()
        if client is None:
            return 0
        try:
            docs = list(client.collection(COLLECTION).stream())
        except Exception:
            return 0
        count = 0
        with self.pending_path.open("a", encoding="utf-8") as fh:
            for doc in docs:
                fh.write(json.dumps(doc.to_dict()) + "\n")
                count += 1
        return count
```

- [ ] **Step 4: Use it in the web app**

In `web/app.py`, change the default store construction inside `create_app`:
```python
from sdoc.firestore_store import FirestoreAliasStore

    app.state.store = store or FirestoreAliasStore()
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/test_firestore_store.py tests/test_web_api.py -v`
Expected: PASS — 12 passed.

- [ ] **Step 6: Commit**

```bash
git add src/sdoc/firestore_store.py web/app.py tests/test_firestore_store.py
git commit -m "feat: mirror review decisions to Firestore with local fallback"
```

---

## Task 19: Containerise and deploy to Cloud Run

The mandatory publicly accessible live prototype link.

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `scripts/deploy.sh`
- Modify: `README.md`
- Test: manual verification against the deployed URL

**Interfaces:**
- Consumes: `web.app:app`
- Produces: a public Cloud Run URL serving all four screens.

- [ ] **Step 1: Write the Dockerfile**

`Dockerfile`:
```dockerfile
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONIOENCODING=utf-8 \
    PYTHONPATH=/app/src

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY src/ ./src/
COPY web/ ./web/
COPY run.json ./run.json

# Cloud Run supplies $PORT.
CMD exec uvicorn web.app:app --host 0.0.0.0 --port ${PORT:-8080}
```

`.dockerignore`:
```
data/
.cache/
.aliases/
tests/
docs/
.git/
__pycache__/
*.pyc
.venv/
venv/
submission.json
traces.json
```

**Note:** `run.json` is the precomputed pipeline output and **must be generated before building**. It is the only dataset artifact the container needs — the raw bundle stays out of the image.

- [ ] **Step 2: Verify the container locally**

```bash
python scripts/run.py           # regenerates run.json
docker build -t sdoc-web .
docker run --rm -p 8080:8080 -e PORT=8080 sdoc-web
```
Open `http://localhost:8080`.
Expected: all four screens work exactly as they did under uvicorn.

- [ ] **Step 3: Write the deploy script**

`scripts/deploy.sh`:
```bash
#!/usr/bin/env bash
# Deploy the demo to Cloud Run.
#   PROJECT_ID=my-project ./scripts/deploy.sh
set -euo pipefail

PROJECT_ID="${PROJECT_ID:?set PROJECT_ID}"
REGION="${REGION:-asia-southeast1}"
SERVICE="${SERVICE:-sdoc-verify}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/sdoc/${SERVICE}"

gcloud config set project "${PROJECT_ID}"
gcloud services enable run.googleapis.com artifactregistry.googleapis.com \
    firestore.googleapis.com

gcloud artifacts repositories describe sdoc --location="${REGION}" >/dev/null 2>&1 || \
  gcloud artifacts repositories create sdoc \
    --repository-format=docker --location="${REGION}"

python scripts/run.py
gcloud builds submit --tag "${IMAGE}"

gcloud run deploy "${SERVICE}" \
  --image "${IMAGE}" \
  --region "${REGION}" \
  --allow-unauthenticated \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=${PROJECT_ID}"

gcloud run services describe "${SERVICE}" --region "${REGION}" \
  --format='value(status.url)'
```

- [ ] **Step 4: Create the Firestore database**

```bash
gcloud firestore databases create --location=asia-southeast1
```
Expected: a Native-mode database. Skip if one already exists.

- [ ] **Step 5: Deploy**

```bash
PROJECT_ID=<your project> bash scripts/deploy.sh
```
Expected: the script prints a `https://sdoc-verify-....run.app` URL.

- [ ] **Step 6: Verify the live deployment**

Open the URL in a browser and confirm each item:
- The stats tiles populate with 520 emails.
- The inbox lists every email with its category.
- Clicking a `MISMATCH` row shows SI and BL values side by side with the differing field highlighted.
- The Evidence tab names the deciding layer for each field.
- The Review queue accepts a decision and shows the confirmation.

Then confirm persistence:
```bash
gcloud firestore documents list --collection-ids=alias_decisions --limit=5
```
Expected: the decision you just recorded appears.

- [ ] **Step 7: Commit**

```bash
git add Dockerfile .dockerignore scripts/deploy.sh
git commit -m "feat: containerise and deploy the demo to Cloud Run"
```

---

## Task 20: README, slide deck and demo video

All four mandatory submission components. Nothing here is optional — a missing form field scores zero regardless of pipeline quality.

**Files:**
- Create/modify: `README.md`, `docs/architecture.md`, `docs/demo-script.md`
- Test: a fresh-clone setup walkthrough

**Interfaces:**
- Consumes: everything built.
- Produces: the artifacts the Google Form requires.

- [ ] **Step 1: Write the README**

`README.md` must contain, in this order:

1. **Project name and one-paragraph summary** — the problem and what the system does.
2. **The problem** — 520 mixed emails; manual SI/BL comparison is repetitive and error-prone; the same field is labelled differently across documents.
3. **Architecture diagram** — the S1→S7 pipeline from the spec, as a fenced ASCII block.
4. **Tech stack** — Python 3.14, Gemini, Cloud Run, Firestore, FastAPI, PyMuPDF, python-docx, openpyxl.
5. **Setup instructions**, verified from a clean clone:
   ```bash
   git clone <repo> && cd SIBL
   python -m venv .venv && .venv\Scripts\activate    # Windows
   pip install -r requirements.txt

   # place the organiser bundle in data/ (inbox/, attachments/, sample_submission.json)
   set GEMINI_API_KEY=<key>

   pytest -v                                      # unit tests
   python scripts/run.py                          # build submission.json + run.json
   python scripts/run.py http://localhost:8080    # score against the local server
   uvicorn web.app:app --port 8000                # the four screens
   ```
6. **Live demo link** — the Cloud Run URL.
7. **Results** — the final scoreboard numbers from `docs/scores.md`.
8. **What we found in the data** — the ground-truths table from this plan. The `BILL OF LADING INSTRUCTION` trap and the CJK-contaminated label are the two most compelling specifics.

- [ ] **Step 2: Write the architecture document**

`docs/architecture.md` covers the four headings the R&R names:

- **Technical architecture** — the pipeline, the L1→L4 ladder, the GCP services and why each is there.
- **Implementation details** — "code extracts and decides; the model classifies, rescues, and adjudicates"; the label map; numeric cross-checking; the alias promotion guard and snapshot pinning.
- **Challenges faced** — the `BILL OF LADING INSTRUCTION` header that would have destroyed all 14 PDF comparisons; `Gross Weight毛重(KGS)` in 51 files; xlsx attachments documented nowhere but a docstring; container counts living in tables rather than on labelled lines; making a learning alias table reproducible enough to A/B test.
- **Future roadmap** — OCR for genuinely scanned documents, alias table across runs, active learning from the review queue, direct mail-server integration, multi-tenant deployment.

- [ ] **Step 3: Write the demo video script**

`docs/demo-script.md`, budgeted to **under 5 minutes** (1 mark lost per 30s over):

| Time | Beat | Content |
|---|---|---|
| 0:00–0:20 | Intro | Team name, project name, one-line pitch. |
| 0:20–0:50 | Problem | 520 emails in one inbox; only ~126 carry documents; a missed discrepancy means corrections and delays. |
| 0:50–1:20 | Tech stack | Gemini for classification and adjudication, Cloud Run for serving, Firestore for review decisions, deterministic Python for extraction and comparison. |
| 1:20–3:40 | Live demo | Inbox funnel 520→126 → open a `MISMATCH` → side-by-side report with the flagged field → Evidence tab showing which layer decided → Review queue, confirm a decision. |
| 3:40–4:20 | The learning loop | Run `scripts/aliases.py promote`, re-run, show the L4 call count drop with the score holding. |
| 4:20–4:50 | Impact | Final scoreboard numbers; the two data traps caught; manual comparison time removed. |

- [ ] **Step 4: Verify setup instructions from a clean clone**

```bash
cd /tmp && git clone <repo> verify && cd verify
python -m venv .venv && .venv/Scripts/activate
pip install -r requirements.txt
pytest -v
```
Expected: unit tests pass with no `data/` present (integration tests skip).
**If any step fails, fix the README** — judges follow it literally.

- [ ] **Step 5: Final full verification**

```bash
pytest -v                     # all unit tests
pytest -v -m integration      # all integration tests
python scripts/run.py http://localhost:8080
```
Expected: green, and a final score recorded as the last row of `docs/scores.md`.

- [ ] **Step 6: Commit**

```bash
git add README.md docs/architecture.md docs/demo-script.md docs/scores.md
git commit -m "docs: README, architecture write-up and demo script"
```

- [ ] **Step 7: Assemble the submission**

Fill the Google Form (`https://forms.gle/nnam5eXrf5cjXdf3`) with:

| Field | Value |
|---|---|
| Project name | (your name) |
| Project description | The README summary |
| GitHub repository link | Public repo URL |
| Live prototype link | The Cloud Run URL |
| Slide deck / documentation | `docs/architecture.md` or a deck built from it, publicly viewable |
| Video demo link | YouTube **unlisted or public** — never private; or Drive set to "Anyone with the link → Viewer" |

**Submit before 22 Sep 2026, 12:00pm.** Late submissions are not considered.

---

## Execution notes

**Phase gates.** Tasks 1, 10, 12, 19 and 20 are the checkpoints that matter. If time runs short, Tasks 19 and 20 are non-negotiable — they are mandatory form fields, and a strong score with no live link scores zero overall. Task 15 (A/B sweep) is the first thing to cut, then Task 18 (Firestore), which degrades cleanly to local-only.

**Keep the score log current.** Every run that reaches the scoreboard gets a row in `docs/scores.md` naming what changed. This is the only way to tell a real improvement from noise.

**When a score drops,** read `traces.json` before changing logic. The trace names the deciding layer for every field of every email, so a regression localises to one layer rather than to the whole pipeline.

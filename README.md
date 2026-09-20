# Shipping Document Verification

An AI-powered pipeline that classifies 520 shipping emails and automatically compares Shipping Instructions (SI) against draft Bills of Lading (BL), flagging discrepancies across seven critical fields — eliminating hours of manual, error-prone document checking.

## The Problem

A shipping operations team receives mixed traffic in a single inbox: document-check requests, new Shipping Instruction requests, invoice queries, general operational updates, and spam. For document-check requests, staff must manually compare an SI (the reference) against a draft BL and report any mismatched field across shipper, consignee, notify party, ports, container count, and gross weight.

This is repetitive, error-prone, and a single missed discrepancy means costly corrections and shipping delays.

## Architecture

```
520 emails (JSON inbox)
   │
   ├─ S1  CLASSIFY  ── Gemini 3.6 Flash, batched ~20/call, disk-cached
   │        └─→ only BL_COMPARISON continues
   │
   ├─ S2  INGEST    ── code: .txt │ .pdf (PyMuPDF) │ .docx │ .xlsx  → DocText
   │
   ├─ S3  ROLE + PRE-GATES ── header-ordered SI/BL detection
   │        └─→ missing_attachment │ wrong_doc_type │ unreadable
   │
   ├─ S4  EXTRACT   ── label map + layout rules + table reader
   │        └─→ Gemini fallback for fields code missed
   │        └─→ post-gate: missing_value
   │
   ├─ S5  COMPARE   ── L1 canon → L2 alias → L3 similarity → L4 Gemini
   │
   ├─ S6  ROLLUP    ── OK │ MISMATCH │ NEEDS_REVIEW
   │
   └─ S7  EMIT      ── submission.json + evidence trace → POST /submit
```

### The Comparison Ladder (L1 → L4)

- **L1 — Canonicalize:** Uppercase, collapse whitespace, strip legal suffixes. Equal → SAME.
- **L2 — Alias lookup:** Learned equivalences from past adjudications. Same key → SAME.
- **L3 — Similarity bands:** Token-set ratio: ≥ 0.92 → SAME, ≤ 0.72 → DIFFERENT, gray band → L4.
- **L4 — Gemini adjudication:** Model classifies the relationship; never produces a value.

## Tech Stack

| Component | Technology |
|---|---|
| Language | Python 3.14 |
| AI / Classification | Gemini 3.6 Flash (google-genai) |
| PDF extraction | PyMuPDF |
| DOCX parsing | python-docx |
| XLSX parsing | openpyxl |
| Web framework | FastAPI + uvicorn |
| Persistence | Firestore (with local JSON fallback) |
| Deployment | Cloud Run |

## Setup

```bash
git clone <repo> && cd SIBL
python -m venv .venv && .venv\Scripts\activate    # Windows
pip install -r requirements.txt

# Place the organiser bundle in data/ (inbox/, attachments/, sample_submission.json)
set GEMINI_API_KEY=<key>

pytest -v                                      # unit tests
python scripts/run.py                          # build submission.json + run.json
python scripts/run.py http://localhost:8080    # score against the local server
uvicorn web.app:app --port 8000                # the four demo screens
```

## Demo Screens

1. **Inbox** — 520 emails with predicted category, filterable, showing the funnel narrowing 520 → comparisons.
2. **Discrepancy Report** — SI vs BL values side by side across all seven fields, mismatches highlighted.
3. **Evidence Trace** — which layer (L1/L2/L3/L4) decided each field, with similarity scores.
4. **Review Queue** — human-in-the-loop: NEEDS_REVIEW cases with reason and evidence; decisions feed back into the alias table.

## Results

See [docs/scores.md](docs/scores.md) for the full scoreboard history.

## What We Found in the Data

| Finding | Impact |
|---|---|
| All 13 PDF Shipping Instructions are headed `BILL OF LADING INSTRUCTION` | Naïve header matching would misclassify every one as a Bill of Lading |
| 51 files contain the label `Gross Weight毛重(KGS)` — CJK characters mid-label | Label normalisation must handle mixed-script labels |
| 8 of 28 PDFs are unreadable (2 corrupt, 6 image-only scans) | These are a reliability test — detecting them beats OCR-ing them |
| 94 comparison requests carry no attachment, but only 5 are `missing_attachment` | The body text ("attachments appear to have been dropped") is the real signal |
| `.xlsx` attachments are documented nowhere but the loader's docstring | Would be a silent scoring hole if unhandled |
| Container counts live in tables, not on labelled lines in PDFs | Table parsing and cross-checking required |

## Project Structure

```
src/sdoc/
  classify.py            S1 — Gemini classification
  docs/ingest.py         format dispatch → DocText
  extract/               label map, linear/block/numeric extractors, LLM fallback
  compare/               canon, alias, similarity, adjudicate, rollup
  gemini.py              client + content-hash disk cache
  pipeline.py            orchestration
  firestore_store.py     Firestore persistence for review decisions
web/
  app.py                 FastAPI app + four demo screens
  static/                HTML, CSS, JS
```

## License

Hackathon project — Averis × Monash 2026.
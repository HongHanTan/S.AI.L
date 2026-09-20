# Technical Architecture — Shipping Document Verification

## Overview

The system processes 520 shipping emails through a seven-stage pipeline that classifies, ingests, gates, extracts, compares, and rolls up results. The guiding principle: **code extracts and decides; the model classifies, rescues, and adjudicates.**

This means deterministic code handles the majority of extraction and comparison work, while Gemini is deployed only where it genuinely outperforms rules: classifying ambiguous email intent (Stage 1), rescuing fields the parser missed (Stage 4 fallback), and resolving narrow similarity gray bands (L4 adjudication). The practical effect: a full scoreboard iteration re-runs in seconds off cache instead of minutes of API calls.

---

## Technical Architecture

### Pipeline Stages

**Stage 1 — Classification (Gemini)**
- Batches of ~20 emails sent to Gemini 3.5 Flash-Lite
- Input: sender, subject, body text, attachment filenames and count
- Output: one of BL_COMPARISON, SI_REQUEST, INVOICE_QUERY, GENERAL, SPAM
- Content-hash disk cache makes repeated runs free
- Only BL_COMPARISON emails proceed to document comparison

**Stage 2 — Ingestion**
- Four format handlers: `.txt` (direct), `.pdf` (PyMuPDF), `.docx` (python-docx), `.xlsx` (openpyxl)
- Each produces a `DocText` with normalised lines, format metadata, and error state
- Eight deliberately unreadable PDFs (2 corrupt, 6 image-only) are detected rather than OCR-ed

**Stage 3 — Role Assignment + Pre-Gates**
- Header detection assigns SI/BL roles: `INSTRUCTION` tested before `BILL OF LADING` to handle the `BILL OF LADING INSTRUCTION` header on all PDF SIs
- Gates map 1:1 to review reasons: `missing_attachment`, `wrong_doc_type`, `unreadable`
- Special handling: 94 attachment-less comparison requests report clean OK; only 5 that *claim* missing attachments escalate

**Stage 4 — Extraction**
- ~61 label variants collapse to 7 canonical fields via a lookup table
- Two layout parsers: `Label: value` for txt/xlsx/docx, `Label\nvalue` for PDFs
- Numeric extraction: container count from summary lines and table row count, gross weight from summary and column sum, cross-checked
- Gemini fallback fills fields the deterministic parser missed
- Post-gate: `missing_value` when either document lacks a required field

**Stage 5 — Comparison Ladder**
- **Gate 1:** Numerics (container_count, gross_weight_kg) compared exactly
- **L1 — Canonicalize:** Uppercase, strip punctuation, remove legal suffixes (PTE LTD, SDN BHD, etc.), flatten addresses. Party comparison weights name over address.
- **L2 — Alias lookup:** Growing table of learned equivalences, pinned to a snapshot per scored run
- **L3 — Similarity bands:** Token-set ratio with ≥0.92 → SAME, ≤0.72 → DIFFERENT
- **L4 — Adjudication:** Gemini resolves only the narrow gray band, never produces a value
- **Resolver:** UNCERTAIN falls back to the similarity midpoint (0.82)

**Stage 6 — Rollup**
- Any field DIFFERENT → MISMATCH
- Else any gate defect → NEEDS_REVIEW
- Else all seven SAME → OK

**Stage 7 — Submission**
- Generates `submission.json` (all 520 email_ids)
- Evidence trace per email for debugging
- POST to scoring server

### Deployment and cloud services

| Service | Role | Status |
|---|---|---|
| **Gemini API** (`gemini-3.5-flash-lite`) | Classification, fallback extraction, L4 adjudication | **Live** — core functionality |
| **Vercel** | Hosts the FastAPI demo at [sibl-seven.vercel.app](https://sibl-seven.vercel.app) | **Live** |
| **Cloud Run + Artifact Registry** | Alternative host; `Dockerfile` and `scripts/deploy.sh` are committed and ready | Ready, not currently deployed |
| **Firestore** | Persists human review decisions across restarts | Implemented with a local-file fallback; inactive without service-account credentials |

The deployment target is deliberately not load-bearing. The server reads a
precomputed `run.json` and imports only FastAPI and Pydantic — the parsing and
model libraries never load in the web process. That keeps the demo instant,
costs no model calls while it is being browsed, and means the same application
runs unchanged on Vercel or Cloud Run.

The AI itself is the cloud dependency that matters: Gemini performs
classification across all 520 emails, which is 30% of the measured score.

---

## Results

Measured against the organisers' held-out reference set through the local
`POST /submit` endpoint. The answer key is never read — only the returned metrics.

| Axis | Weight | Score |
|---|---:|---:|
| End-to-end defect catching | 50% | **0.978** — 45 of 46 defects caught |
| Stage-3 defect F1 | 20% | **0.989** — precision 1.00, no false alarms |
| Stage-1 classification macro-F1 | 30% | **0.958** |
| **Final score** | | **0.9743** |

Reliability is scored separately at **0.947**, with escalation precision 1.00 —
the system never asks for help when it does not need it. By reason:
`wrong_doc_type` 5/5, `missing_attachment` 5/5, `unreadable` 5/5, `missing_value` 3/5.

Progression across runs: `0.0124` (baseline) → `0.7465` (deterministic pipeline,
no model) → `0.9743` (with Gemini classification). The deterministic core alone
reaches 0.978 on the highest-weighted axis, which is what makes the system
auditable rather than a black box.

---

## Implementation Details

### Content-Hash Disk Cache
Every Gemini call is keyed by `SHA256(model + prompt)`. A re-run after changing comparison logic costs zero API calls — only a prompt change triggers a new call. This makes the scoring loop fast enough to iterate dozens of times.

### Label Normalisation
The ~61 observed label spellings (e.g., `Port of Loading (POL)`, `POL`, `PORT OF LOADING`, `Load Port`) resolve to 7 canonical fields through uppercasing, stripping punctuation and parenthesised codes. The ignored labels (Freight, HS Code, Vessel, Voyage, Booking Ref) are confirmed irrelevant across all 250 attachments.

### Numeric Cross-Checking
Where a PDF carries both a summary line (`No. of Containers: 6 x 40'HC`) and a container table (count rows), the two independent sources must agree. Disagreement is a reading problem, not a discrepancy — it triggers `missing_value`, never a mismatch.

### Alias Promotion and Snapshot Pinning
A growing alias table makes runs stateful, which would destroy attributable score deltas. So:
- Each scored run pins a read-only snapshot
- L4 verdicts and human confirmations write to a pending queue
- Promotion is explicit between runs, creating a numbered snapshot
- Promotion guard: similarity ≥ 0.85, no human DIFFERENT on record

### Party Name-over-Address Comparison
Company names compare first; address agreement alone never carries a match. This prevents cases like `EAST BRIGHT FZ-LLC` vs `UAB NOVAKOPA` at an identical address from scoring as SAME.

---

## Challenges Faced

1. **The `BILL OF LADING INSTRUCTION` header trap** — All 13 PDF Shipping Instructions use this header. Naïve matching against `BILL OF LADING` would misclassify every one and silently destroy those comparisons. Fixed by testing `INSTRUCTION` before `BILL OF LADING`.

2. **CJK-contaminated label** — `Gross Weight毛重(KGS)` appears in 51 files. The label normaliser strips non-ASCII characters as part of canonicalisation.

3. **Undocumented `.xlsx` attachments** — The `.xlsx` format appears only in the loader's docstring, not the use-case PDF. Without handling it, 22 attachments would silently fail.

4. **Container counts in tables, not on labelled lines** — PDF container counts live in a table structure, not as `Label: value`. Required a dedicated table parser with summary cross-checking.

5. **Making the alias table reproducible** — A learning system that changes between runs makes A/B testing impossible. Snapshot pinning solved this: the table grows, but any individual run is deterministic.

6. **94 attachment-less comparison requests** — Only 5 emails are genuinely `missing_attachment`, but 94 BL_COMPARISON emails carry no attachment at all. The sender's own wording ("attachments appear to have been dropped") is the real signal, not attachment count.

---

## Future Roadmap

- **OCR for genuinely scanned documents** — The 6 image-only PDFs are correctly escalated now; OCR would let the system compare them too
- **Active learning from the review queue** — Each human decision already feeds the alias table; expanding this to retrain classification prompts
- **Direct mail server integration** — IMAP/Exchange connector for real-time processing
- **Multi-tenant deployment** — Per-customer Firestore collections and API key management
- **Confidence calibration** — Replace the binary gray band with a calibrated probability score

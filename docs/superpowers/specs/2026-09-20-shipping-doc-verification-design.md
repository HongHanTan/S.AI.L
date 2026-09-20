# Shipping Document Verification — Design

**Date:** 2026-09-20
**Context:** Averis x Monash Hackathon 2026, preliminary round (deadline 22 Sep 2026, 12:00pm)
**Status:** Approved design, ready for implementation planning

---

## 1. Problem

A shipping operations team receives mixed traffic in one inbox: document-check requests,
new Shipping Instruction (SI) requests, invoice queries, general operational updates, and
spam. For a document-check request, staff compare an SI (the reference) against a draft
Bill of Lading (BL) and report any mismatched field.

The system must, for each of 520 emails:

1. **Classify** into `BL_COMPARISON`, `SI_REQUEST`, `INVOICE_QUERY`, `GENERAL`, `SPAM`.
2. For `BL_COMPARISON` only: **extract** seven fields from both attachments, **compare**
   them, and report `OK` / `MISMATCH` / `NEEDS_REVIEW`.
3. **Escalate to a human** when it cannot decide, with source evidence and a reason —
   rather than guessing or failing silently.

The seven compared fields:
`shipper`, `consignee`, `notify_party`, `port_of_loading`, `port_of_discharge`,
`container_count`, `gross_weight_kg`.

**Scoring:** 50% end-to-end (defects caught all the way through) + 30% Stage-1 macro-F1
+ 20% Stage-3 defect-F1. `NEEDS_REVIEW` handling is reported as a separate reliability axis.

---

## 2. Dataset findings

Measured directly against the bundle, not assumed:

| Fact | Consequence |
|---|---|
| 520 emails; **126 have attachments** (124 pairs, 2 SI-only) | Comparison work is bounded. Classification over 520 is the bulk of the workload. |
| Attachment formats: 192 `.txt`, 28 `.pdf`, 22 `.xlsx`, 8 `.docx` | `.xlsx` appears **only** in `loader.py`'s docstring — absent from the use-case PDF. Silent scoring hole if unhandled. |
| **20 of 28 PDFs are ReportLab text PDFs; 8 are not** — 2 structurally invalid, 6 image-only scans (`email_511`–`email_515`) | PyMuPDF extracts the 20 cleanly. The 8 are *meant* to be unreadable: the reference set labels them `NEEDS_REVIEW`/`unreadable`, so detecting them beats OCR-ing them. Still no OCR pipeline — but for the opposite reason to the one first recorded here. |
| ~45 distinct field labels observed | Enumerable; a label map resolves the large majority deterministically. |
| PDFs carry a container table **and** summary lines | Two independent sources per numeric field, cross-checkable (verified: 6 × 21,887 = 131,322). |
| `TO CONFIRM DOCS…` subjects appear both with and without attachments | Whether an attachment-less one is `BL_COMPARISON` or `GENERAL` is unknowable a priori — must be a tunable switch. |

### Two bugs found in the prior plan (Averis.pdf)

**Bug 1 — `wrong_doc_type` gate misfires.** The plan specifies matching the header against
`SHIPPING INSTRUCTION` / `BILL OF LADING`. But `email_059_SI.pdf`, a genuine Shipping
Instruction, is headed `BILL OF LADING INSTRUCTION`. Substring matching flags it
`wrong_doc_type` and discards a real comparison. Detection must test `INSTRUCTION` **before**
`BILL OF LADING`.

**Bug 2 — Gate 1 assumes scalar numerics.** In PDFs, container count and gross weight live
in a table (count rows, sum column). The plan's `parse number + unit` never fires.

**Sequencing wrinkle.** The plan states gates "run before any comparison", but `missing_value`
is only detectable *after* extraction. Gates split into pre-extraction and post-extraction.

### Coverage gaps in the prior plan

Averis.pdf designs the comparison layer only — roughly one third of the solution. Absent:
Stage-1 classification (30% of score), Stage-2 extraction mechanics, document ingestion for
any format, attachment role assignment, cloud infrastructure, the live prototype, the
human-in-the-loop surface, and any iteration/observability loop.

---

## 3. Guiding principle

> **Code extracts and decides; the model classifies, rescues, and adjudicates.**

This amends Averis.pdf's "LLM extracts, code decides". The data shows deterministic
extraction is sufficient for most fields, so the model is deployed only where it genuinely
outperforms code. Practical effect: a full scoreboard iteration re-runs in seconds off cache
instead of minutes of API calls.

---

## 4. Pipeline

```
520 emails (loader.Inbox)
   │
   ├─ S1  CLASSIFY  ── Gemini, batched ~20/call (~26 calls), disk-cached
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
   ├─ S5  COMPARE   ── L1→L4 ladder
   │
   ├─ S6  ROLLUP    ── OK │ MISMATCH │ NEEDS_REVIEW
   │
   └─ S7  EMIT      ── submission.json + evidence trace → POST /submit
```

### Where the model does real work

1. **Classification (S1)** — owns the 30% macro-F1 axis. Misleading subjects are precisely
   what a model beats keyword rules at. Input: `from`, `subject`, `body`, attachment
   filenames and count.
2. **Fallback extraction (S4)** — only for a field still empty after deterministic parsing.
   Returns the value *and* its source snippet, which also supplies L4's required
   `si_snippet` / `bl_snippet`.
3. **Gray-band adjudication (L4)** — unchanged from Averis.pdf.

---

## 5. Stage 3 — role assignment and pre-gates

Gates run in order, each mapping 1:1 onto a permitted reason code:

| Gate | Trigger | Reason code |
|---|---|---|
| Attachment count | 0 or 1 usable attachment on a `BL_COMPARISON` email | `missing_attachment` |
| Extraction yield | Parser returns < 50 chars, or format unsupported/corrupt | `unreadable` |
| Doc type | Header is not the document the role requires | `wrong_doc_type` |

**Doc-type detection (ordered):**

```
1. header contains "INSTRUCTION"          → SI   (catches "BILL OF LADING INSTRUCTION")
2. header contains "SHIPPING INSTRUCTION" → SI
3. header contains "BILL OF LADING"       → BL
4. otherwise                              → fall back to filename role
```

Rule 1 must precede rule 3. Header is the first three non-empty lines only; body text
mentioning "bill of lading" must never vote.

Role assignment pairs one SI with one BL. Two SIs and no BL → `wrong_doc_type`. Where
filename and header disagree, **the header wins** — the filename is the thing that lies.

---

## 6. Stage 4 — extraction

### Label map

The ~45 observed label variants collapse to 7 canonical fields. Normalisation uppercases,
strips punctuation and parenthesised codes, so `Port of Loading (POL)`, `POL`,
`PORT OF LOADING` and `Load Port` all key to `port_of_loading`; `Consignee`,
`CONSIGNEE`, `Consignee (Non-Negotiable)` and `To the Order of` all key to `consignee`.

### Two layouts, one reader

- `Label: value` on one line — `.txt`, `.xlsx`, `.docx`
- `Label` then value on following lines until the next known label — `.pdf`

### Per-format notes

- **`.xlsx`** — two-column label/value sheets using inline strings (no `sharedStrings`).
  HTML entities decoded (`&amp;` → `&`); `|` splits name from address; `;` splits address
  lines. Primary parser `openpyxl`, with a verified stdlib `zipfile` + XML fallback so a
  missing dependency cannot take down 22 attachments.
- **`.docx`** — paragraphs *and* tables via `python-docx`.
- **`.pdf`** — `PyMuPDF.get_text()`.

### Numeric fields

Three sources, in priority order, cross-checked:

1. Summary line — `No. of Containers: 6 x 40'HC` → `6`;
   `TOTAL Gross Wt (kgs): 131,322 KG` → `131322`
2. Container table — count rows; sum the weight column
3. Inline field — `Gross Weight (KG): 341715`

Where both a summary and a table exist they must agree. **Disagreement is a reading problem,
not a discrepancy** → `missing_value`, never a mismatch.

Units normalise to integer kilograms (`22 MT` → `22000`). Number words and `THREE (3)`
forms parse. Parse failure → `missing_value`. Numerics are compared exactly and never
involve a model.

---

## 7. Stage 5 — the comparison ladder

- **Gate 1 — type routing.** `container_count` and `gross_weight_kg` exit here, compared
  exactly. The five text fields continue.
- **L1 — canonicalize.** Uppercase, collapse whitespace, strip punctuation. Ports drop
  trailing country and parenthesised codes (`NANTONG, CHINA (CNNTG)` → `NANTONG`).
  Parties drop legal suffixes (`PTE LTD`, `SDN BHD`, `CO LTD`, `INC`, `GMBH`, `FZ-LLC`,
  `PTY LTD`) and flatten addresses. Equal → SAME.
- **L2 — alias lookup.** Both sides resolve to a canonical key via a table that starts empty
  and grows from L4 verdicts and human confirmations (see *Feedback loop* below).
  Same key → SAME.
- **L3 — similarity bands.** Token-set ratio: ≥ 0.92 → SAME, ≤ 0.72 → DIFFERENT,
  between → L4. The band stays narrow deliberately; uncertainty has no exit, so a wider band
  only buys more calls that still must resolve.
- **L4 — adjudicator.** Gray band only. One field, both values, both source snippets.
  Classifies a relationship (`SAME` / `DIFFERENT` / `UNCERTAIN`); never produces a value.
- **Resolver.** `UNCERTAIN` does not escalate — it falls back to the similarity score against
  the 0.82 band midpoint. Every one is logged to the review queue regardless.

### Feedback loop — the alias table grows

Every L4 verdict and every human review decision is logged, and confirmed matches are
promoted into L2 so the layer gets cheaper and more deterministic each run.

**Promotion rule.** A pair is promoted to a shared canonical key when:

- the verdict is `SAME`, **and**
- it came from an L4 adjudication or a human confirmation, **and**
- token-set similarity ≥ **0.85** (the guard — blocks a confident-sounding model verdict on
  two genuinely unlike strings from poisoning the table), **and**
- no human has ever recorded `DIFFERENT` for that pair.

A human `DIFFERENT` is authoritative: it removes any existing alias link and writes a
permanent negative entry that blocks future promotion of that pair. Human decisions outrank
model decisions, always.

**Storage.** Firestore is the system of record; a local JSON mirror lets the batch pipeline
run without network access. Each entry records the pair, canonical key, source
(`l4` / `human`), similarity at promotion, and timestamp — so any alias can be audited or
rolled back.

**Reproducibility — the snapshot pin.** A growing table makes runs stateful: two identical
invocations could otherwise produce different submissions, destroying the attributable score
deltas that §13 depends on. Therefore:

- Every scored run **pins a table snapshot** (`--alias-snapshot <id>`) and treats it as
  read-only. Promotions during the run are written to a pending queue, not the live table.
- Promotion is an **explicit step between runs** (`python -m sdoc.aliases promote`), which
  creates a new numbered snapshot.
- The score log records which snapshot produced each score.

This keeps the learning loop real while keeping A/B tests of the §9 switches honest.

**Party comparison weights name over address.** `email_004` has SI consignee
`EAST BRIGHT FZ-LLC` against BL `UAB NOVAKOPA` at an *identical address*. Naive whole-blob
similarity scores that pair high and misses a real defect. Names compare first; address
agreement alone never carries a match.

---

## 8. Stage 6 — rollup

```
any field DIFFERENT   → MISMATCH,     has_defect=true, defect_fields=[…]
else any gate defect  → NEEDS_REVIEW, review_reason=<code>
else all seven SAME   → OK
```

A confirmed `DIFFERENT` outranks a gate defect on another field — catching the defect is what
the 50% end-to-end axis scores.

Non-`BL_COMPARISON` emails emit `status: "OK"`, `has_defect: false`, `defect_fields: []`,
`review_reason: null`, matching `sample_submission.json`.

`defect_fields` uses exact enum spelling: `shipper`, `consignee`, `notify_party`,
`port_of_loading`, `port_of_discharge`, `container_count`, `gross_weight_kg`.

Every one of the 520 email_ids must be present in the submission.

---

## 9. Tunable switches

Both are decisions the data cannot settle a priori. Each is one flag, A/B tested on the
scoreboard, with the result and score delta recorded.

| Switch | Options | Default |
|---|---|---|
| `ATTACHMENTLESS_CONFIRM_DOCS_POLICY` | `BL_COMPARISON` + `missing_attachment`, or `GENERAL` | `GENERAL` |
| `UNCERTAIN_LEAN` | `SAME` or `DIFFERENT` above/below the 0.82 midpoint | midpoint fallback |

---

## 10. Module layout

Small, single-purpose files so a failing field traces to one module:

```
src/sdoc/
  classify.py            S1 — Gemini classification
  docs/ingest.py         format dispatch → DocText
  docs/txt.py
  docs/pdf.py
  docs/docx_.py
  docs/xlsx.py
  extract/labels.py      ~45 label variants → 7 canonical fields
  extract/rules.py       "Label: value" and "Label\nvalue" layouts
  extract/numeric.py     counts/weights, table sum + cross-check
  extract/llm.py         Gemini fallback extraction
  compare/gates.py       document-defect gates
  compare/canon.py       L1
  compare/alias.py       L2 — lookup, promotion rule, snapshot pinning
  compare/similarity.py  L3
  compare/adjudicate.py  L4 — Gemini adjudicator
  compare/rollup.py      precedence
  pipeline.py            orchestration
  submit.py              build submission + POST
  trace.py               per-email evidence log
web/                     FastAPI app + four screens (Cloud Run)
```

---

### Dependencies (measured on the target machine, Python 3.14.3)

| Library | Status | Use |
|---|---|---|
| `pymupdf` | **installed** | PDF text extraction |
| `python-docx` | **installed** | `.docx` paragraphs and tables |
| `openpyxl` | **missing — must install** | `.xlsx`; stdlib `zipfile`+XML fallback verified working |
| `google-genai` | must install | Gemini client |
| `fastapi`, `uvicorn` | must install | Cloud Run app |

The bundle is copied to `data/` and is **gitignored** — it is organiser-supplied data, not
project source. `.cache/` and `submission.json` are likewise gitignored.

---

## 11. Cloud architecture

| Component | Service | Role |
|---|---|---|
| Pipeline API + UI | **Cloud Run** (FastAPI, containerised) | The mandatory publicly accessible live prototype link. Scales to zero. |
| Classification, fallback extraction, L4 | **Gemini API** | The AI core; owns the 30% axis. |
| Review queue + alias table | **Firestore** | Persists human decisions and learned aliases across runs. |
| Container image | **Artifact Registry** | Cloud Run's image source. |

Managed inference, managed persistence, managed serverless compute — a genuine integration
rather than a VM running a script. The R&R penalty clause addresses exactly this distinction.

---

## 12. Demo surface — four screens

1. **Inbox** — 520 emails with predicted category, filterable by category, each row showing
   attachment count and resulting status; shows the funnel narrowing 520 → 126.
2. **Discrepancy report** — SI value against BL value side by side across all seven fields,
   mismatches flagged, agreeing fields shown as agreeing. `No mismatch detected` when all
   seven pass. This is the literal artifact the use case asks for.
3. **Evidence trace** — for any field: which layer decided it (L1/L2/L3/L4) and the source
   snippet from each document.
4. **Review queue** — human-in-the-loop. `NEEDS_REVIEW` cases with reason and source
   evidence; a reviewer confirms or corrects; the correction writes back to the alias table
   and updates the report.

Screen 4 is disproportionately valuable: "Ask for help" is a named capability in the use case
and a judged reliability axis, and Averis.pdf explicitly demotes it.

---

## 13. Observability and the scoring loop

The scoring loop is built **first**, before any intelligence:

```bash
docker compose up --build      # sdoc-hackathon-docker → localhost:8080
python -m sdoc.submit          # build submission.json → POST /submit → scoreboard
```

Hour one produces a deliberately trivial submission (everything `GENERAL`) purely to prove
the pipe works end to end. Every subsequent phase submits again, so each change carries an
attributable score delta.

- **Gemini call caching** — keyed by content hash, written to `.cache/`. Scoreboard
  iterations do not re-pay for classification.
- **Evidence trace** — every email emits extracted values, the deciding layer per field, and
  the reason. Without this, we cannot tell *why* a score moved between submissions; with two
  days, blind iteration is the main way this fails.
- **Score log** — every submission records the score and which switch changed.

---

## 14. Delivery sequence (48 hours)

| Phase | Hours | Output | Gate |
|---|---|---|---|
| 0 | 0–1 | Scaffold, docker server up, baseline submission | Scoreboard returns a number |
| 1 | 1–6 | Ingest (txt/pdf/docx/xlsx) + deterministic extract + compare | Score on 50% + 20% axes |
| 2 | 6–12 | Gemini classification, batched + cached | 30% axis jumps |
| 3 | 12–18 | L3/L4, fallback extraction, A/B both switches | Best score locked |
| 3b | 18–21 | Alias table: promotion rule, snapshots, Firestore mirror | Snapshot N+1 scores ≥ snapshot N |
| 4 | 21–32 | Cloud Run deploy, four screens, Firestore write-back | Live link works |
| 5 | 32–42 | README, slide deck, ≤5 min video | All four mandatory components exist |
| 6 | 42–48 | Buffer | Submit early |

If time collapses, phases 4 and 5 are non-negotiable — they are mandatory submission form
fields, and a strong score with no live link scores zero overall. Phase 3 is where we cut.

---

## 15. Mandatory submission components (R&R)

| Component | Source |
|---|---|
| Project description | Written in phase 5 |
| GitHub repo + README with setup instructions | The repo itself |
| Live prototype link | Cloud Run URL (phase 4) |
| Slide deck / documentation | Technical architecture, implementation details, challenges, future roadmap (phase 5) |
| Demo video ≤ 5 min | Intro, problem, tech stack, live walkthrough, impact (phase 5). 1 mark deducted per 30s over. |

---

## 16. Explicitly out of scope

- **OCR / vision pipeline.** Six image-only PDFs exist, but the reference set labels them
  `NEEDS_REVIEW`/`unreadable` — they are a reliability test, not a reading test. OCR-ing
  them would convert a correct escalation into a guess. Detect, don't decode.
- **Retry/backoff infrastructure beyond a simple bounded retry.** 126 comparisons is small.
- **Any handling for email formats beyond the provided JSON records.**

---

## 17. Success criteria

1. `submission.json` contains all 520 email_ids in `sample_submission.json`'s exact shape and
   is accepted by `POST /submit`.
2. The scoreboard returns a score, and each phase's delta is recorded against the change that
   caused it.
3. All four attachment formats parse; no email fails with an unhandled exception.
4. The Cloud Run URL is publicly reachable and serves all four screens.
5. A reviewer can resolve a `NEEDS_REVIEW` case in the UI and see the report update.
6. A reviewer's confirmation promotes an alias into the table, and the next snapshot resolves
   that pair at L2 without an L4 call — demonstrable as a drop in L4 call count between two
   consecutive snapshots on the same input.
7. All five mandatory submission components exist before the 22 Sep 2026 12:00pm deadline.

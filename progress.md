# Build progress — Shipping Document Verification

**Deadline:** 22 Sep 2026, 12:00pm · **Branch:** `feat/sdoc-pipeline`
**Plan:** [docs/superpowers/plans/2026-09-20-shipping-doc-verification.md](docs/superpowers/plans/2026-09-20-shipping-doc-verification.md)
**Spec:** [docs/superpowers/specs/2026-09-20-shipping-doc-verification-design.md](docs/superpowers/specs/2026-09-20-shipping-doc-verification-design.md)

Scoring server: `http://127.0.0.1:8080` (uvicorn, 520 emails, scoring available).
Ground truth is never read — scoring goes through `POST /submit` only.

## Status

| # | Task | Status | Tests | Commits |
|---|---|---|---|---|
| 1 | Scaffold + scoreboard loop | ✅ done | 5/5 | `59f08f5` |
| 2 | Ingestion — txt and pdf | ✅ done | 9/9 | `5b54443` |
| 3 | Ingestion — docx and xlsx | ✅ done | 15/15 +2 integ | `751f4f5` |
| 4 | Doc-type detection + gates | ✅ done | 35/35 +4 integ | `af91d54` |
| 5 | Label normalisation | ✅ done | 78/78 | `0b5504d` |
| 6 | Linear + block extractors | ✅ done | 86/86 | `pending` |
| 7 | Numeric extraction | ⏳ in progress | — | — |
| 8 | L1 canon + L3 similarity | ⬜ pending | — | — |
| 9 | Comparison ladder + rollup | ⬜ pending | — | — |
| 10 | Deterministic pipeline, first score | ⬜ pending | — | — |
| 11 | Gemini client + cache | ⬜ pending | — | — |
| 12 | Gemini classification | ⬜ pending | — | — |
| 13 | Fallback extraction + L4 | ⬜ pending | — | — |
| 14 | Alias promotion + snapshots | ⬜ pending | — | — |
| 15 | A/B the switches | ⬜ pending | — | — |
| 16 | Results store + FastAPI | ⬜ pending | — | — |
| 17 | The four screens | ⬜ pending | — | — |
| 18 | Firestore persistence | ⬜ pending | — | — |
| 19 | Cloud Run deploy | ⬜ pending | — | — |
| 20 | README + deck + video | ⬜ pending | — | — |

## Scoreboard history

| Run | Change | final_score | Notes |
|---|---|---|---|
| 1 | baseline, everything GENERAL | **0.0124** | proves the submit loop; stage1 macro-F1 0.041 |

## Notes and decisions

- **2026-09-20** — Docker unavailable; scoring server run directly via uvicorn against
  `data_v2`, which is byte-identical to the participant bundle.
- **2026-09-20** — The Downloads copy is the organizers' package and contains the answer
  key. Hard boundary set: never read or reference `ground_truth.json`; score only through
  `POST /submit`.
- **2026-09-20** — Pre-flight scan fixed three plan defects: a double-escaped xlsx test
  fixture, three vacuously-passing gray-band tests, and dead code left by Task 1.
- **2026-09-20** — Task 1 scoreboard revealed the reference class distribution:
  BL_COMPARISON 220, SI_REQUEST 125, INVOICE_QUERY 75, GENERAL 60, SPAM 40.
  **220 comparison emails but only 126 carry attachments**, so ~94 arrive with nothing
  attached. Flipped `attachmentless_is_comparison` to default `True` — the old default
  would have forfeited ~94 emails on the 30% axis.
- **2026-09-20** — Reference targets to aim at: 46 emails carry a real defect (the
  end-to-end axis), 20 are NEEDS_REVIEW (5 each of wrong_doc_type, missing_attachment,
  unreadable, missing_value), 154 are clean.
- **2026-09-20** — Task 2 implementer caught a contradiction in my test fixture:
  `"SHIPPER: X"` was itself the third non-empty line, so asserting it was absent
  from a three-line header was impossible. Verified empirically that a three-line
  header yields zero false SI detections across all 250 attachments, so the design
  held and only the fixture needed correcting.
- **2026-09-20** — Task 3 implementer found my "all PDFs are text PDFs" claim was wrong:
  8 of 28 PDFs fail to read (2 structurally invalid, 6 image-only scans). They are
  `email_511`-`email_515` and are *meant* to be unreadable — the reference labels them
  NEEDS_REVIEW/unreadable. So still no OCR, but for the opposite reason to the one
  originally recorded. Integration test now asserts exactly those 8 error.
- **2026-09-20** — Mapped the edge-case block precisely: 501-505 wrong_doc_type,
  506-510 missing_attachment, 511-515 unreadable, 516-520 missing_value.
- **2026-09-20** — Decisive gate correction: only 5 emails are `missing_attachment`, yet
  94 comparison requests carry no attachment at all. Attachment count cannot separate
  them — the body does ("attachments appear to have been dropped" / "the draft BL is
  still missing"). Gate now returns a `nothing_to_compare` sentinel that reports a clean
  OK, instead of escalating 91 emails as false alarms.
- **2026-09-20** — Task 4 verified Averis.pdf's ordering bug is fixed: all 10 readable
  PDF Shipping Instructions (headed `BILL OF LADING INSTRUCTION`) detect as SI, zero
  misdetections. Implementer also corrected my stale count — there are 13 `*_SI.pdf`
  files, not 14, of which 3 are the image-only scans.
- **2026-09-20** — Label map verified against the real corpus: 61 distinct label
  spellings resolve to the 7 canonical fields; the 53 ignored ones are all genuinely
  irrelevant (Freight, HS Code, Vessel, Voyage, Booking Ref).
- **2026-09-20** — Task 6 implementer reported BLOCKED rather than patching around a
  spec contradiction, which was the right call and surfaced three real PDF-layout
  defects: values ran past non-field labels like `Ocean Vessel`; PDFs collapse a label
  onto its value with no separator (`Consignee (Non-Negotiable) BALL & DOGGETT...`),
  which was costing 5 attachments their consignee; and a PDF font without a ToUnicode
  map extracts the CJK weight label as literal `II`, affecting 8 documents. All fixed.
  Text-field extraction now covers **1189/1210 = 98.3%**, with every remaining gap
  intentional.

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
| 3 | Ingestion — docx and xlsx | ⏳ in progress | — | — |
| 4 | Doc-type detection + gates | ⬜ pending | — | — |
| 5 | Label normalisation | ⬜ pending | — | — |
| 6 | Linear + block extractors | ⬜ pending | — | — |
| 7 | Numeric extraction | ⬜ pending | — | — |
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

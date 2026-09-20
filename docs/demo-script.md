# Demo Video Script — Shipping Document Verification

**Target length: under 5 minutes.** One mark is deducted per 30 seconds over.

**Live demo URL:** https://sibl-seven.vercel.app
**Repository:** https://github.com/HongHanTan/SIBL

> **Accuracy note for whoever records this.** Every number below is real and
> reproducible from `docs/scores.md` and the live `/api/stats` endpoint. Two
> things this dataset does *not* show, so do not claim them: the L4 adjudicator
> never fired (no comparison landed in the similarity gray band), and Firestore
> is implemented but inactive on the current deployment. Both are described
> accurately in the wording below — keep it that way. A judge can click
> Evidence and see `Model calls (L4): 0`.

---

## 0:00–0:20 — Intro

> "Hi, we're [team name], and this is Shipping Document Verification. It reads a
> shipping operations inbox and automatically checks draft Bills of Lading
> against their Shipping Instructions, catching wrong details before a document
> is finalised."

---

## 0:20–0:50 — The Problem

> "A shipping operations team gets everything in one inbox — document checks,
> new shipping instruction requests, invoice queries, general updates, spam.
> For a document check, a human opens two files and compares seven fields:
> shipper, consignee, notify party, load port, discharge port, container count,
> and gross weight. It is repetitive, easy to get wrong, and the same field is
> labelled differently in each document — 'Port of Loading' in one, 'Load Port'
> in the other. A missed discrepancy means corrections and delays."

---

## 0:50–1:20 — Tech Stack

> "The pipeline is Python. Gemini 3.5 Flash-Lite classifies all 520 emails into
> five categories and is available to adjudicate borderline field comparisons.
> Everything else is deterministic code — PyMuPDF, python-docx and openpyxl for
> the four attachment formats, and a layered comparison ladder for the matching.
> The principle is: the model classifies and assists, but code decides. The demo
> runs on Vercel; a Cloud Run deployment is committed and ready as well."

---

## 1:20–3:30 — Live Demo

**Open https://sibl-seven.vercel.app**

### Inbox — 1:20–1:45
> "520 emails, every one classified. 199 are document comparisons, and you can
> see the funnel narrowing. Each row shows its category, how many attachments it
> carried, and the outcome — OK, MISMATCH, or NEEDS_REVIEW."

**Scroll so several MISMATCH rows are visible.**

### Discrepancy report — 1:45–2:30
**Click `email_004`.**

> "This is the report. SI value against BL value across all seven fields.
> Consignee and notify party are flagged: the Shipping Instruction says
> EAST BRIGHT FZ-LLC, the draft Bill of Lading says UAB NOVAKOPA. Two different
> companies — but at an *identical address*. If you compare the whole name and
> address as one blob they look similar and this defect slips through. We compare
> the company name first, so address agreement alone can never carry a match."

**Click `email_013` to show a different defect field (`port_of_discharge`).**

### Evidence trace — 2:30–3:00
> "The Evidence tab shows how each field was decided — which layer resolved it
> and at what similarity. Most resolve at L1, plain canonicalisation: dropping
> legal suffixes and country names. Numbers never touch the model at all; they
> are parsed and compared exactly. That is what makes every result auditable."

### Review queue — 3:00–3:30
> "When the system cannot decide, it escalates instead of guessing. 18 cases are
> here with their reason — a wrong document type, a missing attachment, an
> unreadable scan. A reviewer confirms or corrects, and that decision is recorded
> as a learned alias for future runs."

**Click a decision button and show the confirmation.**

---

## 3:30–3:55 — Compare live

**Open the Compare tab. Upload a Shipping Instruction and a draft Bill of Lading.**

> "Everything so far was the inbox. This runs the same pipeline live. I upload
> two documents — in any order, because the system reads each document's own
> header to work out which is which; the filenames in this dataset actually lie.
> And the result comes back immediately, because this path never calls a model.
> Extraction and comparison are deterministic code."

**Point at the Decided-by column.**

> "Every field shows which layer settled it. Nothing here is a black box."

---

## 3:55–4:25 — What Made It Hard

> "Three things in the real data nearly broke this. Every PDF Shipping
> Instruction is headed 'BILL OF LADING INSTRUCTION' — match on 'Bill of Lading'
> first and you misread every one of them as a Bill of Lading and lose those
> comparisons silently."

> "Fifty-one files label gross weight with Chinese characters spliced into the
> middle of the label. And 94 comparison emails arrive with no attachment at all,
> yet only five are genuinely missing one — the difference is in the sender's own
> wording, not the attachment count. Escalating all 94 would have made the system
> cry wolf."

---

## 4:25–4:55 — Results and Impact

> "Final score 0.9734 against the held-out reference set. The system catches 45
> of 46 real defects with zero false positives — precision 1.00, so it never
> raises a false alarm. Classification macro-F1 is 0.955."

> "The part we are proudest of: the deterministic core alone scores 0.978 on the
> end-to-end axis before the model is involved at all. That means the result is
> explainable field by field, not a black box — and when it cannot decide, it
> says so rather than guessing."

---

## Timing Budget

| Segment | Duration |
|---|---|
| Intro | 20s |
| Problem | 30s |
| Tech stack | 30s |
| Live demo (inbox, report, evidence, review) | 2m 10s |
| Compare live — upload two documents | 25s |
| What made it hard | 30s |
| Results and impact | 30s |
| **Total** | **4m 55s** |

Only five seconds of headroom now. If you run long, cut the second MISMATCH
click at 2:30 — `email_004` alone carries the point — and trim the review queue
beat to a single sentence.

---

## Numbers you can state on camera

All verifiable from `docs/scores.md` or the live `/api/stats`:

- 520 emails classified, 199 routed as document comparisons
- 47 mismatches found, 18 cases escalated for human review
- Final score **0.9734** — end-to-end 0.978, stage-3 F1 0.989, stage-1 F1 0.955
- 45 of 46 defects caught, **precision 1.00**
- Reliability 0.947: wrong document type 5/5, missing attachment 5/5, unreadable 5/5
- Score progression 0.0124 → 0.7465 (no model) → 0.9734 (with classification)

## Do not claim

- That the L4 model adjudicator ran — it did not fire on this dataset
- That the alias table demonstrably reduced model calls — not exercised here
- That Firestore is persisting decisions on the live deployment — it needs
  service-account credentials that are not configured

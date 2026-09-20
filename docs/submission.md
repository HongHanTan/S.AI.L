# Submission Pack

Everything needed for the Google Form at https://forms.gle/nnam5eXrf5cjXdf3
**Deadline: 22 September 2026, 12:00pm.**

---

## Links

| Field | Value |
|---|---|
| GitHub repository | https://github.com/HongHanTan/SIBL |
| Live prototype | https://sibl-seven.vercel.app |
| Slide deck / documentation | https://github.com/HongHanTan/SIBL/blob/main/docs/architecture.md |
| Video demo | *record from [`demo-script.md`](demo-script.md), then paste the link* |

---

## Project name

**Shipping Document Verification** — or a team-chosen name; the form asks for one.

---

## Project description (short — paste into the form)

Shipping operations teams receive document-check requests, new shipping
instruction requests, invoice queries, operational updates and spam in a single
inbox. For each check, a person opens two documents and compares seven fields by
hand, across documents that label the same field differently — "Port of Loading"
in one, "Load Port" in the other. It is repetitive, easy to get wrong, and a
missed discrepancy causes corrections and shipping delays.

This system reads the inbox end to end. Gemini classifies all 520 emails into
five categories; deterministic Python then ingests the attachments (.txt, .pdf,
.docx, .xlsx), works out which document is the Shipping Instruction and which is
the draft Bill of Lading, extracts seven shipment fields, and compares them
through a layered ladder that absorbs harmless formatting differences while
surfacing real defects. When it cannot decide — an unreadable scan, a wrong
document, a missing value — it escalates to a human with the evidence and the
reason, rather than guessing.

It scores **0.9734** against the organisers' held-out reference set, catching
**45 of 46 defects with zero false positives**. The guiding principle is that the
model classifies and assists, but code decides: the deterministic core alone
reaches 0.978 on the end-to-end axis, which keeps every result explainable field
by field instead of being a black box.

---

## Project description (longer — if the form allows more)

**The problem.** A shipping operations team receives mixed traffic in one inbox.
Finding the document-check requests takes time, and an overlooked request never
reaches the checking step at all. For each request, staff compare a Shipping
Instruction against a draft Bill of Lading across seven fields — shipper,
consignee, notify party, port of loading, port of discharge, container count and
gross weight. The same information looks different in each document, so the
comparison cannot be a string match.

**What we built.** A seven-stage pipeline from inbox to discrepancy report:

1. **Classify** — Gemini 3.5 Flash-Lite sorts all 520 emails into BL_COMPARISON,
   SI_REQUEST, INVOICE_QUERY, GENERAL or SPAM. Subjects are deliberately
   misleading in this dataset, so the body and attachments carry the real signal.
2. **Ingest** — four format handlers turn attachments into text: PyMuPDF for
   PDFs, python-docx, openpyxl, and plain text.
3. **Gate** — the document's own header decides whether it is a Shipping
   Instruction or a Bill of Lading, never the filename. Missing attachments,
   wrong document types and unreadable scans are caught here.
4. **Extract** — 61 observed label spellings collapse onto seven canonical
   fields. Container counts and weights are cross-checked between summary lines
   and container tables.
5. **Compare** — a ladder that escalates only as far as it must: exact numeric
   comparison, then canonicalisation, a learned alias table, similarity banding,
   and finally model adjudication for a narrow band of genuinely ambiguous pairs.
6. **Roll up** — OK, MISMATCH with the offending fields named, or NEEDS_REVIEW
   with a reason.
7. **Report** — a web application showing the inbox, a side-by-side discrepancy
   report, a per-field decision trace, a human review queue, and a **Compare**
   tab that runs the same pipeline live on two uploaded documents.

**Results.** Final score 0.9734: end-to-end defect catching 0.978, stage-3
defect F1 0.989 at precision 1.00, classification macro-F1 0.955. Reliability
0.947 with escalation precision 1.00 — it never asks for help it does not need.

**What makes it different.** Four things.

First, **numbers never reach a language model.** They are parsed and compared
exactly, because arithmetic is where models invent errors.

Second, **company names are compared before addresses.** The dataset contains
two genuinely different companies at an identical address — whole-field matching
scores that as a match and misses a real defect.

Third, **a reading problem is never reported as a discrepancy.** An unreadable
scan or a wrong document escalates to a person with the evidence, instead of
producing a confident wrong answer.

Fourth, **the deployed demo is not a screenshot of a result.** Upload any
Shipping Instruction and draft Bill of Lading, in either order, and it runs the
real pipeline and reports back immediately — no model call, so it cannot be
slowed or broken by an API quota.

---

## Technologies used

Python 3.14 · Google Gemini (`gemini-3.5-flash-lite`) · FastAPI · PyMuPDF ·
python-docx · openpyxl · Vercel (live demo) · Cloud Run + Firestore
(implemented, deployment-ready) · pytest (199 tests)

---

## Pre-submission checklist

- [ ] Video recorded, under 5 minutes
- [ ] Video set to **unlisted or public** on YouTube — private is rejected.
      If using Google Drive, share as "Anyone with the link → Viewer"
- [ ] Live prototype URL opens for someone not logged in
- [ ] GitHub repository is public
- [ ] Team name and representative details filled in
- [ ] Submitted before 22 Sep 2026, 12:00pm

## After the hackathon

- [ ] Rotate the Gemini API key — it was shared during development

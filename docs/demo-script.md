# Demo Video Script — Shipping Document Verification

**Target length: under 5 minutes** (1 mark deducted per 30s over)

---

## 0:00–0:20 — Intro

> "Hi, we're [team name]. We built a system that automatically verifies shipping documents — comparing Shipping Instructions against draft Bills of Lading to catch discrepancies before they cause costly corrections."

---

## 0:20–0:50 — The Problem

> "A shipping operations team receives 520 emails in one inbox — document-check requests mixed with SI requests, invoice queries, general updates, and spam. Only about 126 of those carry the actual documents to compare. Staff manually open each pair, check seven fields — shipper, consignee, notify party, two ports, container count, and gross weight — and flag any mismatch. It's repetitive, error-prone, and a missed discrepancy means shipping delays."

---

## 0:50–1:20 — Tech Stack

> "Our pipeline is built in Python. Gemini 3.5 Flash-Lite handles classification — sorting 520 emails into five categories — and adjudicates close calls in document comparison. The extraction and comparison logic is deterministic Python code: PyMuPDF for PDFs, python-docx and openpyxl for other formats. The web demo runs on Cloud Run with FastAPI, and Firestore persists human review decisions across container restarts."

---

## 1:20–3:40 — Live Demo

**Show: the live Cloud Run URL**

### Inbox (1:20–1:50)
> "Here's the inbox. 520 emails, each classified. You can see BL_COMPARISON, SI_REQUEST, INVOICE_QUERY, GENERAL, and SPAM. The status column shows OK, MISMATCH, or NEEDS_REVIEW."

**Click a category filter to show BL_COMPARISON emails.**

### Discrepancy Report (1:50–2:30)
> "Let me click on a MISMATCH email. Here's the side-by-side report — the SI value and BL value for each of the seven fields. The consignee is flagged: the SI says 'EAST BRIGHT FZ-LLC' but the BL says 'UAB NOVAKOPA'. That's a real defect the system caught."

**Click a second MISMATCH to show a different defect field.**

### Evidence Trace (2:30–3:10)
> "The Evidence tab shows *how* the system decided. For each field, you can see which layer made the call — L1 canonicalization, L2 alias lookup, L3 similarity, or L4 Gemini adjudication — plus the similarity score. Most fields resolve at L1; only the tricky ones escalate to L4."

### Review Queue (3:10–3:40)
> "The Review queue shows cases the system couldn't decide on its own. Here's one with reason 'missing_value'. For cases with field comparisons, a reviewer can confirm 'Same entity' or 'Different', and that decision feeds back into the alias table for future runs."

**Click 'Same entity' on a field and show the confirmation.**

---

## 3:40–4:20 — The Learning Loop

> "Every confirmed match or correction enters the alias table. On the next run, that pair resolves at L2 — no API call needed. We can demonstrate this: before promotion, the pipeline makes N L4 calls. After promotion, fewer calls, same score."

> "Two data traps worth mentioning: every PDF Shipping Instruction is headed 'BILL OF LADING INSTRUCTION' — naïve matching would have destroyed all PDF comparisons. And 94 comparison emails carry no attachment at all, but only 5 are genuinely 'missing attachment' — the sender's wording is the real signal."

---

## 4:20–4:50 — Impact and Results

> "Our final score: [X.XX]. The deterministic pipeline catches 45 of 46 defects with zero false positives. Stage-3 defect F1 is 0.989 with perfect precision. Classification accuracy jumped from 0.199 to [final] when Gemini came online."

> "Manual comparison time for 126 document pairs: eliminated. Every decision is traceable, every escalation is explained, and the system gets smarter with each human review."

---

## Timing Budget

| Segment | Duration |
|---|---|
| Intro | 20s |
| Problem | 30s |
| Tech stack | 30s |
| Live demo | 2m 20s |
| Learning loop | 40s |
| Impact | 30s |
| **Total** | **4m 50s** |

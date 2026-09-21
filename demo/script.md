# Two-Minute Demo Script

This script is synced with [demoflow.md](demoflow.md). Text in brackets is an action, not something to say aloud.

## 1 — 0:00–0:12 · Overview

> Checking hundreds of emails manually is slow, and one small mistake can delay a shipment. So our prototype sorts the inbox, then sends the actual SI and draft BL checks for verification.

`[Point to 520 emails and the result breakdown. Click Inbox.]`

## 2 — 0:12–0:30 · Real discrepancy

> Here’s one example. The system compares seven important fields and shows the exact problem. Everything matches except the gross weight: the SI says 20,842 kilos, while the draft BL says 21,342. It flags the mismatch and keeps both values as evidence.

`[Search email_121, open it, and point to the gross-weight row.]`

## 3 — 0:30–0:45 · Safe human escalation

> The system also knows when not to decide. In email 509, only the Shipping Instruction arrived, and the sender says the draft Bill of Lading is still missing. Instead of inventing a comparison, it stops with NEEDS REVIEW and gives the operator the exact reason.

`[Search email_509. Point to NEEDS_REVIEW, the one attachment, and missing_attachment. Click Try an email.]`

## 4 — 0:45–1:12 · PDF and label understanding

> Now I’ll upload two PDFs. The SI calls this field “Load Port”, while the draft BL calls it “Port of Loading”. The wording is different, but both mean the same thing. The system maps them to one field, reads the same Port Klang value, and detects the Malaysia-to-Indonesia route.

`[Preview the two labels, point to EVERGREEN and MY → ID, then click Process email.]`

## 5 — 1:12–1:43 · Main result

> Now, this is important. All seven fields match, so the document result is OK. But okay does not always mean ready to ship. Our Indonesia rule requires a local consignee and a labelled NPWP tax ID. This consignee is in Dubai and has no NPWP, so compliance is blocked. The reason and next action are shown here.

`[Point to OK, then BLOCK, then the two findings.]`

## 6 — 1:43–1:55 · Metrics and results

> On the held-out evaluation, our final score was 0.9734. We caught 45 of 46 real defects with precision 1.00, meaning zero false-positive defects, while 18 uncertain cases were safely escalated for human review.

`[Keep the document OK and compliance BLOCK results visible.]`

## 7 — 1:55–2:00 · Close

> We catch mismatches, stop safely when evidence is missing, and check destination requirements before submission.

`[Stop. Keep the OK and BLOCK results on screen.]`

## Emergency short closing

Use this only if fewer than five seconds remain:

> The documents match, but compliance still blocks the shipment. That is the gap our prototype catches before submission.

# Scoreboard log

Every row is one submission. Record what changed, so a score movement is
attributable to a specific decision.

| # | Change | final_score | Stage-1 F1 | Stage-3 F1 | Notes |
|---|---|---|---|---|---|
| 1 | baseline, everything GENERAL | 0.0124 | | | proves the submit loop |
| 2 | deterministic pipeline, heuristic classifier | 0.7465 | 0.1985 | 0.9890 | statuses={'OK': 458, 'MISMATCH': 47, 'NEEDS_REVIEW': 15}; classifier only reaches 126/220 BL_COMPARISON emails (heuristic: has attachments -> BL_COMPARISON), so stage-1 F1 stays weak while stage-3 and end-to-end rise sharply |
| 3 | Gemini classification (gemini-3.5-flash-lite), rate-limit aware | 0.9743 | 0.9578 | 0.9890 | stage1 0.199 -> 0.958; reliability 0.857 -> 0.947 (missing_attachment 2/5 -> 5/5); end-to-end 45/46 unchanged; 30 model calls |
| 4 | schema-constrained classification output | 0.9734 | 0.9550 | 0.9890 | model decoding restricted to the category enum, so malformed JSON and invalid categories become impossible rather than handled; 26 calls, 0 parse failures. Score moved -0.0009, within run-to-run variance |

# Scoreboard log

Every row is one submission. Record what changed, so a score movement is
attributable to a specific decision.

| # | Change | final_score | Stage-1 F1 | Stage-3 F1 | Notes |
|---|---|---|---|---|---|
| 1 | baseline, everything GENERAL | 0.0124 | | | proves the submit loop |
| 2 | deterministic pipeline, heuristic classifier | 0.7465 | 0.1985 | 0.9890 | statuses={'OK': 458, 'MISMATCH': 47, 'NEEDS_REVIEW': 15}; classifier only reaches 126/220 BL_COMPARISON emails (heuristic: has attachments -> BL_COMPARISON), so stage-1 F1 stays weak while stage-3 and end-to-end rise sharply |

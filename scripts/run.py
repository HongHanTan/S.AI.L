"""Run the pipeline and optionally score it.

    python scripts/run.py                         # build submission.json only
    python scripts/run.py http://localhost:8080   # build and score
"""
import sys

from sdoc.config import SETTINGS
from sdoc.pipeline import run
from sdoc.submit import build_submission, post_submission, write_submission
from sdoc.trace import layer_counts, write_traces


def heuristic_classifier(email: dict) -> str:
    """Placeholder until Task 12 replaces this with Gemini."""
    return "BL_COMPARISON" if email.get("attachments") else "GENERAL"


results = run(SETTINGS, heuristic_classifier)
submission = build_submission(results)
write_submission(submission)
write_traces(results)

counts: dict[str, int] = {}
for r in results:
    counts[r.status] = counts.get(r.status, 0) + 1
print(f"{len(submission)} entries; statuses={counts}; layers={layer_counts(results)}")

if len(sys.argv) > 1:
    print(post_submission(submission, sys.argv[1]))

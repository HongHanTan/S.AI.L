"""Run the pipeline and optionally score it.

    set GEMINI_API_KEY=...
    python scripts/run.py                         # build submission.json only
    python scripts/run.py http://localhost:8080   # build and score
"""
import sys

from sdoc.classify import classify_all, make_classifier
from sdoc.config import SETTINGS
from sdoc.gemini import GeminiClient
from sdoc.inbox import load_emails
from sdoc.pipeline import run
from sdoc.submit import build_submission, post_submission, write_submission
from sdoc.trace import layer_counts, write_traces

client = GeminiClient()
emails = load_emails(SETTINGS.data_dir)

mapping = classify_all(emails, client, settings=SETTINGS)
classifier = make_classifier(mapping)

results = run(SETTINGS, classifier)
submission = build_submission(results)
write_submission(submission)
write_traces(results)

statuses: dict[str, int] = {}
categories: dict[str, int] = {}
for r in results:
    statuses[r.status] = statuses.get(r.status, 0) + 1
    categories[r.category] = categories.get(r.category, 0) + 1

print(f"{len(submission)} entries")
print(f"categories={categories}")
print(f"statuses={statuses}")
print(f"layers={layer_counts(results)} gemini_calls={client.calls}")

if len(sys.argv) > 1:
    print(post_submission(submission, sys.argv[1]))

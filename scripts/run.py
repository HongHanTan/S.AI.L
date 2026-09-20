"""Run the pipeline and optionally score it.

    set GEMINI_API_KEY=...
    python scripts/run.py                         # build submission.json only
    python scripts/run.py http://localhost:8080   # build and score
"""
import sys

from sdoc.classify import classify_all, make_classifier
from sdoc.compare.adjudicate import make_adjudicator
from sdoc.config import SETTINGS
from sdoc.extract.llm import make_fallback
from sdoc.gemini import GeminiClient
from sdoc.inbox import load_emails
from sdoc.pipeline import run
from sdoc.submit import build_submission, post_submission, write_submission
from sdoc.trace import layer_counts, write_traces

client = GeminiClient()

if not client.api_key:
    print(
        "\n!! GEMINI_API_KEY is not set.\n"
        "!! Classification will fall back to GENERAL for every email and the\n"
        "!! score will collapse to the ~0.01 baseline. Set the key and re-run:\n"
        "!!     set GEMINI_API_KEY=<your key>        (Windows)\n"
        "!!     export GEMINI_API_KEY=<your key>     (bash)\n",
        file=sys.stderr,
    )

emails = load_emails(SETTINGS.data_dir)

mapping = classify_all(emails, client, settings=SETTINGS)
classifier = make_classifier(mapping)

# A degraded classifier is worth shouting about: every downstream axis depends
# on routing, so a silent fallback looks like a modelling failure rather than a
# missing credential.
routed = sum(1 for c in mapping.values() if c == "BL_COMPARISON")
if routed == 0:
    print("!! No email was classified BL_COMPARISON - classification failed.",
          file=sys.stderr)

results = run(
    SETTINGS,
    classifier,
    adjudicator=make_adjudicator(client),
    extract_fallback=make_fallback(client) if SETTINGS.use_llm_fallback else None,
)
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

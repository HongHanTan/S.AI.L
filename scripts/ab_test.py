"""Score every combination of the two tunable switches.

    python scripts/ab_test.py http://localhost:8080

Classification is cached per switch value, so this costs far fewer model calls
than four full runs.
"""
import itertools
import sys
from dataclasses import replace

from sdoc.classify import classify_all, make_classifier
from sdoc.compare.adjudicate import make_adjudicator
from sdoc.compare.alias import AliasStore
from sdoc.config import SETTINGS
from sdoc.extract.llm import make_fallback
from sdoc.gemini import GeminiClient
from sdoc.inbox import load_emails
from sdoc.pipeline import run
from sdoc.submit import build_submission, post_submission

server = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8080"
client = GeminiClient()
emails = load_emails(SETTINGS.data_dir)
alias_table = AliasStore().load(SETTINGS.alias_snapshot)

rows = []
for attachmentless, lean_same in itertools.product([False, True], [True, False]):
    settings = replace(SETTINGS,
                       attachmentless_is_comparison=attachmentless,
                       uncertain_lean_same=lean_same)
    mapping = classify_all(emails, client, settings=settings)
    results = run(settings, make_classifier(mapping),
                  adjudicator=make_adjudicator(client),
                  alias=alias_table,
                  extract_fallback=make_fallback(client))
    score = post_submission(build_submission(results), server)
    rows.append((attachmentless, lean_same, score.get("final_score")))
    print(f"attachmentless={attachmentless} lean_same={lean_same} "
          f"-> {score.get('final_score')}")

print("\nbest:", max(rows, key=lambda r: r[2] or 0))

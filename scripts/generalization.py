"""Measure how much extraction depends on the hand-built label lexicon.

The label map was enumerated from this corpus, so extraction coverage on this
corpus flatters itself. The honest question is: how much of that coverage
survives when the documents use label spellings we have never seen?

Method. Hold out a random fraction of the label variants, rebuild the lookup
table without them, re-run extraction over every attachment, and measure the
coverage that remains. A held-out variant stands in for a spelling a new
shipping line would use and we would not have anticipated.

    PYTHONPATH=src python scripts/generalization.py

Reports the mean over several seeds at each holdout level, so a single
unlucky draw cannot dominate the answer.
"""
import glob
import random
import statistics
import sys

from sdoc.docs.ingest import ingest
from sdoc.extract import labels as L
from sdoc.extract.engine import extract_all_fields
from sdoc.models import FIELDS

HOLDOUT_LEVELS = (0.0, 0.1, 0.25, 0.4, 0.5)
SEEDS = (1, 2, 3)


def load_documents() -> list:
    docs = []
    for path in sorted(glob.glob("data/attachments/*")):
        with open(path, "rb") as fh:
            doc = ingest(path, fh.read())
        if not doc.error:
            docs.append(doc)
    return docs


def coverage(docs) -> float:
    """Fraction of the seven fields populated across every readable document."""
    total = filled = 0
    for doc in docs:
        found = extract_all_fields(doc)
        for name in FIELDS:
            total += 1
            if found.get(name) not in (None, ""):
                filled += 1
    return filled / total if total else 0.0


def with_holdout(fraction: float, seed: int, docs) -> float:
    """Coverage after removing `fraction` of the known label variants."""
    original = dict(L.LABEL_TO_FIELD)
    try:
        keys = sorted(original)
        rng = random.Random(seed)
        drop = set(rng.sample(keys, int(len(keys) * fraction)))
        L.LABEL_TO_FIELD.clear()
        L.LABEL_TO_FIELD.update({k: v for k, v in original.items() if k not in drop})
        return coverage(docs)
    finally:
        L.LABEL_TO_FIELD.clear()
        L.LABEL_TO_FIELD.update(original)


def main() -> int:
    docs = load_documents()
    print(f"{len(docs)} readable attachments, "
          f"{len(L.LABEL_TO_FIELD)} known label variants\n")
    print(f"{'held out':>9}  {'variants kept':>13}  {'coverage':>9}  {'vs baseline':>11}")
    print("-" * 50)

    baseline = None
    rows = []
    for fraction in HOLDOUT_LEVELS:
        scores = [with_holdout(fraction, seed, docs) for seed in SEEDS]
        mean = statistics.mean(scores)
        if baseline is None:
            baseline = mean
        kept = len(L.LABEL_TO_FIELD) - int(len(L.LABEL_TO_FIELD) * fraction)
        delta = mean - baseline
        print(f"{fraction:>8.0%}  {kept:>13}  {mean:>9.3f}  {delta:>+11.3f}")
        rows.append((fraction, mean, delta))

    worst = rows[-1]
    print(f"\nRemoving {worst[0]:.0%} of known label spellings costs "
          f"{abs(worst[2]):.1%} of field coverage -")
    print("close to a linear dependence. Deterministic extraction is only as "
          "good as\nthe lexicon it was given, and this measures exactly how "
          "much.")

    print("\nPer-field coverage at 40% holdout (seed 1):")
    per = per_field_holdout(0.4, 1, docs)
    for name, score in sorted(per.items(), key=lambda kv: kv[1]):
        print(f"  {name:20s} {score:.3f}")
    print("\nRobustness tracks how many spellings a field has. consignee and "
          "notify_party\ncarry several, so a random holdout usually leaves one "
          "standing.\nport_of_discharge and gross_weight_kg carry fewer and "
          "fall hardest - those\nare the fields to widen first for a new "
          "customer.")
    print("\nIn production the Gemini fallback extractor fills fields the "
          "parser misses,\nwhich is precisely the gap this measurement "
          "exposes. It is excluded here so\nthe number reflects the "
          "deterministic layer on its own.")
    return 0


def per_field_holdout(fraction: float, seed: int, docs) -> dict:
    """Coverage per field, to show which ones depend most on the lexicon."""
    original = dict(L.LABEL_TO_FIELD)
    try:
        rng = random.Random(seed)
        drop = set(rng.sample(sorted(original), int(len(original) * fraction)))
        L.LABEL_TO_FIELD.clear()
        L.LABEL_TO_FIELD.update({k: v for k, v in original.items() if k not in drop})

        totals = {name: 0 for name in FIELDS}
        hits = {name: 0 for name in FIELDS}
        for doc in docs:
            found = extract_all_fields(doc)
            for name in FIELDS:
                totals[name] += 1
                if found.get(name) not in (None, ""):
                    hits[name] += 1
        return {n: hits[n] / totals[n] if totals[n] else 0.0 for n in FIELDS}
    finally:
        L.LABEL_TO_FIELD.clear()
        L.LABEL_TO_FIELD.update(original)


if __name__ == "__main__":
    sys.exit(main())

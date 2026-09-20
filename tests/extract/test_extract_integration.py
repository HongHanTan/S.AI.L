from pathlib import Path

import pytest

from sdoc.docs.ingest import ingest
from sdoc.extract.engine import extract_all_fields
from sdoc.models import FIELDS

DATA = Path("data")
pytestmark = pytest.mark.skipif(not DATA.exists(), reason="data/ bundle absent")


@pytest.mark.integration
def test_deterministic_extraction_covers_most_fields():
    """Report coverage so regressions are visible. The threshold is deliberately
    loose — the Gemini fallback in Task 12 closes the remainder."""
    total = filled = 0
    gaps: dict[str, int] = {}
    for p in sorted((DATA / "attachments").iterdir()):
        doc = ingest(str(p), p.read_bytes())
        if doc.error:
            continue
        got = extract_all_fields(doc)
        for name in FIELDS:
            total += 1
            if got.get(name):
                filled += 1
            else:
                gaps[name] = gaps.get(name, 0) + 1
    coverage = filled / total
    print(f"\ncoverage={coverage:.3f} gaps={sorted(gaps.items(), key=lambda x: -x[1])}")
    assert coverage > 0.90, f"coverage {coverage:.3f} too low; gaps={gaps}"

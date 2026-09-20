from pathlib import Path

import pytest

from sdoc.docs.ingest import ingest

DATA = Path("data")
pytestmark = pytest.mark.skipif(not DATA.exists(), reason="data/ bundle absent")


@pytest.mark.integration
def test_every_attachment_ingests_without_error():
    failures = []
    for p in sorted((DATA / "attachments").iterdir()):
        doc = ingest(str(p), p.read_bytes())
        if doc.error:
            failures.append((p.name, doc.error))
    assert failures == [], f"{len(failures)} attachments failed: {failures[:10]}"


@pytest.mark.integration
def test_attachment_count_matches_expectation():
    assert len(list((DATA / "attachments").iterdir())) == 250

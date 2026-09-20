from pathlib import Path

import pytest

from sdoc.docs.ingest import ingest

DATA = Path("data")
pytestmark = pytest.mark.skipif(not DATA.exists(), reason="data/ bundle absent")


# Eight attachments are deliberately unreadable — two structurally invalid
# PDFs and six image-only scans. Erroring on these is CORRECT: the gate turns
# them into NEEDS_REVIEW/unreadable, which is what the reference set expects.
EXPECTED_UNREADABLE = {
    "email_511_BL.pdf", "email_515_BL.pdf",          # invalid PDF structure
    "email_512_SI.pdf", "email_512_BL.pdf",          # image-only scans
    "email_513_SI.pdf", "email_513_BL.pdf",
    "email_514_SI.pdf", "email_514_BL.pdf",
}


@pytest.mark.integration
def test_only_the_known_bad_attachments_fail_to_ingest():
    failures = set()
    for p in sorted((DATA / "attachments").iterdir()):
        doc = ingest(str(p), p.read_bytes())
        if doc.error:
            failures.add(p.name)
    assert failures == EXPECTED_UNREADABLE, (
        f"unexpected failures: {sorted(failures - EXPECTED_UNREADABLE)}; "
        f"unexpectedly clean: {sorted(EXPECTED_UNREADABLE - failures)}")


@pytest.mark.integration
def test_attachment_count_matches_expectation():
    assert len(list((DATA / "attachments").iterdir())) == 250

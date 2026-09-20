from sdoc.models import EmailResult
from sdoc.submit import build_submission


def test_general_email_entry_shape():
    r = EmailResult(email_id="email_001", category="GENERAL")
    assert r.to_submission_entry() == {
        "category": "GENERAL",
        "status": "OK",
        "review_reason": None,
        "defect_fields": [],
        "has_defect": False,
    }


def test_mismatch_entry_sets_defect_flag():
    r = EmailResult(
        email_id="email_004",
        category="BL_COMPARISON",
        status="MISMATCH",
        defect_fields=["consignee", "notify_party"],
    )
    entry = r.to_submission_entry()
    assert entry["has_defect"] is True
    assert entry["defect_fields"] == ["consignee", "notify_party"]
    assert entry["review_reason"] is None


def test_needs_review_entry_carries_reason():
    r = EmailResult(
        email_id="email_507",
        category="BL_COMPARISON",
        status="NEEDS_REVIEW",
        review_reason="missing_attachment",
    )
    entry = r.to_submission_entry()
    assert entry["status"] == "NEEDS_REVIEW"
    assert entry["review_reason"] == "missing_attachment"
    assert entry["has_defect"] is False


def test_build_submission_is_keyed_by_email_id():
    results = [
        EmailResult(email_id="email_002", category="SPAM"),
        EmailResult(email_id="email_001", category="GENERAL"),
    ]
    sub = build_submission(results)
    assert set(sub) == {"email_001", "email_002"}
    assert sub["email_002"]["category"] == "SPAM"

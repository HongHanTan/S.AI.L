import pytest

from sdoc.adhoc import UploadError, compare_uploads

SI = """SHIPPING INSTRUCTION
========================================

Shipper: APRIL FAR EAST (M) SDN BHD
Consignee (Non-Negotiable): EAST BRIGHT FZ-LLC
Notify: EAST BRIGHT FZ-LLC
Port of Loading (POL): NANTONG, CHINA (CNNTG)
POD: KARACHI, PAKISTAN (PKKHI)
Total Containers: 6 x 40'HC
Gross Wt (kgs): 131,058 KG
"""

BL_MATCHING = SI.replace("SHIPPING INSTRUCTION", "BILL OF LADING (DRAFT)")

BL_WRONG_CONSIGNEE = BL_MATCHING.replace(
    "Consignee (Non-Negotiable): EAST BRIGHT FZ-LLC",
    "To the Order of: UAB NOVAKOPA")

BL_WRONG_COUNT = BL_MATCHING.replace("Total Containers: 6 x 40'HC",
                                     "Container Count: 4 x 40'HC")

BL_MISSING_POD = BL_MATCHING.replace("POD: KARACHI, PAKISTAN (PKKHI)\n", "")

PACKING_LIST = "PACKING LIST\n====\nShipper: APRIL FAR EAST (M) SDN BHD\n"


def up(name, text):
    return (name, text.encode("utf-8"))


def test_matching_documents_report_no_mismatch():
    got = compare_uploads([up("si.txt", SI), up("bl.txt", BL_MATCHING)])
    assert got["status"] == "OK"
    assert got["defect_fields"] == []
    assert len(got["verdicts"]) == 7


def test_consignee_mismatch_is_flagged():
    got = compare_uploads([up("si.txt", SI), up("bl.txt", BL_WRONG_CONSIGNEE)])
    assert got["status"] == "MISMATCH"
    assert "consignee" in got["defect_fields"]


def test_container_count_mismatch_is_flagged():
    got = compare_uploads([up("si.txt", SI), up("bl.txt", BL_WRONG_COUNT)])
    assert got["status"] == "MISMATCH"
    assert got["defect_fields"] == ["container_count"]


def test_roles_are_detected_so_upload_order_does_not_matter():
    """The user should not have to say which file is which."""
    forward = compare_uploads([up("a.txt", SI), up("b.txt", BL_WRONG_CONSIGNEE)])
    reversed_ = compare_uploads([up("b.txt", BL_WRONG_CONSIGNEE), up("a.txt", SI)])
    assert forward["status"] == reversed_["status"] == "MISMATCH"
    assert forward["defect_fields"] == reversed_["defect_fields"]
    assert forward["si_filename"] == reversed_["si_filename"] == "a.txt"


def test_wrong_document_type_is_explained():
    got = compare_uploads([up("si.txt", SI), up("pl.txt", PACKING_LIST)])
    assert got["status"] == "NEEDS_REVIEW"
    assert got["review_reason"] == "wrong_doc_type"
    assert "Shipping Instruction" in got["notes"][0]


def test_missing_field_escalates_rather_than_reporting_a_defect():
    got = compare_uploads([up("si.txt", SI), up("bl.txt", BL_MISSING_POD)])
    assert got["status"] == "NEEDS_REVIEW"
    assert got["review_reason"] == "missing_value"
    assert got["defect_fields"] == []


def test_unreadable_document_escalates():
    got = compare_uploads([up("si.txt", SI), ("scan.pdf", b"%PDF-1.4 broken")])
    assert got["status"] == "NEEDS_REVIEW"
    assert got["review_reason"] == "unreadable"


def test_two_shipping_instructions_is_wrong_doc_type():
    got = compare_uploads([up("a.txt", SI), up("b.txt", SI)])
    assert got["review_reason"] == "wrong_doc_type"


def test_exactly_two_files_are_required():
    with pytest.raises(UploadError):
        compare_uploads([up("si.txt", SI)])
    with pytest.raises(UploadError):
        compare_uploads([up("a.txt", SI), up("b.txt", BL_MATCHING), up("c.txt", SI)])


def test_empty_upload_is_rejected():
    with pytest.raises(UploadError):
        compare_uploads([("si.txt", b""), up("bl.txt", BL_MATCHING)])


def test_oversized_upload_is_rejected():
    with pytest.raises(UploadError):
        compare_uploads([("big.txt", b"x" * (11 * 1024 * 1024)),
                         up("bl.txt", BL_MATCHING)])


def test_no_model_is_ever_called():
    """The upload path must stay offline so a quota cannot break the demo."""
    got = compare_uploads([up("si.txt", SI), up("bl.txt", BL_WRONG_CONSIGNEE)])
    assert all(v["decided_by"] in ("gate1", "L1", "L2", "L3")
               for v in got["verdicts"]), got["verdicts"]


# --- full typed-email path -------------------------------------------------

from sdoc.adhoc import process_typed_email  # noqa: E402


def fixed(category):
    """A stand-in classifier, so these tests never touch the network."""
    return lambda email: category


def test_typed_email_runs_the_full_pipeline_and_finds_a_defect():
    got = process_typed_email(
        subject="TO CONFIRM DOCS _ 5ALT-01226",
        body="Please check the attached SI and draft BL and confirm.",
        files=[up("a.txt", SI), up("b.txt", BL_WRONG_CONSIGNEE)],
        classifier=fixed("BL_COMPARISON"),
    )
    assert got["category"] == "BL_COMPARISON"
    assert got["status"] == "MISMATCH"
    assert "consignee" in got["defect_fields"]


def test_typed_email_classified_away_skips_comparison():
    got = process_typed_email(
        subject="Increase your shipping revenue with this ONE weird trick",
        body="Click here now.",
        files=[],
        classifier=fixed("SPAM"),
    )
    assert got["category"] == "SPAM"
    assert got["status"] == "OK"
    assert got["verdicts"] == []


def test_typed_email_claiming_a_dropped_attachment_escalates():
    got = process_typed_email(
        subject="RE_ AFRT - LONG BEACH_US",
        body="Please compare the SI and draft BL and confirm "
             "(attachments appear to have been dropped).",
        files=[],
        classifier=fixed("BL_COMPARISON"),
    )
    assert got["status"] == "NEEDS_REVIEW"
    assert got["review_reason"] == "missing_attachment"


def test_typed_comparison_without_attachments_stays_clean():
    """94 real comparison requests carry nothing and are not defects."""
    got = process_typed_email(
        subject="TO CONFIRM DOCS",
        body="Please compare and confirm. Thank you.",
        files=[],
        classifier=fixed("BL_COMPARISON"),
    )
    assert got["status"] == "OK"
    assert got["review_reason"] is None


def test_documents_are_role_detected_not_declared():
    got = process_typed_email(
        subject="check docs", body="attached",
        files=[up("second.txt", BL_MATCHING), up("first.txt", SI)],
        classifier=fixed("BL_COMPARISON"),
    )
    types = {d["filename"]: d["detected_type"] for d in got["documents"]}
    assert types == {"second.txt": "BL", "first.txt": "SI"}
    assert got["status"] == "OK"


def test_an_empty_email_is_rejected():
    with pytest.raises(UploadError):
        process_typed_email(subject="   ", body="", files=[],
                            classifier=fixed("GENERAL"))


def test_single_email_classifier_reads_the_schema_reply_shape(monkeypatch):
    """The batch and single-email paths must agree on the reply shape.
    They diverged once: the single path ignored the schema, received the list
    form, failed to read it, and silently fell back to the heuristic."""
    from sdoc.adhoc import _default_classifier
    from sdoc.config import Settings
    import sdoc.gemini as gemini_mod

    seen = {}

    class StubClient:
        api_key = "set"

        def generate_json(self, prompt, *, default, schema=None):
            seen["schema"] = schema
            return [{"email_id": "typed_email", "category": "SPAM"}]

    monkeypatch.setattr(gemini_mod, "GeminiClient", lambda **kw: StubClient())
    classifier, label = _default_classifier(Settings())
    assert label == "gemini"
    assert classifier({"email_id": "typed_email", "subject": "x",
                       "body": "y", "attachments": []}) == "SPAM"
    assert seen["schema"] is not None

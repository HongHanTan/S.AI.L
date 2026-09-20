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

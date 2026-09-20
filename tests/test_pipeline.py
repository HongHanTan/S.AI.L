from sdoc.config import Settings
from sdoc.pipeline import process_email

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
BL_PACKING_LIST = "PACKING LIST\n====\nShipper: APRIL FAR EAST (M) SDN BHD\n"


def make_reader(si_text, bl_text):
    def read(path):
        return (si_text if path.endswith("_SI.txt") else bl_text).encode("utf-8")
    return read


def email(attachments=("attachments/e_SI.txt", "attachments/e_BL.txt")):
    return {"email_id": "email_x", "from": "a@b.c", "subject": "check docs",
            "body": "please check", "attachments": list(attachments)}


def run_one(si, bl, attachments=("attachments/e_SI.txt", "attachments/e_BL.txt")):
    return process_email(email(attachments), Settings(),
                         classifier=lambda e: "BL_COMPARISON",
                         read_bytes=make_reader(si, bl))


def test_matching_documents_are_ok():
    r = run_one(SI, BL_MATCHING)
    assert r.status == "OK"
    assert r.defect_fields == []


def test_consignee_mismatch_is_flagged():
    r = run_one(SI, BL_WRONG_CONSIGNEE)
    assert r.status == "MISMATCH"
    assert "consignee" in r.defect_fields


def test_container_count_mismatch_is_flagged():
    r = run_one(SI, BL_WRONG_COUNT)
    assert r.status == "MISMATCH"
    assert r.defect_fields == ["container_count"]


def test_missing_attachment_is_needs_review_when_the_body_says_so():
    r = process_email(
        {"email_id": "email_x", "from": "a@b.c", "subject": "check docs",
         "body": "Please compare the SI and draft BL (the draft BL is still missing).",
         "attachments": ["attachments/e_SI.txt"]},
        Settings(), classifier=lambda e: "BL_COMPARISON",
        read_bytes=make_reader(SI, BL_MATCHING))
    assert r.status == "NEEDS_REVIEW"
    assert r.review_reason == "missing_attachment"


def test_comparison_email_with_no_documents_stays_ok():
    """91 of the 94 attachment-less comparison requests are clean in the
    reference set; escalating them all would be a false-alarm machine."""
    r = process_email(
        {"email_id": "email_y", "from": "a@b.c", "subject": "check docs",
         "body": "Please compare and confirm. Thank you.", "attachments": []},
        Settings(), classifier=lambda e: "BL_COMPARISON",
        read_bytes=lambda p: b"")
    assert r.status == "OK"
    assert r.review_reason is None
    assert r.to_submission_entry()["has_defect"] is False


def test_packing_list_instead_of_bl_is_wrong_doc_type():
    r = run_one(SI, BL_PACKING_LIST)
    assert r.status == "NEEDS_REVIEW"
    assert r.review_reason == "wrong_doc_type"


def test_non_comparison_email_short_circuits():
    r = process_email(email(()), Settings(), classifier=lambda e: "SPAM",
                      read_bytes=lambda p: b"")
    assert r.category == "SPAM"
    assert r.to_submission_entry()["has_defect"] is False
    assert r.to_submission_entry()["status"] == "OK"

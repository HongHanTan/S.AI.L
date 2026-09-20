from sdoc.gates import pre_extraction_gate
from sdoc.models import DocText


def doc(path, *lines, error=None):
    return DocText(path=path, lines=list(lines), fmt="txt", error=error)


def test_no_attachments_and_no_claim_is_nothing_to_compare():
    """94 comparison requests arrive with no attachment and no complaint.
    Escalating those would be a false alarm on 91 of them."""
    assert pre_extraction_gate([], body="Please compare and confirm.") == "nothing_to_compare"


def test_no_attachments_but_body_says_they_were_dropped():
    body = "Please compare the SI and draft BL (attachments appear to have been dropped)."
    assert pre_extraction_gate([], body=body) == "missing_attachment"


def test_single_attachment_with_a_complaint_is_missing_attachment():
    body = "Please compare the SI and draft BL (the draft BL is still missing)."
    got = pre_extraction_gate([doc("a_SI.txt", "SHIPPING INSTRUCTION")], body=body)
    assert got == "missing_attachment"


def test_unreadable_doc_wins_over_doc_type():
    docs = [doc("a_SI.txt", "SHIPPING INSTRUCTION"),
            doc("a_BL.txt", error="parse_failed: RuntimeError")]
    assert pre_extraction_gate(docs) == "unreadable"


def test_wrong_doc_type_when_bl_is_a_packing_list():
    docs = [doc("a_SI.txt", "SHIPPING INSTRUCTION", "===="),
            doc("a_BL.txt", "PACKING LIST", "====")]
    assert pre_extraction_gate(docs) == "wrong_doc_type"


def test_two_shipping_instructions_is_wrong_doc_type():
    docs = [doc("a_SI.txt", "SHIPPING INSTRUCTION"),
            doc("a_BL.txt", "SHIPPING INSTRUCTION")]
    assert pre_extraction_gate(docs) == "wrong_doc_type"


def test_valid_pair_passes():
    docs = [doc("a_SI.txt", "SHIPPING INSTRUCTION", "===="),
            doc("a_BL.txt", "BILL OF LADING (DRAFT)", "====")]
    assert pre_extraction_gate(docs) is None


def test_claims_missing_attachment_recognises_the_reference_phrasings():
    from sdoc.gates import claims_missing_attachment
    assert claims_missing_attachment("(attachments appear to have been dropped)")
    assert claims_missing_attachment("(the draft BL is still missing)")
    assert not claims_missing_attachment("Please compare and confirm. Thank you.")

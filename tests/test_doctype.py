from sdoc.doctype import assign_roles, detect_doc_type
from sdoc.models import DocText


def doc(path, *lines):
    return DocText(path=path, lines=list(lines), fmt=path.rsplit(".", 1)[-1])


def test_shipping_instruction_header():
    assert detect_doc_type(doc("a_SI.txt", "SHIPPING INSTRUCTION", "====")) == "SI"


def test_bill_of_lading_instruction_is_an_SI_not_a_BL():
    """All 14 PDF SIs in the bundle use this header. Ordering matters."""
    assert detect_doc_type(doc("a_SI.pdf", "BILL OF LADING INSTRUCTION")) == "SI"


def test_bl_instruction_xlsx_variant_is_an_SI():
    d = doc("a_SI.xlsx", "APRIL FAR EAST (M) SDN BHD", "BL INSTRUCTION: 3815798123")
    assert detect_doc_type(d) == "SI"


def test_draft_bill_of_lading_is_a_BL():
    assert detect_doc_type(doc("a_BL.txt", "BILL OF LADING (DRAFT)", "====")) == "BL"


def test_bill_of_lading_xlsx_variant_is_a_BL():
    d = doc("a_BL.xlsx", "ASIA PACIFIC PAPERBOARD TRADING PTE LTD",
            "BILL OF LADING: 3154303911")
    assert detect_doc_type(d) == "BL"


def test_packing_list_is_other():
    assert detect_doc_type(doc("a_BL.txt", "PACKING LIST", "====")) == "OTHER"


def test_commercial_invoice_is_other():
    assert detect_doc_type(doc("a_BL.txt", "COMMERCIAL INVOICE", "====")) == "OTHER"


def test_body_mentioning_bill_of_lading_does_not_vote():
    d = doc("a_SI.txt", "SHIPPING INSTRUCTION", "====", "Shipper: X",
            "Please issue the bill of lading promptly")
    assert detect_doc_type(d) == "SI"


def test_assign_roles_uses_header_not_filename():
    si = doc("email_009_BL.txt", "SHIPPING INSTRUCTION")
    bl = doc("email_009_SI.txt", "BILL OF LADING (DRAFT)")
    got_si, got_bl = assign_roles([si, bl])
    assert got_si.path.endswith("_BL.txt")
    assert got_bl.path.endswith("_SI.txt")


def test_assign_roles_returns_none_when_no_bl():
    si = doc("a_SI.txt", "SHIPPING INSTRUCTION")
    other = doc("a_BL.txt", "PACKING LIST")
    got_si, got_bl = assign_roles([si, other])
    assert got_si is not None
    assert got_bl is None

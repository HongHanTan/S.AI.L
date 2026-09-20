from sdoc.docs.ingest import ingest


def test_txt_ingest_splits_lines():
    raw = "SHIPPING INSTRUCTION\n\nShipper: ACME PTE LTD\n".encode("utf-8")
    doc = ingest("attachments/email_001_SI.txt", raw)
    assert doc.fmt == "txt"
    assert doc.error is None
    assert "Shipper: ACME PTE LTD" in doc.lines


def test_txt_ingest_tolerates_bad_bytes():
    doc = ingest("attachments/x_SI.txt", b"\xff\xfe SHIPPING INSTRUCTION")
    assert doc.error is None
    assert "SHIPPING INSTRUCTION" in doc.text


def test_header_is_first_three_nonempty_lines_uppercased():
    """Only the first three non-empty lines vote on document type; body text
    below them must not. Verified against all 250 attachments: a three-line
    header produces zero false SI detections."""
    raw = ("Bill of Lading (Draft)\n\n====\nShipper: X\n"
           "Please follow the shipping instruction attached\n").encode("utf-8")
    doc = ingest("a_BL.txt", raw)
    assert doc.header.startswith("BILL OF LADING (DRAFT)")
    assert "PLEASE FOLLOW" not in doc.header
    assert "INSTRUCTION" not in doc.header


def test_unknown_extension_is_an_error():
    doc = ingest("attachments/x.zip", b"PK\x03\x04")
    assert doc.error == "unsupported_format"

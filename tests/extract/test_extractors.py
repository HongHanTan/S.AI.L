from sdoc.extract.engine import extract_text_fields, snippet_for
from sdoc.models import DocText

TXT_SI = DocText(path="a_SI.txt", fmt="txt", lines="""SHIPPING INSTRUCTION
========================================

Shipper (Principal or Seller): ASIA PACIFIC PAPERBOARD TRADING PTE LTD
  80 RAFFLES PLACE, #50-01 UOB PLAZA 1; SINGAPORE 048624
CONSIGNEE: ROXCEL TRADING GMBH
  OPERNRING 3-5; 1010 VIENNA, AUSTRIA
Notify Party: ROXCEL TRADING GMBH
Port of Loading: SINGAPORE (SGSIN)
Port of Discharge (POD): MOMBASA, KENYA (KEMBA)
No. of Containers: 3 x 40'HC
Gross Weight毛重(KGS): 67,311 KG
Vessel: VISION 202 V.002""".splitlines())

PDF_SI = DocText(path="a_SI.pdf", fmt="pdf", lines="""BILL OF LADING INSTRUCTION
B/L NUMBER: OOLU3584143842    BOOKING NO. PSGSE4981829
Shipper
APRIL FINE PAPER TRADING
ON BEHALF OF VITAL SOLUTIONS PTE LTD
77 ROBINSON ROAD, #21-01
SINGAPORE 068896
Consignee
BALL & DOGGETT AUSTRALIA PTY LTD
43-45 METROPOLITAN ROAD
ENFIELD NSW 2136, AUSTRALIA
Notify Party
PACIFIC OFFICE (M) SDN BHD
LOT 6, JALAN P/7
POL
BUATAN, INDONESIA
Port of Discharge (POD)
FREMANTLE, AUSTRALIA
Ocean Vessel
SOLID 16 V.044NW2""".splitlines())


def test_linear_extracts_all_five_text_fields():
    got = extract_text_fields(TXT_SI)
    assert got["shipper"].startswith("ASIA PACIFIC PAPERBOARD TRADING")
    assert got["consignee"].startswith("ROXCEL TRADING GMBH")
    assert got["notify_party"].startswith("ROXCEL TRADING GMBH")
    assert got["port_of_loading"] == "SINGAPORE (SGSIN)"
    assert got["port_of_discharge"] == "MOMBASA, KENYA (KEMBA)"


def test_linear_captures_continuation_lines_into_the_value():
    got = extract_text_fields(TXT_SI)
    assert "RAFFLES PLACE" in got["shipper"]


def test_linear_handles_cjk_contaminated_label():
    assert extract_text_fields(TXT_SI)["gross_weight_kg"] == "67,311 KG"


def test_block_layout_extracts_multiline_values():
    got = extract_text_fields(PDF_SI)
    assert got["shipper"].startswith("APRIL FINE PAPER TRADING")
    assert "ROBINSON ROAD" in got["shipper"]
    assert got["consignee"].startswith("BALL & DOGGETT AUSTRALIA PTY LTD")
    assert got["port_of_loading"] == "BUATAN, INDONESIA"
    assert got["port_of_discharge"] == "FREMANTLE, AUSTRALIA"


def test_block_layout_stops_at_the_next_known_label():
    got = extract_text_fields(PDF_SI)
    assert "Consignee" not in got["shipper"]
    assert "PACIFIC OFFICE" not in got["consignee"]


def test_snippet_returns_surrounding_context():
    snip = snippet_for(TXT_SI, "consignee")
    assert "ROXCEL TRADING GMBH" in snip
    assert len(snip) <= 400


PDF_COLLAPSED = DocText(path="b_BL.pdf", fmt="pdf", lines="""BILL OF LADING (DRAFT)
Shipper
APRIL FINE PAPER TRADING
77 ROBINSON ROAD, #21-01
Consignee (Non-Negotiable) BALL & DOGGETT AUSTRALIA PTY LTD
43-45 METROPOLITAN ROAD
ENFIELD NSW 2136, AUSTRALIA
NOTIFY PARTY
PACIFIC OFFICE (M) SDN BHD
Load Port
BUATAN, INDONESIA
Port of Discharge
FREMANTLE, AUSTRALIA
Export Carrier (vessel, voyage)SOLID 16 V.044NW2
CONTAINER NO.""".splitlines())


def test_block_layout_handles_label_collapsed_onto_its_value():
    """Some PDFs run the label straight into the value with no separator.
    Five real BL attachments lost their consignee to this before it was fixed."""
    got = extract_text_fields(PDF_COLLAPSED)
    assert got["consignee"].startswith("BALL & DOGGETT AUSTRALIA PTY LTD")
    assert "METROPOLITAN ROAD" in got["consignee"]
    assert "Consignee" not in got["consignee"]


def test_block_value_stops_at_a_non_field_label():
    """'Ocean Vessel' and 'Export Carrier' are real labels we never compare;
    they must still terminate the value that precedes them."""
    got = extract_text_fields(PDF_COLLAPSED)
    assert got["port_of_discharge"] == "FREMANTLE, AUSTRALIA"
    assert "SOLID 16" not in got["port_of_discharge"]

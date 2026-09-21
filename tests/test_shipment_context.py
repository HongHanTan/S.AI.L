from sdoc.adhoc import compare_uploads, inspect_uploads
from sdoc.models import DocText
from sdoc.shipment_context import infer_shipment_context


def test_arbitrary_carrier_and_route_are_inferred():
    doc = DocText(path="si.txt", fmt="txt", lines=[
        "SHIPPING INSTRUCTION", "Shipping Line: New Ocean Logistics"
    ])
    got = infer_shipment_context([doc], {
        "port_of_loading": "PORT KLANG, MALAYSIA (MYPKG)",
        "port_of_discharge": "JAKARTA, INDONESIA (IDJKT)",
    })
    assert got["carrier"] == "NEW OCEAN LOGISTICS"
    assert got["origin_country"] == "MY"
    assert got["destination_country"] == "ID"


SI = b"""SHIPPING INSTRUCTION
Carrier: Evergreen Marine
Shipper: VITAL SOLUTIONS SDN BHD
Consignee: GLOBAL PAPER TRADING LLC; DUBAI, UAE
Notify Party: SAME AS CONSIGNEE
Port of Loading: PORT KLANG, MALAYSIA (MYPKG)
Port of Discharge: JAKARTA, INDONESIA (IDJKT)
Total Containers: 2 x 40'HC
Gross Weight (KG): 42,000 KG
"""
BL = SI.replace(b"SHIPPING INSTRUCTION", b"BILL OF LADING (DRAFT)")


def test_inspection_returns_preview_and_context():
    got = inspect_uploads([("si.txt", SI)])
    assert got["shipment_context"]["carrier"] == "EVERGREEN"
    assert got["shipment_context"]["destination_country"] == "ID"
    assert got["detected_fields"]["shipper"].startswith("VITAL SOLUTIONS")
    assert got["detected_fields"]["consignee"].startswith("GLOBAL PAPER")
    assert "SHIPPING INSTRUCTION" in got["documents"][0]["preview"]


def test_matching_documents_can_still_be_country_blocked():
    got = compare_uploads([("si.txt", SI), ("bl.txt", BL)])
    assert got["status"] == "OK"
    assert got["compliance_status"] == "BLOCK"

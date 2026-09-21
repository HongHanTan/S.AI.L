from sdoc.country_rules import evaluate_country_rules, extract_tax_id


GOOD_IMPORT = {
    "shipper": "VITAL SOLUTIONS SDN BHD; KUALA LUMPUR, MALAYSIA",
    "consignee": "PT NUSANTARA LOGISTICS; JAKARTA, INDONESIA; NPWP 0123456789012345",
}


def test_indonesia_import_rule_applies_to_every_carrier():
    for carrier in ("MAERSK", "EVERGREEN", "ANY NEW SHIPPING LINE", ""):
        got = evaluate_country_rules(GOOD_IMPORT, {
            "carrier": carrier, "origin_country": "MY", "destination_country": "ID"
        })
        assert got["status"] == "PASS"
        assert len(got["findings"]) == 2


def test_missing_local_consignee_and_tax_id_blocks_si():
    got = evaluate_country_rules(
        {**GOOD_IMPORT, "consignee": "GLOBAL PAPER TRADING LLC; DUBAI, UAE"},
        {"carrier": "EVERGREEN", "origin_country": "MY", "destination_country": "ID"},
    )
    assert got["status"] == "BLOCK"
    assert {f["requirement"] for f in got["findings"] if f["status"] == "BLOCK"} == {
        "party_local", "tax_id_present"
    }


def test_tax_id_requires_an_explicit_label():
    assert extract_tax_id("Jakarta; phone +62 812 3456 7890") is None
    assert extract_tax_id("Jakarta; NPWP 0123456789012345") == "0123456789012345"

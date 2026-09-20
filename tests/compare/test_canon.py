from sdoc.compare.canon import canon_party, canon_port, party_name


def test_port_drops_country_and_parenthesised_code():
    assert canon_port("NANTONG, CHINA (CNNTG)") == "NANTONG"
    assert canon_port("SINGAPORE (SGSIN)") == "SINGAPORE"
    assert canon_port("MOMBASA, KENYA (KEMBA)") == "MOMBASA"


def test_port_handles_bare_names():
    assert canon_port("SINGAPORE") == "SINGAPORE"
    assert canon_port("PORT KLANG (WESTPORT), MALAYSIA") == "PORT KLANG"


def test_port_is_case_insensitive():
    assert canon_port("nantong, china") == canon_port("NANTONG, CHINA")


def test_party_drops_legal_suffixes():
    assert canon_party("ACME TRADING PTE LTD") == "ACME TRADING"
    assert canon_party("ACME TRADING SDN BHD") == "ACME TRADING"
    assert canon_party("ACME TRADING CO., LTD") == "ACME TRADING"
    assert canon_party("ACME TRADING GMBH") == "ACME TRADING"
    assert canon_party("ACME TRADING PTY LTD") == "ACME TRADING"
    assert canon_party("ACME TRADING FZ-LLC") == "ACME TRADING"
    assert canon_party("ACME TRADING INC.") == "ACME TRADING"


def test_party_name_stops_at_the_address():
    value = "ROXCEL TRADING GMBH; OPERNRING 3-5; 1010 VIENNA, AUSTRIA"
    assert party_name(value) == "ROXCEL TRADING"


def test_party_name_handles_pipe_separator():
    value = "BALL & DOGGETT AUSTRALIA PTY LTD | 43-45 METROPOLITAN ROAD"
    assert party_name(value) == "BALL DOGGETT AUSTRALIA"

from sdoc.extract.numeric import (
    extract_numeric_fields,
    parse_container_count,
    parse_weight_kg,
)
from sdoc.models import DocText


def test_parse_container_count_takes_leading_integer():
    assert parse_container_count("6 x 40'HC") == 6
    assert parse_container_count("15 x 20'GP") == 15
    assert parse_container_count("1 x 20'FCL") == 1


def test_parse_container_count_rejects_prose():
    assert parse_container_count("COATED IVORY BOARD") is None
    assert parse_container_count("") is None


def test_parse_weight_strips_thousands_separators_and_unit():
    assert parse_weight_kg("131,322 KG") == 131322
    assert parse_weight_kg("67,311 KG") == 67311
    assert parse_weight_kg("341715") == 341715


def test_parse_weight_rejects_unparseable():
    assert parse_weight_kg("PREPAID") is None
    assert parse_weight_kg("") is None


def test_summary_lines_are_preferred():
    doc = DocText(path="a.txt", fmt="txt", lines=[
        "No. of Containers: 3 x 40'HC",
        "Gross Weight (KG): 67,311 KG",
    ])
    got = extract_numeric_fields(doc)
    assert got["container_count"] == 3
    assert got["gross_weight_kg"] == 67311


def test_table_rows_are_counted_and_summed_when_no_summary():
    doc = DocText(path="a.pdf", fmt="pdf", lines="""CONTAINER NO.
DESCRIPTION
GROSS WEIGHT (KG)
PURJ4736471
40'HC UNCOATED WOODFREE PAPER IN REA
21,887
WBFO6773592
40'HC UNCOATED WOODFREE PAPER IN REA
21,887
KWKX5625881
40'HC UNCOATED WOODFREE PAPER IN REA
21,887""".splitlines())
    got = extract_numeric_fields(doc)
    assert got["container_count"] == 3
    assert got["gross_weight_kg"] == 65661


def test_agreeing_summary_and_table_resolve_cleanly():
    """6 containers x 21,887 = 131,322 — the real email_059 shape."""
    rows = []
    for tag in ["PURJ4736471", "WBFO6773592", "KWKX5625881",
                "KHOD4732104", "MTNH2595327", "QOPJ7016873"]:
        rows += [tag, "40'HC UNCOATED WOODFREE PAPER IN REA", "21,887"]
    doc = DocText(path="a.pdf", fmt="pdf", lines=(
        ["CONTAINER NO.", "DESCRIPTION", "GROSS WEIGHT (KG)"] + rows
        + ["No. of Containers: 6 x 40'HC", "TOTAL Gross Wt (kgs): 131,322 KG"]))
    got = extract_numeric_fields(doc)
    assert got["container_count"] == 6
    assert got["gross_weight_kg"] == 131322
    assert got["_conflict"] is False


def test_disagreeing_summary_and_table_flag_a_conflict():
    """A reading problem, never a discrepancy."""
    doc = DocText(path="a.pdf", fmt="pdf", lines=[
        "CONTAINER NO.", "DESCRIPTION", "GROSS WEIGHT (KG)",
        "AAAA1111111", "40'HC PAPER", "10,000",
        "BBBB2222222", "40'HC PAPER", "10,000",
        "No. of Containers: 5 x 40'HC",
    ])
    got = extract_numeric_fields(doc)
    assert got["_conflict"] is True

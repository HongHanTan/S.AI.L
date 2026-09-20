import pytest

from sdoc.compare.ladder import compare_field

# Token-set ratio of these two is exactly 0.80 — inside the gray band
# (0.72, 0.92) and just below the 0.82 midpoint. Every gray-band test below
# depends on that, so do not change these strings.
GRAY_A = "ACME GLOBAL TRADING HOLDINGS GROUP"
GRAY_B = "ACME GLOBAL TRADING HOLDINGS"


def test_gray_values_sit_in_the_band():
    """Guards the fixtures the gray-band tests rely on."""
    from sdoc.compare.similarity import band, token_set_ratio
    score = token_set_ratio(GRAY_A, GRAY_B)
    assert score == pytest.approx(0.80)
    assert band(score) == "GRAY"


def test_numeric_equal_is_same_without_a_model():
    v = compare_field("container_count", 6, 6)
    assert v.verdict == "SAME"
    assert v.decided_by == "gate1"


def test_numeric_unequal_is_different():
    v = compare_field("container_count", 3, 4)
    assert v.verdict == "DIFFERENT"
    assert v.decided_by == "gate1"


def test_numeric_never_calls_the_adjudicator():
    calls = []

    def spy(**kwargs):
        calls.append(kwargs)
        return {"verdict": "SAME"}

    compare_field("gross_weight_kg", 100, 200, adjudicator=spy)
    assert calls == []


def test_missing_numeric_is_missing_not_different():
    v = compare_field("container_count", None, 4)
    assert v.verdict == "MISSING"


def test_l1_resolves_formatting_differences():
    v = compare_field("port_of_loading", "NANTONG, CHINA (CNNTG)", "NANTONG")
    assert v.verdict == "SAME"
    assert v.decided_by == "L1"


def test_l1_resolves_legal_suffix_differences():
    v = compare_field("shipper", "ACME TRADING PTE LTD", "ACME TRADING")
    assert v.verdict == "SAME"
    assert v.decided_by == "L1"


def test_l2_alias_table_resolves_known_pairs():
    alias = {"ACME": "GLOBEX", "GLOBEX": "GLOBEX"}
    v = compare_field("shipper", "ACME", "GLOBEX", alias=alias)
    assert v.verdict == "SAME"
    assert v.decided_by == "L2"


def test_different_companies_at_the_same_address_are_different():
    """email_004: identical address, genuinely different consignee."""
    si = "EAST BRIGHT FZ-LLC; RAKEZ AMENITY CENTER; AL HAMRA, RAK, UAE"
    bl = "UAB NOVAKOPA; RAKEZ AMENITY CENTER; AL HAMRA, RAK, UAE"
    v = compare_field("consignee", si, bl)
    assert v.verdict == "DIFFERENT"


def test_gray_band_calls_the_adjudicator():
    seen = {}

    def adjudicator(**kwargs):
        seen.update(kwargs)
        return {"verdict": "SAME", "reason": "same entity abbreviated"}

    v = compare_field("shipper", GRAY_A, GRAY_B, adjudicator=adjudicator)
    assert v.decided_by == "L4"
    assert seen["field_name"] == "shipper"
    assert v.verdict == "SAME"


def test_adjudicator_uncertain_falls_back_to_the_midpoint():
    """0.80 is below the 0.82 midpoint, so an UNCERTAIN leans DIFFERENT."""
    v = compare_field("shipper", GRAY_A, GRAY_B,
                      adjudicator=lambda **kw: {"verdict": "UNCERTAIN"})
    assert v.decided_by == "resolver"
    assert v.verdict == "DIFFERENT"


def test_uncertain_lean_is_switchable():
    v = compare_field("shipper", GRAY_A, GRAY_B,
                      adjudicator=lambda **kw: {"verdict": "UNCERTAIN"},
                      uncertain_lean_same=False)
    assert v.decided_by == "resolver"
    assert v.verdict == "DIFFERENT"


def test_adjudicator_receives_the_similarity_score():
    """Task 14's promotion guard needs it; without it no L4 alias is ever
    promoted, because the guard compares against a default of 0.0."""
    seen = {}

    def adjudicator(**kwargs):
        seen.update(kwargs)
        return {"verdict": "SAME"}

    v = compare_field("shipper", GRAY_A, GRAY_B, adjudicator=adjudicator)
    assert v.decided_by == "L4"
    assert seen["similarity"] == pytest.approx(0.80)


def test_missing_text_value_is_never_a_difference():
    v = compare_field("shipper", "", "ACME TRADING")
    assert v.verdict == "MISSING"

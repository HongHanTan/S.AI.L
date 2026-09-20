from sdoc.compare.similarity import band, token_set_ratio


def test_identical_strings_score_one():
    assert token_set_ratio("ACME TRADING", "ACME TRADING") == 1.0


def test_reordered_tokens_still_match():
    assert token_set_ratio("TRADING ACME", "ACME TRADING") == 1.0


def test_unrelated_strings_score_low():
    assert token_set_ratio("EAST BRIGHT", "UAB NOVAKOPA") < 0.5


def test_bands_apply_the_spec_thresholds():
    assert band(1.0) == "SAME"
    assert band(0.92) == "SAME"
    assert band(0.80) == "GRAY"
    assert band(0.72) == "DIFFERENT"
    assert band(0.10) == "DIFFERENT"

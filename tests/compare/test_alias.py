from sdoc.compare.alias import PROMOTION_GUARD, AliasStore


def store(tmp_path):
    return AliasStore(root=str(tmp_path))


def test_a_fresh_store_is_empty(tmp_path):
    assert store(tmp_path).load(None) == {}


def test_l4_same_above_the_guard_is_promoted(tmp_path):
    s = store(tmp_path)
    s.record_pending({"si_value": "ACME GLOBAL TRADING HOLDINGS",
                      "bl_value": "ACME GLOBAL TRADING HOLDING",
                      "verdict": "SAME", "source": "l4", "similarity": 0.90})
    snapshot = s.promote()
    table = s.load(snapshot)
    assert table["ACME GLOBAL TRADING HOLDINGS"] == table["ACME GLOBAL TRADING HOLDING"]


def test_l4_same_below_the_guard_is_not_promoted(tmp_path):
    s = store(tmp_path)
    s.record_pending({"si_value": "ACME", "bl_value": "GLOBEX",
                      "verdict": "SAME", "source": "l4",
                      "similarity": PROMOTION_GUARD - 0.01})
    assert s.load(s.promote()) == {}


def test_different_verdicts_are_never_promoted(tmp_path):
    s = store(tmp_path)
    s.record_pending({"si_value": "ACME", "bl_value": "GLOBEX",
                      "verdict": "DIFFERENT", "source": "l4", "similarity": 0.95})
    assert s.load(s.promote()) == {}


def test_a_human_same_is_promoted_regardless_of_similarity(tmp_path):
    s = store(tmp_path)
    s.record_human("EAST BRIGHT", "EB TRADING", "SAME")
    assert s.load(s.promote()) != {}


def test_a_human_different_blocks_future_promotion(tmp_path):
    s = store(tmp_path)
    s.record_human("ACME GLOBAL TRADING", "ACME GLOBAL TRADE", "DIFFERENT")
    s.promote()
    s.record_pending({"si_value": "ACME GLOBAL TRADING",
                      "bl_value": "ACME GLOBAL TRADE",
                      "verdict": "SAME", "source": "l4", "similarity": 0.95})
    assert s.load(s.promote()) == {}


def test_a_human_different_removes_an_existing_link(tmp_path):
    s = store(tmp_path)
    s.record_pending({"si_value": "ACME GLOBAL TRADING",
                      "bl_value": "ACME GLOBAL TRADE",
                      "verdict": "SAME", "source": "l4", "similarity": 0.95})
    first = s.promote()
    assert s.load(first) != {}

    s.record_human("ACME GLOBAL TRADING", "ACME GLOBAL TRADE", "DIFFERENT")
    assert s.load(s.promote()) == {}


def test_snapshots_are_immutable_once_written(tmp_path):
    s = store(tmp_path)
    s.record_pending({"si_value": "A CORP", "bl_value": "A CORPORATION",
                      "verdict": "SAME", "source": "human", "similarity": 1.0})
    first = s.promote()
    first_table = s.load(first)

    s.record_pending({"si_value": "B CORP", "bl_value": "B CORPORATION",
                      "verdict": "SAME", "source": "human", "similarity": 1.0})
    second = s.promote()

    assert s.load(first) == first_table
    assert len(s.load(second)) > len(first_table)


def test_latest_returns_the_newest_snapshot(tmp_path):
    s = store(tmp_path)
    s.record_pending({"si_value": "A CORP", "bl_value": "A CORPORATION",
                      "verdict": "SAME", "source": "human", "similarity": 1.0})
    first = s.promote()
    s.record_pending({"si_value": "B CORP", "bl_value": "B CORPORATION",
                      "verdict": "SAME", "source": "human", "similarity": 1.0})
    second = s.promote()
    assert s.latest() == second
    assert first != second

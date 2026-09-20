from sdoc.compare.rollup import rollup
from sdoc.models import FieldVerdict


def v(name, verdict):
    return FieldVerdict(field_name=name, si_value="a", bl_value="b",
                        verdict=verdict, decided_by="L1")


def test_all_same_is_ok():
    verdicts = [v(n, "SAME") for n in ("shipper", "consignee")]
    assert rollup(verdicts, None) == ("OK", None, [])


def test_any_different_is_a_mismatch():
    verdicts = [v("shipper", "SAME"), v("consignee", "DIFFERENT")]
    status, reason, fields = rollup(verdicts, None)
    assert status == "MISMATCH"
    assert reason is None
    assert fields == ["consignee"]


def test_defect_fields_keep_canonical_order():
    verdicts = [v("gross_weight_kg", "DIFFERENT"), v("consignee", "DIFFERENT")]
    _, _, fields = rollup(verdicts, None)
    assert fields == ["consignee", "gross_weight_kg"]


def test_gate_defect_without_a_difference_is_needs_review():
    assert rollup([v("shipper", "SAME")], "missing_attachment") == (
        "NEEDS_REVIEW", "missing_attachment", [])


def test_a_confirmed_difference_outranks_a_gate_defect():
    verdicts = [v("consignee", "DIFFERENT"), v("shipper", "MISSING")]
    status, reason, fields = rollup(verdicts, "missing_value")
    assert status == "MISMATCH"
    assert reason is None
    assert fields == ["consignee"]


def test_missing_verdicts_alone_produce_needs_review():
    verdicts = [v("shipper", "MISSING"), v("consignee", "SAME")]
    status, reason, _ = rollup(verdicts, None)
    assert status == "NEEDS_REVIEW"
    assert reason == "missing_value"

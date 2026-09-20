import pytest

from sdoc.extract.labels import field_for_label, normalize_label


def test_strips_cjk_characters_from_label():
    assert normalize_label("Gross Weight毛重(KGS)") == "GROSS WEIGHT"


def test_strips_parenthesised_codes():
    assert normalize_label("Port of Loading (POL)") == "PORT OF LOADING"


def test_collapses_punctuation_and_case():
    assert normalize_label("No. of Containers") == "NO OF CONTAINERS"
    assert normalize_label("Shipper/Exporter") == "SHIPPER EXPORTER"


@pytest.mark.parametrize("label,expected", [
    ("Shipper", "shipper"),
    ("SHIPPER", "shipper"),
    ("Shipper/Exporter", "shipper"),
    ("Shipper (Principal or Seller)", "shipper"),
    ("Consignee", "consignee"),
    ("Consignee (Non-Negotiable)", "consignee"),
    ("To the Order of", "consignee"),
    ("Notify", "notify_party"),
    ("Notify Party", "notify_party"),
    ("Notify Party/Intermediate Consignee", "notify_party"),
    ("Port of Loading", "port_of_loading"),
    ("POL", "port_of_loading"),
    ("Port of Loading (POL)", "port_of_loading"),
    ("Load Port", "port_of_loading"),
    ("PORT OF LOADING", "port_of_loading"),
    ("Port of Discharge", "port_of_discharge"),
    ("POD", "port_of_discharge"),
    ("Discharge Port", "port_of_discharge"),
    ("Port of Discharge (POD)", "port_of_discharge"),
    ("Total Containers", "container_count"),
    ("Container Count", "container_count"),
    ("No. of Containers", "container_count"),
    ("No. of Containers or Packages", "container_count"),
    ("Gross Wt (kgs)", "gross_weight_kg"),
    ("Gross Weight (KG)", "gross_weight_kg"),
    ("GROSS WEIGHT", "gross_weight_kg"),
    ("TOTAL Gross Wt (kgs)", "gross_weight_kg"),
    ("Gross Weight毛重(KGS)", "gross_weight_kg"),
])
def test_known_labels_map_to_fields(label, expected):
    assert field_for_label(label) == expected


@pytest.mark.parametrize("label", [
    "Vessel", "Voyage", "Voy. No", "HS Code", "Freight", "OC No.",
    "Booking Ref", "Commodity", "Description of Goods",
    "Export Carrier (vessel, voyage)", "Ocean Vessel", "B/L No.",
])
def test_irrelevant_labels_map_to_nothing(label):
    assert field_for_label(label) is None


# --- tolerance for parser noise in labels ----------------------------------

def test_a_short_run_of_junk_after_a_label_still_resolves():
    """A PDF font without a ToUnicode map renders the CJK in
    'Gross Weight<CJK>(KGS)' as a literal 'II'. Eight documents are affected.
    This is handled as a general rule, not a hard-coded spelling."""
    assert field_for_label("TOTAL Gross WeightII(KGS)") == "gross_weight_kg"
    assert field_for_label("Gross WeightX(KG)") == "gross_weight_kg"


def test_plural_labels_resolve():
    assert field_for_label("SHIPPERS") == "shipper"
    assert field_for_label("CONSIGNEES") == "consignee"


def test_a_short_acronym_does_not_swallow_unrelated_words():
    """Noise must be small relative to the label, or 'POD' matches 'PODIUM'."""
    assert field_for_label("PODIUM") is None
    assert field_for_label("POD") == "port_of_discharge"


def test_a_following_word_is_a_different_label_not_noise():
    assert field_for_label("SHIPPER REFERENCE") is None
    assert field_for_label("Consignee Bank") is None
    assert field_for_label("Port of Loading Date") is None
    # The value running into the label must not be eaten either.
    assert field_for_label("Consignee (Non-Negotiable) BA") is None


def test_net_weight_is_not_gross_weight():
    assert field_for_label("NET WEIGHT") is None

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

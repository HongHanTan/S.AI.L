"""Map the ~45 observed label spellings onto the seven canonical fields.

Normalisation drops non-ASCII characters first: 51 attachments use the label
'Gross Weight<CJK>(KGS)', where the CJK run sits inside the label text.
"""
import re
import unicodedata

_PARENS = re.compile(r"\(.*?\)")
_NON_ALPHA = re.compile(r"[^A-Za-z ]")
_SPACES = re.compile(r"\s+")

_VARIANTS: dict[str, list[str]] = {
    "shipper": [
        "Shipper", "Shipper/Exporter", "Shipper (Principal or Seller)",
    ],
    "consignee": [
        "Consignee", "Consignee (Non-Negotiable)", "To the Order of",
    ],
    "notify_party": [
        "Notify", "Notify Party", "Notify Party/Intermediate Consignee",
    ],
    "port_of_loading": [
        "Port of Loading", "POL", "Load Port", "Port of Loading (POL)",
    ],
    "port_of_discharge": [
        "Port of Discharge", "POD", "Discharge Port", "Port of Discharge (POD)",
    ],
    "container_count": [
        "Total Containers", "Container Count", "No. of Containers",
        "No. of Containers or Packages", "Number of Containers",
        "Containers", "Total No. of Containers",
    ],
    "gross_weight_kg": [
        "Gross Wt (kgs)", "Gross Weight (KG)", "Gross Weight", "Gross Wt",
        "TOTAL Gross Wt (kgs)", "Total Gross Weight", "Gross Weight (KGS)",
    ],
}


def normalize_label(raw: str) -> str:
    s = unicodedata.normalize("NFKC", raw)
    s = "".join(ch for ch in s if ord(ch) < 128)
    s = _PARENS.sub(" ", s)
    s = _NON_ALPHA.sub(" ", s)
    return _SPACES.sub(" ", s).strip().upper()


LABEL_TO_FIELD: dict[str, str] = {}
for _field, _labels in _VARIANTS.items():
    for _label in _labels:
        LABEL_TO_FIELD[normalize_label(_label)] = _field


def field_for_label(raw: str) -> str | None:
    return LABEL_TO_FIELD.get(normalize_label(raw))

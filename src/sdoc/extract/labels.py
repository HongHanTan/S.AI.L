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

# Labels the documents use that are NOT one of the seven compared fields.
# In the PDF block layout a value runs until the next label, so these have to
# terminate a value just as a field label does — otherwise "Port of Discharge"
# swallows the vessel name that follows it. Address fragments ("P.O. BOX",
# "TEL") are deliberately excluded: those appear *inside* party values.
NON_FIELD_LABELS: frozenset[str] = frozenset({
    "B L NO", "B L NUMBER", "BILL OF LADING", "BILL OF LADING NO", "CARRIER",
    "BL INSTRUCTION", "BL NO", "BOOKING NO", "BOOKING REF",
    "BOOKING REFERENCE", "BUYER", "CERTIFICATE NO", "COMMODITY",
    "CONTAINER NO", "COUNTRY OF ORIGIN", "DESCRIPTION",
    "DESCRIPTION OF GOODS", "EXPORT CARRIER", "EXPORTER", "FREIGHT",
    "HS CODE", "INCOTERMS", "INVOICE DATE", "INVOICE NO",
    "ISSUING AUTHORITY", "KINDS OF PACKAGES DESCRIPTION OF GOODS",
    "NET WEIGHT", "NEW NO", "OC NO", "OCEAN VESSEL", "ORDER NO",
    "PAYMENT TERMS", "SELLER", "TOTAL AMOUNT", "VESSEL", "VESSEL NAME",
    "VOY", "VOY NO", "VOYAGE", "VOYAGE NO",
})


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


# A label may arrive with a short run of junk appended — a PDF font without a
# ToUnicode map renders the CJK in "Gross Weight<CJK>(KGS)" as a literal "II",
# and OCR-style noise behaves the same way. Anything longer than this is a
# genuinely different label ("SHIPPER REFERENCE" is not "SHIPPER"), so the
# allowance stays deliberately tight.
MAX_LABEL_NOISE = 3


def field_for_label(raw: str) -> str | None:
    """Resolve a label spelling to one of the seven fields.

    Exact match first. Failing that, a known label followed by a few
    unrecognised characters is treated as that label with reading noise —
    which generalises to any parser artifact, rather than hard-coding the one
    this corpus happens to contain.
    """
    normalized = normalize_label(raw)
    if not normalized:
        return None

    field = LABEL_TO_FIELD.get(normalized)
    if field:
        return field

    best: tuple[int, str] | None = None
    for known, known_field in LABEL_TO_FIELD.items():
        if len(normalized) <= len(known):
            continue
        if normalized[:len(known)] != known:
            continue
        # Do not strip first: a *leading* space means the remainder is a new
        # word rather than noise, so "CONSIGNEE BA" must not resolve by
        # eating the start of the value that follows the label.
        noise = normalized[len(known):]
        if " " in noise or not noise or len(noise) > MAX_LABEL_NOISE:
            continue
        # Noise must also be small *relative* to the label, or a short
        # acronym swallows unrelated words: "POD" + "IUM" is not a port.
        if len(noise) * 4 > len(known):
            continue
        if best is None or len(known) > best[0]:
            best = (len(known), known_field)
    return best[1] if best else None


MAX_LABEL_LEN = 45


def is_label_line(raw: str) -> bool:
    """True when a line is, or begins with, any known document label.

    The block extractor uses this to end a value: in a PDF the value under
    "Port of Discharge" must stop at "Ocean Vessel", which is a real label
    even though it is not one of the seven compared fields. The prefix check
    matters because PDFs also collapse those labels onto their values, as in
    "Export Carrier (vessel, voyage)SOLID 16 V.044NW2".
    """
    line = (raw or "").strip()
    if not line:
        return False
    normalized = normalize_label(line)
    if normalized in LABEL_TO_FIELD or normalized in NON_FIELD_LABELS:
        return True
    for end in range(1, min(len(line), MAX_LABEL_LEN) + 1):
        prefix = normalize_label(line[:end])
        if prefix in LABEL_TO_FIELD or prefix in NON_FIELD_LABELS:
            return True
    return False

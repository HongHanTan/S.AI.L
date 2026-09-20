"""Choose an extraction layout and merge what each finds."""
from sdoc.extract.block import extract_block
from sdoc.extract.labels import field_for_label
from sdoc.extract.linear import extract_linear
from sdoc.models import DocText

TEXT_FIELDS = ("shipper", "consignee", "notify_party",
               "port_of_loading", "port_of_discharge")


def extract_text_fields(doc: DocText) -> dict[str, str]:
    """Run both layouts; linear wins where they disagree, block fills gaps."""
    linear = extract_linear(doc)
    block = extract_block(doc)
    merged = dict(block)
    merged.update({k: v for k, v in linear.items() if v})
    return merged


def snippet_for(doc: DocText, field_name: str, width: int = 3) -> str:
    """The lines around where a field was found — evidence for L4 and the UI."""
    for i, line in enumerate(doc.lines):
        label = line.partition(":")[0] if ":" in line else line
        if field_for_label(label.strip()) == field_name:
            lo = max(0, i - 1)
            chunk = [x.strip() for x in doc.lines[lo:i + width + 1] if x.strip()]
            return " | ".join(chunk)[:400]
    return ""

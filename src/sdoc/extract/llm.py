"""Gemini fallback extraction — only for fields the deterministic parser missed."""
from sdoc.extract.numeric import parse_container_count, parse_weight_kg
from sdoc.models import FIELDS

NUMERIC = ("container_count", "gross_weight_kg")

_INSTRUCTIONS = """Extract the requested fields from this shipping document.

Return ONLY a JSON object mapping each requested field name to the value exactly
as it appears in the document. Use an empty string when a field is genuinely
absent. Do not infer, calculate, or invent values.

For parties, include the company name and its address if one is given.
For ports, give the port as written.
For container_count, give the number of containers.
For gross_weight_kg, give the total gross weight.
"""


def make_fallback(client):
    def fallback(doc, fields: dict) -> dict:
        missing = [f for f in FIELDS if not fields.get(f)]
        if not missing:
            return fields

        prompt = (
            f"{_INSTRUCTIONS}\n"
            f"Fields to find: {', '.join(missing)}\n\n"
            f"Document:\n{doc.text[:6000]}"
        )
        reply = client.generate_json(prompt, default={})
        if not isinstance(reply, dict):
            return fields

        out = dict(fields)
        for name in missing:
            raw = reply.get(name)
            if raw in (None, ""):
                continue
            text = str(raw).strip()
            if name == "container_count":
                out[name] = parse_container_count(text)
            elif name == "gross_weight_kg":
                out[name] = parse_weight_kg(text)
            else:
                out[name] = text
        return out

    return fallback

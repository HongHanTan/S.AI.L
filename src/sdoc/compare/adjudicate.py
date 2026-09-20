"""L4 — classify a relationship in the gray band. Never produces a value."""
_TEMPLATE = """These two values were extracted from the {field} field of a
Shipping Instruction and a draft Bill of Lading for the same shipment.

SI value:   "{si_value}"
SI context: "{si_snippet}"
BL value:   "{bl_value}"
BL context: "{bl_snippet}"

Do these refer to the same real-world entity?

SAME      - same entity, differing only in formatting, abbreviation, code vs
            name, address detail, or legal-suffix style
DIFFERENT - genuinely different entities
UNCERTAIN - you cannot tell from the evidence given

Return {{"verdict": ..., "reason": "<one sentence>"}}
Answer UNCERTAIN only if the two values give you no basis at all to decide.
If one reading is even slightly better supported, choose it."""

VERDICTS = ("SAME", "DIFFERENT", "UNCERTAIN")


def make_adjudicator(client):
    def adjudicate(*, field_name, si_value, bl_value, si_snippet="",
                   bl_snippet="", similarity=0.0):
        # `similarity` is accepted so the ladder can pass it through to the
        # alias-promotion guard; it plays no part in the prompt.
        prompt = _TEMPLATE.format(
            field=field_name, si_value=si_value, bl_value=bl_value,
            si_snippet=si_snippet, bl_snippet=bl_snippet,
        )
        reply = client.generate_json(prompt, default={"verdict": "UNCERTAIN"})
        if not isinstance(reply, dict):
            return {"verdict": "UNCERTAIN", "reason": ""}
        verdict = str(reply.get("verdict", "UNCERTAIN")).upper()
        if verdict not in VERDICTS:
            verdict = "UNCERTAIN"
        return {"verdict": verdict, "reason": reply.get("reason", "")}

    return adjudicate

from sdoc.compare.adjudicate import make_adjudicator


class FakeClient:
    def __init__(self, reply):
        self.reply = reply
        self.prompts = []

    def generate_json(self, prompt, *, default):
        self.prompts.append(prompt)
        return self.reply if self.reply is not None else default


def test_adjudicator_returns_the_model_verdict():
    adjudicator = make_adjudicator(FakeClient({"verdict": "SAME", "reason": "abbrev"}))
    got = adjudicator(field_name="shipper", si_value="A", bl_value="B",
                      si_snippet="s", bl_snippet="t")
    assert got["verdict"] == "SAME"
    assert got["reason"] == "abbrev"


def test_prompt_carries_both_values_and_both_snippets():
    client = FakeClient({"verdict": "DIFFERENT"})
    adjudicator = make_adjudicator(client)
    adjudicator(field_name="consignee", si_value="EAST BRIGHT",
                bl_value="UAB NOVAKOPA", si_snippet="SI CTX", bl_snippet="BL CTX")
    prompt = client.prompts[0]
    for token in ("consignee", "EAST BRIGHT", "UAB NOVAKOPA", "SI CTX", "BL CTX"):
        assert token in prompt


def test_unknown_verdict_becomes_uncertain():
    adjudicator = make_adjudicator(FakeClient({"verdict": "MAYBE"}))
    got = adjudicator(field_name="shipper", si_value="A", bl_value="B",
                      si_snippet="", bl_snippet="")
    assert got["verdict"] == "UNCERTAIN"


def test_client_failure_becomes_uncertain():
    adjudicator = make_adjudicator(FakeClient(None))
    got = adjudicator(field_name="shipper", si_value="A", bl_value="B",
                      si_snippet="", bl_snippet="")
    assert got["verdict"] == "UNCERTAIN"

from sdoc.extract.llm import make_fallback
from sdoc.models import DocText

DOC = DocText(path="a_SI.txt", fmt="txt",
              lines=["SHIPPING INSTRUCTION", "Shipper: ACME PTE LTD"])


class FakeClient:
    def __init__(self, reply):
        self.reply = reply
        self.prompts = []

    def generate_json(self, prompt, *, default):
        self.prompts.append(prompt)
        return self.reply


def test_fallback_is_skipped_when_nothing_is_missing():
    client = FakeClient({})
    fallback = make_fallback(client)
    complete = {name: "x" for name in
                ("shipper", "consignee", "notify_party", "port_of_loading",
                 "port_of_discharge")}
    complete.update({"container_count": 1, "gross_weight_kg": 2})
    fallback(DOC, complete)
    assert client.prompts == []


def test_fallback_fills_only_the_missing_fields():
    client = FakeClient({"consignee": "ROXCEL TRADING GMBH"})
    fallback = make_fallback(client)
    got = fallback(DOC, {"shipper": "ACME PTE LTD", "consignee": None})
    assert got["shipper"] == "ACME PTE LTD"
    assert got["consignee"] == "ROXCEL TRADING GMBH"


def test_fallback_asks_only_about_missing_fields():
    client = FakeClient({})
    fallback = make_fallback(client)
    fallback(DOC, {"shipper": "ACME PTE LTD", "consignee": None})
    prompt = client.prompts[0]
    assert "consignee" in prompt
    assert "shipper" not in prompt.split("Fields to find:")[1]


def test_fallback_coerces_numeric_fields_to_int():
    client = FakeClient({"container_count": "6 x 40'HC",
                         "gross_weight_kg": "131,322 KG"})
    fallback = make_fallback(client)
    got = fallback(DOC, {"container_count": None, "gross_weight_kg": None})
    assert got["container_count"] == 6
    assert got["gross_weight_kg"] == 131322


def test_fallback_leaves_a_field_missing_when_the_model_returns_nothing():
    client = FakeClient({"consignee": ""})
    fallback = make_fallback(client)
    got = fallback(DOC, {"consignee": None})
    assert not got["consignee"]

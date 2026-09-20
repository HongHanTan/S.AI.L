import json

from sdoc.gemini import GeminiClient, cache_key, parse_json_response


def test_cache_key_is_stable_and_prompt_sensitive():
    a = cache_key("hello", "gemini-2.0-flash")
    assert a == cache_key("hello", "gemini-2.0-flash")
    assert a != cache_key("hello!", "gemini-2.0-flash")
    assert a != cache_key("hello", "other-model")


def test_parse_json_handles_fenced_output():
    assert parse_json_response('```json\n{"verdict": "SAME"}\n```') == {"verdict": "SAME"}


def test_parse_json_handles_bare_output():
    assert parse_json_response('{"verdict": "DIFFERENT"}') == {"verdict": "DIFFERENT"}


def test_parse_json_returns_none_on_garbage():
    assert parse_json_response("I think they are the same.") is None


def test_client_reads_from_cache_without_calling_the_model(tmp_path):
    client = GeminiClient(cache_dir=str(tmp_path), api_key="unused")
    key = cache_key("PROMPT", client.model)
    (tmp_path / f"{key}.json").write_text(json.dumps({"verdict": "SAME"}),
                                          encoding="utf-8")

    def explode(prompt):
        raise AssertionError("model must not be called when cached")

    client._call = explode
    assert client.generate_json("PROMPT", default={}) == {"verdict": "SAME"}


def test_client_writes_to_cache_after_a_call(tmp_path):
    client = GeminiClient(cache_dir=str(tmp_path), api_key="unused")
    client._call = lambda prompt: '{"verdict": "DIFFERENT"}'
    assert client.generate_json("P", default={}) == {"verdict": "DIFFERENT"}

    client._call = lambda prompt: (_ for _ in ()).throw(AssertionError("cached"))
    assert client.generate_json("P", default={}) == {"verdict": "DIFFERENT"}


def test_client_returns_default_when_the_model_fails(tmp_path):
    client = GeminiClient(cache_dir=str(tmp_path), api_key="unused", retries=1)
    client._call = lambda prompt: (_ for _ in ()).throw(RuntimeError("boom"))
    assert client.generate_json("P", default={"verdict": "UNCERTAIN"}) == {
        "verdict": "UNCERTAIN"}

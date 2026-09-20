import pytest
import json

from sdoc.gemini import GeminiClient, cache_key, parse_json_response


def test_cache_key_is_stable_and_prompt_sensitive():
    a = cache_key("hello", "gemini-3.5-flash-lite")
    assert a == cache_key("hello", "gemini-3.5-flash-lite")
    assert a != cache_key("hello!", "gemini-3.5-flash-lite")
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


def test_rate_limit_errors_are_recognised():
    from sdoc.gemini import is_rate_limited
    assert is_rate_limited(RuntimeError("429 RESOURCE_EXHAUSTED"))
    assert is_rate_limited(RuntimeError("You exceeded your current quota"))
    assert not is_rate_limited(RuntimeError("404 NOT_FOUND"))


def test_a_rate_limited_call_is_retried_not_discarded(tmp_path):
    """A 429 is an early request, not a failed one. Discarding the batch cost
    17 of 26 classification batches on the first live run."""
    client = GeminiClient(cache_dir=str(tmp_path), api_key="unused",
                          retries=3, min_interval=0, backoff_seconds=0)
    attempts = []

    def flaky(prompt):
        attempts.append(1)
        if len(attempts) < 3:
            raise RuntimeError("429 RESOURCE_EXHAUSTED quota")
        return '{"email_001": "SPAM"}'

    client._call = flaky
    assert client.generate_json("P", default={}) == {"email_001": "SPAM"}
    assert len(attempts) == 3
    assert client.rate_limit_hits == 2


def test_persistent_rate_limiting_returns_the_default(tmp_path):
    client = GeminiClient(cache_dir=str(tmp_path), api_key="unused",
                          retries=2, min_interval=0, backoff_seconds=0)
    client._call = lambda p: (_ for _ in ()).throw(RuntimeError("429 quota"))
    assert client.generate_json("P", default={"fallback": True}) == {"fallback": True}


def test_retry_hint_is_parsed_from_the_error():
    from sdoc.gemini import retry_after_seconds
    err = RuntimeError("429 RESOURCE_EXHAUSTED ... Please retry in 52.837381773s.")
    assert retry_after_seconds(err) == pytest.approx(52.837, rel=1e-3)
    assert retry_after_seconds(RuntimeError("429 quota exceeded")) is None


def test_client_survives_a_read_only_cache_directory(monkeypatch, tmp_path):
    """Serverless hosts mount a read-only filesystem; a cache that cannot be
    created must not stop the client being constructed."""
    monkeypatch.setenv("SDOC_CACHE_DIR", "Z:/nonexistent-readonly/cache")
    client = GeminiClient(api_key="unused")
    assert client.cache_dir.exists()
    client._call = lambda p: '{"ok": true}'
    assert client.generate_json("P", default={}) == {"ok": True}

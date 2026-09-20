"""Gemini access with a content-hash disk cache.

The cache is what makes scoreboard iteration cheap: a full re-run after a
comparison-logic change costs no model calls at all.
"""
import hashlib
import json
import os
import re
from pathlib import Path

_FENCE = re.compile(r"```(?:json)?\s*(.*?)```", re.S)

DEFAULT_MODEL = "gemini-2.0-flash"


def cache_key(prompt: str, model: str) -> str:
    return hashlib.sha256(f"{model}\x00{prompt}".encode("utf-8")).hexdigest()[:32]


def parse_json_response(text: str):
    """Pull JSON out of a model response, fenced or bare. None if absent."""
    if not text:
        return None
    candidates = []
    fenced = _FENCE.search(text)
    if fenced:
        candidates.append(fenced.group(1))
    candidates.append(text)
    for chunk in candidates:
        chunk = chunk.strip()
        start = min((i for i in (chunk.find("{"), chunk.find("[")) if i != -1),
                    default=-1)
        if start == -1:
            continue
        end = max(chunk.rfind("}"), chunk.rfind("]"))
        if end <= start:
            continue
        try:
            return json.loads(chunk[start:end + 1])
        except json.JSONDecodeError:
            continue
    return None


class GeminiClient:
    def __init__(self, model: str = DEFAULT_MODEL, cache_dir: str = ".cache",
                 api_key: str | None = None, retries: int = 2):
        self.model = model
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.api_key = api_key or os.environ.get("GEMINI_API_KEY", "")
        self.retries = retries
        self._client = None
        self.calls = 0

    def _ensure_client(self):
        if self._client is None:
            from google import genai
            self._client = genai.Client(api_key=self.api_key)
        return self._client

    def _call(self, prompt: str) -> str:
        client = self._ensure_client()
        response = client.models.generate_content(model=self.model, contents=prompt)
        return response.text

    def generate_json(self, prompt: str, *, default):
        path = self.cache_dir / f"{cache_key(prompt, self.model)}.json"
        if path.exists():
            try:
                return json.loads(path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                pass

        for _ in range(max(1, self.retries)):
            try:
                self.calls += 1
                parsed = parse_json_response(self._call(prompt))
            except Exception:
                continue
            if parsed is not None:
                path.write_text(json.dumps(parsed), encoding="utf-8")
                return parsed
        return default

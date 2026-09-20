"""Gemini access with a content-hash disk cache.

The cache is what makes scoreboard iteration cheap: a full re-run after a
comparison-logic change costs no model calls at all.
"""
import hashlib
import json
import os
import re
import time
from pathlib import Path

_FENCE = re.compile(r"```(?:json)?\s*(.*?)```", re.S)

DEFAULT_MODEL = "gemini-3.5-flash-lite"

# The free tier meters requests per minute. These defaults keep a full
# classification run inside it; raise the pace on a paid key.
DEFAULT_MIN_INTERVAL = 4.0
DEFAULT_BACKOFF = 20.0
MAX_BACKOFF = 120.0


_RETRY_HINT = re.compile(r"retry in ([\d.]+)\s*s", re.I)


def is_rate_limited(exc: Exception) -> bool:
    """True for a 429 / quota-exhausted error, which is retryable."""
    text = str(exc)
    return "429" in text or "RESOURCE_EXHAUSTED" in text or "quota" in text.lower()


def retry_after_seconds(exc: Exception) -> float | None:
    """The wait the server itself asks for, e.g. "Please retry in 52.8s".

    Honouring this beats guessing: the free tier meters 20 requests per minute
    and the response says exactly when the window reopens.
    """
    match = _RETRY_HINT.search(str(exc))
    if not match:
        return None
    try:
        return float(match.group(1))
    except ValueError:
        return None


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
                 api_key: str | None = None, retries: int = 6,
                 min_interval: float = DEFAULT_MIN_INTERVAL,
                 backoff_seconds: float = DEFAULT_BACKOFF,
                 max_backoff_seconds: float = MAX_BACKOFF):
        self.model = model
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.api_key = api_key or os.environ.get("GEMINI_API_KEY", "")
        self.retries = retries
        self.min_interval = min_interval
        self.backoff_seconds = backoff_seconds
        self.max_backoff_seconds = max_backoff_seconds
        self._client = None
        self._last_call_at = 0.0
        self.calls = 0
        self.rate_limit_hits = 0
        self.failures = 0

    def _ensure_client(self):
        if self._client is None:
            from google import genai
            self._client = genai.Client(api_key=self.api_key)
        return self._client

    def _call(self, prompt: str) -> str:
        client = self._ensure_client()
        response = client.models.generate_content(model=self.model, contents=prompt)
        return response.text

    def _throttle(self) -> None:
        """Keep a minimum gap between calls. The free tier meters requests per
        minute, and firing a whole run back-to-back exhausts it immediately."""
        if self.min_interval <= 0:
            return
        elapsed = time.monotonic() - self._last_call_at
        if elapsed < self.min_interval:
            time.sleep(self.min_interval - elapsed)

    def generate_json(self, prompt: str, *, default):
        path = self.cache_dir / f"{cache_key(prompt, self.model)}.json"
        if path.exists():
            try:
                return json.loads(path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                pass

        delay = self.backoff_seconds
        for attempt in range(max(1, self.retries)):
            try:
                self._throttle()
                self.calls += 1
                self._last_call_at = time.monotonic()
                parsed = parse_json_response(self._call(prompt))
            except Exception as exc:
                if is_rate_limited(exc) and attempt < self.retries - 1:
                    # A 429 is not a failed request, only an early one. Wait
                    # the interval the server names, falling back to doubling
                    # when it names none, then try again rather than
                    # discarding the batch.
                    self.rate_limit_hits += 1
                    hinted = retry_after_seconds(exc)
                    if hinted is not None:
                        time.sleep(min(hinted + 1.0, self.max_backoff_seconds))
                    else:
                        time.sleep(delay)
                        delay = min(delay * 2, self.max_backoff_seconds)
                    continue
                self.failures += 1
                continue
            if parsed is not None:
                path.write_text(json.dumps(parsed), encoding="utf-8")
                return parsed
            self.failures += 1
        return default

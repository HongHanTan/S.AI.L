"""Tunable switches. Both are decisions the data cannot settle a priori;
each is A/B tested on the scoreboard and the result recorded in docs/scores.md.
"""
from dataclasses import dataclass


@dataclass
class Settings:
    # Treat an attachment-less "confirm docs" email as a comparison request or
    # leave it GENERAL. Defaults True: the reference set has 220 BL_COMPARISON
    # emails but only 126 carry attachments, so ~94 comparison requests arrive
    # with nothing attached. Task 15 re-tests this on the scoreboard.
    attachmentless_is_comparison: bool = True
    # Which way an L4 UNCERTAIN leans when it falls back to the midpoint.
    uncertain_lean_same: bool = True
    data_dir: str = "data"
    server: str = "http://localhost:8080"
    alias_snapshot: str | None = None
    use_llm_fallback: bool = True


SETTINGS = Settings()

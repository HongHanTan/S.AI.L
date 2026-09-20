"""L3 — token-set similarity with a deliberately narrow gray band."""
SAME_AT = 0.92
DIFFERENT_AT = 0.72
GRAY_MIDPOINT = 0.82


def token_set_ratio(a: str, b: str) -> float:
    """Jaccard overlap of token sets. Order-insensitive, dependency-free."""
    ta = {t for t in (a or "").split() if t}
    tb = {t for t in (b or "").split() if t}
    if not ta and not tb:
        return 1.0
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def band(score: float) -> str:
    if score >= SAME_AT:
        return "SAME"
    if score <= DIFFERENT_AT:
        return "DIFFERENT"
    return "GRAY"

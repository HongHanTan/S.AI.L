"""L1 — strip away the formatting differences that are not discrepancies."""
import re

_PARENS = re.compile(r"\(.*?\)")
_PUNCT = re.compile(r"[^A-Z0-9 ]")
_SPACES = re.compile(r"\s+")

_LEGAL_SUFFIXES = (
    "PTE LTD", "PTY LTD", "CO LTD", "SDN BHD", "FZ LLC", "FZE", "GMBH",
    "LLC", "LTD", "INC", "CORP", "BV", "NV", "SA", "AG", "PLC", "LIMITED",
)


def _base(value: str) -> str:
    s = (value or "").upper()
    s = _PARENS.sub(" ", s)
    s = _PUNCT.sub(" ", s)
    return _SPACES.sub(" ", s).strip()


def canon_port(value: str) -> str:
    """Ports: drop parenthesised codes and any trailing country."""
    s = _PARENS.sub(" ", (value or "").upper())
    s = s.split(",")[0]
    s = _PUNCT.sub(" ", s)
    return _SPACES.sub(" ", s).strip()


def canon_party(value: str) -> str:
    """Parties: drop legal suffixes and flatten to a comparable name."""
    s = _base(value)
    changed = True
    while changed:
        changed = False
        for suffix in _LEGAL_SUFFIXES:
            if s.endswith(" " + suffix):
                s = s[: -(len(suffix) + 1)].strip()
                changed = True
    return s


def party_name(value: str) -> str:
    """The name portion only — everything before the first address separator.

    Addresses in this dataset follow the name after ';' or '|'. Comparing whole
    blobs lets an identical address carry a match between two genuinely
    different companies (email_004: EAST BRIGHT vs UAB NOVAKOPA, same address).
    """
    head = re.split(r"[;|]", value or "", maxsplit=1)[0]
    return canon_party(head)

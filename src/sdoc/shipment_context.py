"""Infer carrier and trade-lane context from attachment contents."""
from __future__ import annotations

import re

from sdoc.country_rules import normalize_country
from sdoc.models import DocText

_CARRIERS = (
    ("MAERSK", re.compile(r"\b(?:MAERSK|SEALAND)\b", re.I)),
    ("HAPAG-LLOYD", re.compile(r"\bHAPAG[ -]?LLOYD\b", re.I)),
    ("CMA CGM", re.compile(r"\bCMA\s+CGM\b", re.I)),
    ("EVERGREEN", re.compile(r"\bEVERGREEN(?:\s+MARINE)?\b", re.I)),
    ("COSCO", re.compile(r"\bCOSCO\b", re.I)),
    ("OOCL", re.compile(r"\bOOCL\b|\bORIENT OVERSEAS CONTAINER LINE\b", re.I)),
    ("PIL", re.compile(r"\bPIL\b|\bPACIFIC INTERNATIONAL LINES\b", re.I)),
    ("YANG MING", re.compile(r"\bYANG MING\b", re.I)),
    ("ZIM", re.compile(r"\bZIM\b", re.I)),
    ("MSC", re.compile(r"\bMEDITERRANEAN SHIPPING COMPANY\b|\bMSC\b", re.I)),
    ("ONE", re.compile(r"\bOCEAN NETWORK EXPRESS\b", re.I)),
)
_CARRIER_LABEL = re.compile(
    r"^\s*(?:OCEAN\s+)?(?:CARRIER|SHIPPING\s+LINE|OCEAN\s+LINE|VESSEL\s+OPERATOR|SHIPPING\s+COMPANY)\s*[:\-]\s*(.+?)\s*$",
    re.I,
)
_COUNTRY_NAMES = {
    "INDONESIA": "ID", "MALAYSIA": "MY", "SINGAPORE": "SG", "CHINA": "CN",
    "PAKISTAN": "PK", "INDIA": "IN", "UNITED ARAB EMIRATES": "AE", "UAE": "AE",
    "AUSTRALIA": "AU", "UNITED STATES": "US", "USA": "US", "THAILAND": "TH",
    "VIETNAM": "VN", "JAPAN": "JP", "SOUTH KOREA": "KR", "KENYA": "KE",
}
_UNLOCODE = re.compile(r"\(([A-Z]{2})[A-Z]{3}\)")


def carrier_from_documents(docs: list[DocText]) -> tuple[str, str] | tuple[None, None]:
    for doc in docs:
        for line in doc.lines:
            labelled = _CARRIER_LABEL.match(line)
            if not labelled:
                continue
            raw = labelled.group(1).strip()
            for carrier, pattern in _CARRIERS:
                if pattern.search(raw):
                    return carrier, f'{doc.path}: "{line.strip()}"'
            return raw.upper(), f'{doc.path}: "{line.strip()}"'
    for doc in docs:
        for carrier, pattern in _CARRIERS:
            match = pattern.search(doc.text)
            if match:
                return carrier, f'{doc.path}: "{match.group(0)}"'
    return None, None


def country_from_port(value: str | None) -> tuple[str, str] | tuple[None, None]:
    text = (value or "").upper()
    for name in sorted(_COUNTRY_NAMES, key=len, reverse=True):
        if re.search(rf"\b{re.escape(name)}\b", text):
            return _COUNTRY_NAMES[name], name
    match = _UNLOCODE.search(text)
    return ((normalize_country(match.group(1)), match.group(0).strip("()"))
            if match else (None, None))


def infer_shipment_context(docs: list[DocText], si_fields: dict) -> dict:
    carrier, carrier_ev = carrier_from_documents(docs)
    origin, origin_ev = country_from_port(si_fields.get("port_of_loading"))
    destination, destination_ev = country_from_port(si_fields.get("port_of_discharge"))
    return {
        "carrier": carrier or "", "origin_country": origin or "",
        "destination_country": destination or "",
        "direction": "IMPORT" if destination == "ID" else "EXPORT" if origin == "ID" else "",
        "evidence": {"carrier": carrier_ev, "origin_country": origin_ev,
                     "destination_country": destination_ev},
    }

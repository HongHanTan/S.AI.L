"""Country compliance checks kept separate from SI-to-BL comparison."""
from __future__ import annotations

import json
import re
from datetime import date
from functools import lru_cache
from pathlib import Path

RULES_PATH = Path(__file__).with_name("rules") / "country_rules.json"
COUNTRY_ALIASES = {
    "ID": "ID", "IDN": "ID", "INDONESIA": "ID",
    "MY": "MY", "MYS": "MY", "MALAYSIA": "MY",
    "SG": "SG", "SGP": "SG", "SINGAPORE": "SG",
}
INDONESIA_MARKERS = (
    "INDONESIA", "JAKARTA", "SURABAYA", "SEMARANG", "BELAWAN",
    "MEDAN", "BANDUNG", "MAKASSAR", "BATAM", "TANJUNG PRIOK",
)
_TAX_LABEL = re.compile(
    r"(?:NPWP|TAX\s*(?:ID|NO|NUMBER)?|TIN)\s*[:#.-]?\s*([0-9][0-9 .-]{12,24}[0-9])",
    re.I,
)


def normalize_country(value: str | None) -> str:
    raw = (value or "").strip().upper()
    return COUNTRY_ALIASES.get(raw, raw)


def normalize_context(context: dict | None) -> dict:
    raw = context or {}
    origin = normalize_country(raw.get("origin_country"))
    destination = normalize_country(raw.get("destination_country"))
    direction = (raw.get("direction") or "").strip().upper()
    if not direction:
        direction = "IMPORT" if destination == "ID" else "EXPORT" if origin == "ID" else ""
    return {
        "carrier": (raw.get("carrier") or "").strip().upper(),
        "origin_country": origin,
        "destination_country": destination,
        "direction": direction,
        "shipment_date": raw.get("shipment_date") or date.today().isoformat(),
    }


@lru_cache(maxsize=1)
def load_rules() -> list[dict]:
    return json.loads(RULES_PATH.read_text(encoding="utf-8"))


def extract_tax_id(party_value: str | None) -> str | None:
    match = _TAX_LABEL.search(party_value or "")
    if not match:
        return None
    digits = re.sub(r"\D", "", match.group(1))
    return digits if 13 <= len(digits) <= 18 else None


def party_country(party_value: str | None) -> str | None:
    text = (party_value or "").upper()
    return "ID" if any(marker in text for marker in INDONESIA_MARKERS) else None


def _applies(rule: dict, context: dict) -> bool:
    if rule["carrier"] not in ("*", context["carrier"]):
        return False
    if rule["direction"] != context["direction"]:
        return False
    relevant = context["destination_country"] if rule["direction"] == "IMPORT" else context["origin_country"]
    return rule["country"] == relevant and context["shipment_date"] >= rule["effective_from"]


def evaluate_country_rules(si_fields: dict, context: dict | None) -> dict:
    ctx = normalize_context(context)
    if not (ctx["origin_country"] or ctx["destination_country"]):
        return {"status": "NOT_CHECKED", "context": ctx, "findings": [],
                "note": "Route context could not be extracted from the attachments."}
    applicable = [rule for rule in load_rules() if _applies(rule, ctx)]
    if not applicable:
        return {"status": "NOT_APPLICABLE", "context": ctx, "findings": [], "note": ""}

    findings = []
    for rule in applicable:
        for requirement in rule["requirements"]:
            field = requirement["field"]
            value = si_fields.get(field) or ""
            if requirement["type"] == "party_local":
                detected = party_country(value)
                passed = detected == rule["country"]
                evidence = {"detected_country": detected, "expected_country": rule["country"]}
            else:
                tax_id = extract_tax_id(value)
                passed = bool(tax_id)
                evidence = {"tax_id": tax_id}
            findings.append({
                "rule_id": rule["rule_id"], "title": rule["title"],
                "requirement": requirement["type"], "field": field,
                "status": "PASS" if passed else requirement["severity"],
                "message": requirement["message"],
                "action": "No action required." if passed else requirement["action"],
                "evidence": evidence, "source_url": rule["source_url"],
                "source_checked": rule["source_checked"],
                "effective_from": rule["effective_from"],
            })
    status = "BLOCK" if any(f["status"] == "BLOCK" for f in findings) else "PASS"
    return {"status": status, "context": ctx, "findings": findings, "note": ""}

"""Stage 1 — sort the inbox into five categories.

This is a model job rather than a keyword job because the subjects mislead:
"TO CONFIRM DOCS ..." appears on genuine comparison requests and on
attachment-less chatter alike.
"""
import json

from sdoc.config import Settings
from sdoc.models import CATEGORIES

_INSTRUCTIONS = """You are triaging a shipping operations team's inbox.

Classify each email into exactly one category:

BL_COMPARISON - asks someone to check, verify, confirm or compare a draft Bill
  of Lading against a Shipping Instruction. Normally carries both documents.
SI_REQUEST    - asks for a NEW Shipping Instruction to be created, submitted or
  sent. Nothing is being checked.
INVOICE_QUERY - about billing, charges, invoices, debit or credit notes,
  detention or demurrage.
GENERAL       - operational updates, schedules, summaries, amendments, status
  reports, and anything else legitimate.
SPAM          - unsolicited marketing, phishing, account warnings.

Judge the request the sender is actually making. Subjects are often misleading
and reused across categories; the body and the attachments matter more.
An email that merely mentions a BL is not a comparison request unless it asks
for the documents to be checked against each other.

Return ONLY a JSON object mapping every email_id to its category, e.g.
{"email_001": "SPAM", "email_002": "BL_COMPARISON"}
"""


def build_prompt(batch: list[dict]) -> str:
    parts = [_INSTRUCTIONS, "", f"Categories: {', '.join(CATEGORIES)}", "", "Emails:"]
    for email in batch:
        attachments = email.get("attachments") or []
        names = ", ".join(a.rsplit("/", 1)[-1] for a in attachments) or "none"
        body = (email.get("body") or "")[:600].replace("\n", " ")
        parts.append(
            f"---\nemail_id: {email['email_id']}\n"
            f"from: {email.get('from', '')}\n"
            f"subject: {email.get('subject', '')}\n"
            f"attachments: {len(attachments)} ({names})\n"
            f"body: {body}"
        )
    return "\n".join(parts)


def classify_all(emails: list[dict], client, batch_size: int = 20,
                 settings: Settings | None = None) -> dict[str, str]:
    settings = settings or Settings()
    out: dict[str, str] = {}

    for start in range(0, len(emails), batch_size):
        batch = emails[start:start + batch_size]
        reply = client.generate_json(build_prompt(batch), default={})
        if not isinstance(reply, dict):
            reply = {}
        for email in batch:
            eid = email["email_id"]
            category = reply.get(eid, "GENERAL")
            if category not in CATEGORIES:
                category = "GENERAL"
            if (category == "BL_COMPARISON"
                    and not email.get("attachments")
                    and not settings.attachmentless_is_comparison):
                category = "GENERAL"
            out[eid] = category
    return out


def make_classifier(mapping: dict[str, str]):
    def classifier(email: dict) -> str:
        return mapping.get(email["email_id"], "GENERAL")
    return classifier

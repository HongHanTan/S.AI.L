import json

from sdoc.inbox import load_emails


def test_load_emails_reads_records(tmp_path):
    inbox = tmp_path / "inbox"
    inbox.mkdir()
    (inbox / "email_001.json").write_text(
        json.dumps({"email_id": "email_001", "from": "a@b.c",
                    "subject": "hi", "body": "x", "attachments": []}),
        encoding="utf-8",
    )
    emails = load_emails(str(tmp_path))
    assert len(emails) == 1
    assert emails[0]["email_id"] == "email_001"

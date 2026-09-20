from sdoc.classify import build_prompt, classify_all, make_classifier
from sdoc.config import Settings


class FakeClient:
    """Returns whatever the test queues, recording the prompts it saw."""

    def __init__(self, replies):
        self.replies = list(replies)
        self.prompts = []

    def generate_json(self, prompt, *, default):
        self.prompts.append(prompt)
        return self.replies.pop(0) if self.replies else default


def emails(n, with_attachments=()):
    out = []
    for i in range(1, n + 1):
        eid = f"email_{i:03d}"
        out.append({"email_id": eid, "from": "a@b.c", "subject": f"s{i}",
                    "body": "b", "attachments": ["x_SI.txt"] if eid in with_attachments else []})
    return out


def test_prompt_lists_every_category_and_every_email():
    prompt = build_prompt(emails(3))
    for category in ("BL_COMPARISON", "SI_REQUEST", "INVOICE_QUERY", "GENERAL", "SPAM"):
        assert category in prompt
    for eid in ("email_001", "email_002", "email_003"):
        assert eid in prompt


def test_prompt_states_attachment_presence():
    prompt = build_prompt(emails(2, with_attachments={"email_001"}))
    assert "attachments: 1" in prompt
    assert "attachments: 0" in prompt


def test_classify_all_batches_and_merges():
    client = FakeClient([
        {"email_001": "SPAM", "email_002": "GENERAL"},
        {"email_003": "BL_COMPARISON"},
    ])
    got = classify_all(emails(3), client, batch_size=2)
    assert got == {"email_001": "SPAM", "email_002": "GENERAL",
                   "email_003": "BL_COMPARISON"}
    assert len(client.prompts) == 2


def test_unknown_category_falls_back_to_general():
    client = FakeClient([{"email_001": "NONSENSE"}])
    assert classify_all(emails(1), client, batch_size=20) == {"email_001": "GENERAL"}


def test_missing_email_in_the_reply_falls_back_to_general():
    client = FakeClient([{}])
    assert classify_all(emails(2), client, batch_size=20) == {
        "email_001": "GENERAL", "email_002": "GENERAL"}


def test_attachmentless_comparison_is_kept_by_default():
    """The reference set has 220 BL_COMPARISON emails but only 126 with
    attachments, so an attachment-less comparison request is still one."""
    client = FakeClient([{"email_001": "BL_COMPARISON"}])
    got = classify_all(emails(1), client, batch_size=20, settings=Settings())
    assert got["email_001"] == "BL_COMPARISON"


def test_attachmentless_comparison_is_downgraded_when_the_switch_is_off():
    client = FakeClient([{"email_001": "BL_COMPARISON"}])
    settings = Settings(attachmentless_is_comparison=False)
    got = classify_all(emails(1), client, batch_size=20, settings=settings)
    assert got["email_001"] == "GENERAL"


def test_make_classifier_returns_a_lookup_callable():
    classifier = make_classifier({"email_001": "SPAM"})
    assert classifier({"email_id": "email_001"}) == "SPAM"
    assert classifier({"email_id": "email_999"}) == "GENERAL"

import json

import pytest
from fastapi.testclient import TestClient

from sdoc.compare.alias import AliasStore
from web.app import create_app

RUN = {
    "email_001": {"subject": "Spam offer", "category": "SPAM", "status": "OK",
                  "review_reason": None, "defect_fields": [], "attachment_count": 0,
                  "verdicts": [], "notes": []},
    "email_004": {"subject": "Check docs", "category": "BL_COMPARISON",
                  "status": "MISMATCH", "review_reason": None,
                  "defect_fields": ["consignee"], "attachment_count": 2,
                  "verdicts": [
                      {"field_name": "consignee", "si_value": "EAST BRIGHT",
                       "bl_value": "UAB NOVAKOPA", "verdict": "DIFFERENT",
                       "decided_by": "L3", "similarity": 0.1, "reason": ""},
                      {"field_name": "shipper", "si_value": "ACME",
                       "bl_value": "ACME", "verdict": "SAME",
                       "decided_by": "L1", "similarity": None, "reason": ""}],
                  "notes": []},
    "email_507": {"subject": "Confirm docs", "category": "BL_COMPARISON",
                  "status": "NEEDS_REVIEW", "review_reason": "missing_attachment",
                  "defect_fields": [], "attachment_count": 1,
                  "verdicts": [], "notes": []},
}


@pytest.fixture
def client(tmp_path):
    run_path = tmp_path / "run.json"
    run_path.write_text(json.dumps(RUN), encoding="utf-8")
    store = AliasStore(root=str(tmp_path / "aliases"))
    return TestClient(create_app(run_path=str(run_path), store=store)), store


def test_list_emails_returns_every_record(client):
    c, _ = client
    body = c.get("/api/emails").json()
    assert len(body) == 3
    assert {r["email_id"] for r in body} == {"email_001", "email_004", "email_507"}


def test_list_emails_can_filter_by_category(client):
    c, _ = client
    body = c.get("/api/emails", params={"category": "SPAM"}).json()
    assert [r["email_id"] for r in body] == ["email_001"]


def test_email_detail_includes_field_verdicts(client):
    c, _ = client
    body = c.get("/api/emails/email_004").json()
    assert body["status"] == "MISMATCH"
    assert body["defect_fields"] == ["consignee"]
    assert len(body["verdicts"]) == 2


def test_unknown_email_is_404(client):
    c, _ = client
    assert c.get("/api/emails/email_999").status_code == 404


def test_review_queue_lists_only_needs_review(client):
    c, _ = client
    body = c.get("/api/review-queue").json()
    assert [r["email_id"] for r in body] == ["email_507"]
    assert body[0]["review_reason"] == "missing_attachment"


def test_posting_a_review_records_a_human_decision(client):
    c, store = client
    response = c.post("/api/review/email_004",
                      json={"field": "consignee", "verdict": "SAME"})
    assert response.status_code == 200
    assert store.pending_path.exists()
    recorded = store.pending_path.read_text(encoding="utf-8")
    assert '"source": "human"' in recorded
    assert "EAST BRIGHT" in recorded


def test_posting_a_review_for_an_unknown_field_is_400(client):
    c, _ = client
    assert c.post("/api/review/email_004",
                  json={"field": "nonexistent", "verdict": "SAME"}).status_code == 400


def test_stats_summarise_the_run(client):
    c, _ = client
    body = c.get("/api/stats").json()
    assert body["categories"]["BL_COMPARISON"] == 2
    assert body["statuses"]["MISMATCH"] == 1
    assert body["total"] == 3


SI_DOC = b"""SHIPPING INSTRUCTION
========================================

Shipper: APRIL FAR EAST (M) SDN BHD
Consignee (Non-Negotiable): EAST BRIGHT FZ-LLC
Notify: EAST BRIGHT FZ-LLC
Port of Loading (POL): NANTONG, CHINA (CNNTG)
POD: KARACHI, PAKISTAN (PKKHI)
Total Containers: 6 x 40'HC
Gross Wt (kgs): 131,058 KG
"""

BL_DOC = SI_DOC.replace(b"SHIPPING INSTRUCTION", b"BILL OF LADING (DRAFT)")
BL_BAD = BL_DOC.replace(b"Consignee (Non-Negotiable): EAST BRIGHT FZ-LLC",
                        b"To the Order of: UAB NOVAKOPA")


def test_upload_compare_reports_a_mismatch(client):
    c, _ = client
    r = c.post("/api/compare", files=[
        ("files", ("si.txt", SI_DOC, "text/plain")),
        ("files", ("bl.txt", BL_BAD, "text/plain")),
    ])
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "MISMATCH"
    assert "consignee" in body["defect_fields"]
    assert len(body["verdicts"]) == 7


def test_upload_compare_reports_a_clean_pair(client):
    c, _ = client
    r = c.post("/api/compare", files=[
        ("files", ("si.txt", SI_DOC, "text/plain")),
        ("files", ("bl.txt", BL_DOC, "text/plain")),
    ])
    assert r.json()["status"] == "OK"


def test_upload_compare_rejects_a_single_file(client):
    c, _ = client
    r = c.post("/api/compare", files=[
        ("files", ("si.txt", SI_DOC, "text/plain")),
    ])
    assert r.status_code == 400
    assert "two documents" in r.json()["detail"]


def test_try_email_runs_the_whole_pipeline(client, monkeypatch):
    import sdoc.adhoc as adhoc
    monkeypatch.setattr(adhoc, "_default_classifier",
                        lambda settings: ((lambda e: "BL_COMPARISON"), "stub"))
    c, _ = client
    r = c.post("/api/try-email", data={
        "subject": "TO CONFIRM DOCS", "body": "Please check the attached docs.",
    }, files=[
        ("files", ("si.txt", SI_DOC, "text/plain")),
        ("files", ("bl.txt", BL_BAD, "text/plain")),
    ])
    assert r.status_code == 200
    body = r.json()
    assert body["category"] == "BL_COMPARISON"
    assert body["status"] == "MISMATCH"
    assert "consignee" in body["defect_fields"]


def test_try_email_works_with_no_attachments(client, monkeypatch):
    import sdoc.adhoc as adhoc
    monkeypatch.setattr(adhoc, "_default_classifier",
                        lambda settings: ((lambda e: "SPAM"), "stub"))
    c, _ = client
    r = c.post("/api/try-email", data={
        "subject": "Increase your revenue with this ONE weird trick",
        "body": "Click here.",
    })
    assert r.status_code == 200
    assert r.json()["category"] == "SPAM"


def test_try_email_rejects_an_empty_email(client):
    c, _ = client
    r = c.post("/api/try-email", data={"subject": "", "body": ""})
    assert r.status_code == 400


# ---------------------------------------------------------------------------
# Original-email enrichment. Read-only, best-effort, and never able to change
# what the scored run concluded.
# ---------------------------------------------------------------------------

@pytest.fixture
def inbox_client(tmp_path):
    run_path = tmp_path / "run.json"
    run_path.write_text(json.dumps(RUN), encoding="utf-8")
    inbox = tmp_path / "inbox"
    inbox.mkdir()
    (inbox / "email_004.json").write_text(json.dumps({
        "email_id": "email_004", "from": "ops@example.test", "subject": "Check docs",
        "body": "Please compare the SI and draft BL.",
        "attachments": ["attachments/si_004.pdf", "attachments/bl_004.pdf"],
    }), encoding="utf-8")
    return TestClient(create_app(run_path=str(run_path),
                                 store=AliasStore(root=str(tmp_path / "aliases")),
                                 inbox_dir=str(inbox)))


def test_detail_includes_body_and_attachment_names(inbox_client):
    body = inbox_client.get("/api/emails/email_004").json()
    assert body["body"] == "Please compare the SI and draft BL."
    assert body["attachment_names"] == ["si_004.pdf", "bl_004.pdf"]


def test_enrichment_never_overrides_the_scored_run(inbox_client):
    body = inbox_client.get("/api/emails/email_004").json()
    assert body["status"] == "MISMATCH"
    assert body["defect_fields"] == ["consignee"]
    assert len(body["verdicts"]) == 2


def test_detail_works_when_the_email_has_no_inbox_file(inbox_client):
    body = inbox_client.get("/api/emails/email_001").json()
    assert body["status"] == "OK"
    assert "body" not in body


def test_detail_works_when_there_is_no_inbox_at_all(client):
    c, _ = client
    body = c.get("/api/emails/email_004").json()
    assert body["defect_fields"] == ["consignee"]
    assert "body" not in body


def test_malformed_inbox_file_is_ignored_rather_than_raising(tmp_path):
    run_path = tmp_path / "run.json"
    run_path.write_text(json.dumps(RUN), encoding="utf-8")
    inbox = tmp_path / "inbox"
    inbox.mkdir()
    (inbox / "email_004.json").write_text("{not json", encoding="utf-8")
    c = TestClient(create_app(run_path=str(run_path),
                              store=AliasStore(root=str(tmp_path / "aliases")),
                              inbox_dir=str(inbox)))
    assert c.get("/api/emails/email_004").json()["status"] == "MISMATCH"


@pytest.mark.parametrize("email_id", [
    "../run", "..%2frun", "email_004/../../run", "a" * 65, "email 004",
])
def test_ids_that_are_not_run_keys_are_404_not_file_reads(inbox_client, email_id):
    assert inbox_client.get(f"/api/emails/{email_id}").status_code in (404, 400)

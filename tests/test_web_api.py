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


def test_the_app_shell_must_be_revalidated(client):
    """The shell names unversioned assets, so caching it pins the client to an
    old build regardless of what /static serves."""
    c, _ = client
    r = c.get("/")
    assert r.status_code == 200
    assert r.headers["cache-control"] == "no-cache"


def test_static_assets_must_be_revalidated(client):
    """Unversioned filenames plus heuristic caching means a browser can keep
    running a stale bundle after a deploy; no-cache forces a revalidation."""
    c, _ = client
    for asset in ("/static/app.js", "/static/style.css"):
        r = c.get(asset)
        assert r.status_code == 200, asset
        assert r.headers["cache-control"] == "no-cache", asset
        assert r.headers.get("etag"), asset


def test_stats_summarise_the_run(client):
    c, _ = client
    body = c.get("/api/stats").json()
    assert body["categories"]["BL_COMPARISON"] == 2
    assert body["statuses"]["MISMATCH"] == 1
    assert body["total"] == 3


def test_stats_publish_the_averis_benchmark_separately(client):
    """Held-out quality scores must not be confused with live run counts."""
    c, _ = client
    benchmark = c.get("/api/stats").json()["benchmark"]
    assert benchmark == {
        "dataset": "Averis Monash Hackathon Dataset",
        "overall_score": 0.9734,
        "end_to_end_defect_rate": 0.978,
        "defects_caught": 45,
        "defects_total": 46,
        "stage3_defect_f1": 0.989,
        "defect_precision": 1.0,
        "classification_macro_f1": 0.955,
        "reliability": 0.947,
        "escalation_precision": 1.0,
    }


def test_stats_band_the_similarity_scores(client):
    """The dashboard reads this instead of fetching every record's verdicts."""
    c, _ = client
    sim = c.get("/api/stats").json()["similarity_bands"]
    # The fixture has one scored verdict (L3, 0.1) and one unscored (L1, None).
    assert sim["scored"] == 1
    assert sim["bands"] == {"DIFFERENT": 1, "GRAY": 0, "SAME": 0}


def test_stats_similarity_ignores_verdicts_without_a_score(client):
    """gate1 and L1 settle without ever computing a ratio, so they are not
    silently banded as DIFFERENT at 0.0."""
    c, _ = client
    body = c.get("/api/stats").json()
    assert body["layers"]["L1"] == 1          # the unscored verdict is still counted
    bands = body["similarity_bands"]
    assert sum(bands["bands"].values()) == bands["scored"] == 1


def test_stats_publish_the_pipelines_own_thresholds(client):
    """Hardcoding 0.72/0.92 in the frontend would let the chart drift away from
    the values the comparison actually ran at."""
    from sdoc.compare.similarity import DIFFERENT_AT, SAME_AT
    c, _ = client
    sim = c.get("/api/stats").json()["similarity_bands"]
    assert sim["different_at"] == DIFFERENT_AT
    assert sim["same_at"] == SAME_AT


def test_stats_similarity_is_additive(client):
    """The existing keys must survive the addition."""
    c, _ = client
    body = c.get("/api/stats").json()
    # Both designs extended /api/stats. The contract is that the original four
    # keys survive and each addition is additive, not that the set is exact.
    assert {"total", "categories", "statuses", "layers"} <= set(body)
    assert "similarity_bands" in body   # yikkai's band summary
    assert "similarity" in body         # Jeff's histogram buckets
    assert body["total"] == 3 and body["layers"]["L3"] == 1


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


def test_inspect_endpoint_returns_context_and_preview(client):
    c, _ = client
    si = SI_DOC.replace(b"SHIPPING INSTRUCTION",
                        b"SHIPPING INSTRUCTION\nShipping Line: Evergreen Marine")
    si = si.replace(b"POD: KARACHI, PAKISTAN (PKKHI)",
                    b"POD: JAKARTA, INDONESIA (IDJKT)")
    r = c.post("/api/inspect", files=[
        ("files", ("si.txt", si, "text/plain")),
    ])
    assert r.status_code == 200
    body = r.json()
    assert body["shipment_context"]["carrier"] == "EVERGREEN"
    assert body["shipment_context"]["destination_country"] == "ID"
    assert body["detected_fields"]["shipper"].startswith("APRIL FAR EAST")
    assert body["detected_fields"]["consignee"].startswith("EAST BRIGHT")
    assert "SHIPPING INSTRUCTION" in body["documents"][0]["preview"]


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


def test_detail_works_when_there_is_no_inbox_at_all(tmp_path):
    """The deployment ships only run.json, so enrichment must be optional.

    This builds its own app with an inbox directory that does not exist. The
    shared `client` fixture cannot be used here: create_app falls back to
    ./data/inbox, which is present on a machine that has the organiser bundle
    and absent on one that does not — so the assertion would depend on who ran
    the test rather than on the code.
    """
    run_path = tmp_path / "run.json"
    run_path.write_text(json.dumps(RUN), encoding="utf-8")
    app = create_app(run_path=str(run_path),
                     store=AliasStore(root=str(tmp_path / "aliases")),
                     inbox_dir=str(tmp_path / "no-such-inbox"))
    body = TestClient(app).get("/api/emails/email_004").json()
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

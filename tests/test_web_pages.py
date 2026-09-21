import json

import pytest
from fastapi.testclient import TestClient

from web.app import create_app


@pytest.fixture
def client(tmp_path):
    (tmp_path / "run.json").write_text(json.dumps({}), encoding="utf-8")
    return TestClient(create_app(run_path=str(tmp_path / "run.json")))


def test_index_serves_html(client):
    response = client.get("/")
    assert response.status_code == 200
    assert "<html" in response.text.lower() or "<!doctype" in response.text.lower()


def test_index_declares_every_top_level_section(client):
    """The shell owns the four navigable sections.

    Report and Evidence are no longer sections of their own: they are tabs
    inside the inbox detail pane, so they are asserted in the script instead.
    """
    text = client.get("/").text.lower()
    for view in ("overview", "inbox", "review", "try"):
        assert f'data-view="{view}"' in text
        assert f'id="view-{view}"' in text


def test_detail_pane_offers_the_report_and_evidence_tabs(client):
    script = client.get("/static/app.js").text.lower()
    for tab in ("report", "evidence"):
        assert f'data-tab="{tab}"' in script


def test_static_assets_are_revalidated(client):
    """A redeploy must not leave a browser on a cached front end."""
    for asset in ("/static/app.js", "/static/style.css"):
        assert client.get(asset).headers["cache-control"] == "no-cache"


def test_static_assets_are_served(client):
    assert client.get("/static/app.js").status_code == 200
    assert client.get("/static/style.css").status_code == 200


def test_defect_metric_opens_missed_case_reconstruction(client):
    html = client.get("/").text
    script = client.get("/static/app.js").text
    assert 'id="defect-dialog"' in html
    assert 'id="defect-detection-card"' in script
    assert "email_407" in script
    assert "unlabelled continuation" in script
    assert "Layout-aware OCR" in script

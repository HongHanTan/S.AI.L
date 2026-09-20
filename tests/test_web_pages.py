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


def test_index_declares_all_four_views(client):
    text = client.get("/").text
    for view in ("inbox", "report", "evidence", "review"):
        assert view in text.lower()


def test_static_assets_are_served(client):
    assert client.get("/static/app.js").status_code == 200
    assert client.get("/static/style.css").status_code == 200

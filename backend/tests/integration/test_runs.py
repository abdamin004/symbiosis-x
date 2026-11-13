"""Exercise real run commands against temporary SQLite storage."""

import sqlite3
from contextlib import closing

from fastapi.testclient import TestClient

from symbiosis_x.main import create_app

START = {"start_id": "start-01", "scenario_id": "nominal", "scenario_version": "1", "seed": 4242}


def local_client(database):
    return TestClient(create_app(database_path=database, enable_local_demo=True),
                      base_url="http://127.0.0.1", client=("127.0.0.1", 60000))


def authenticate(client, role="facilitator"):
    response = client.post("/api/v1/demo/session")
    assert response.status_code == 200
    client.headers["Authorization"] = "Bearer " + response.json()[role]


def test_start_seed_at_zero(tmp_path):
    database = tmp_path / "runs.sqlite3"
    with local_client(database) as client:
        authenticate(client)
        response = client.post("/api/v1/runs", json=START)
        assert response.status_code == 200
        receipt = response.json()
        assert receipt["run_id"]
        assert receipt == {**{key: START[key] for key in ("scenario_id", "scenario_version", "seed")},
                           "run_id": receipt["run_id"], "mission_s": 0, "step": 0}
        assert client.post("/api/v1/runs", json={**START, "seed": 1}).status_code == 409
        assert client.post("/api/v1/runs", json={**START, "start_id": "another", "scenario_id": "unknown"}).status_code == 404
        assert client.post("/api/v1/runs", json={**START, "role": "facilitator"}).status_code == 422
        assert client.post("/api/v1/runs", json=START, headers={"Origin": "http://elsewhere.test"}).status_code == 403
    with local_client(database) as restarted:
        authenticate(restarted)
        assert restarted.post("/api/v1/runs", json=START).json() == receipt
    with closing(sqlite3.connect(database)) as db:
        assert db.execute("SELECT run_id, mission_s FROM runs").fetchall() == [(receipt["run_id"], 0)]
        assert db.execute("SELECT event_type FROM events").fetchall() == [("run.started",)]


def test_duplicate_advance_returns_one_receipt(tmp_path):
    database = tmp_path / "runs.sqlite3"
    with local_client(database) as client:
        authenticate(client)
        original = client.post("/api/v1/runs", json=START).json()
        url = f"/api/v1/runs/{original['run_id']}/advance"
        advance = {"advance_id": "advance-01", "expected_step": 0}
        response = client.post(url, json=advance)
        assert response.status_code == 200
        receipt = response.json()
        assert receipt == {**original, "step": 1, "mission_s": 60, "advance_id": "advance-01"}
        assert client.post(url, json={**advance, "advance_id": "competing"}).json() == {"detail": "STALE_STEP"}
        assert client.post(url, json={**advance, "expected_step": 1}).json() == {"detail": "ADVANCE_ID_REUSED"}
        assert client.post(url, json={"advance_id": "new", "expected_step": 1}).json() == {"detail": "NO_NEXT_STEP"}
        assert client.post(url, json=advance, headers={"Origin": "http://elsewhere.test"}).status_code == 403
    with local_client(database) as restarted:
        authenticate(restarted)
        assert restarted.post(url, json=advance).json() == receipt
        assert restarted.post("/api/v1/runs", json=START).json() == original
    with closing(sqlite3.connect(database)) as db:
        assert db.execute("SELECT mission_s, decision_rev FROM runs").fetchall() == [(60, 0)]
        assert db.execute("SELECT event_seq, event_type FROM events ORDER BY event_seq").fetchall() == [
            (1, "run.started"), (2, "run.advanced"),
        ]
        assert db.execute("SELECT count(*) FROM operations").fetchone() == (1,)

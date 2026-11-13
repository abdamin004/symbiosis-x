"""Exercise real run commands against temporary SQLite storage."""

import sqlite3
from contextlib import closing

from fastapi.testclient import TestClient

from symbiosis_x.main import create_app

START = {"start_id": "start-01", "scenario_id": "nominal", "scenario_version": "1", "seed": 4242}


def local_client(database):
    return TestClient(create_app(database_path=database),
                      base_url="http://127.0.0.1", client=("127.0.0.1", 60000))


def test_start_seed_at_zero(tmp_path):
    database = tmp_path / "runs.sqlite3"
    with local_client(database) as client:
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
        assert restarted.post("/api/v1/runs", json=START).json() == receipt
    with closing(sqlite3.connect(database)) as db:
        assert db.execute("SELECT run_id, mission_s FROM runs").fetchall() == [(receipt["run_id"], 0)]
        assert db.execute("SELECT event_type FROM events").fetchall() == [("run.started",)]

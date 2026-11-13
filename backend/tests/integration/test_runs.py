"""Exercise real run commands against temporary SQLite storage."""

import sqlite3
from contextlib import closing
from symbiosis_x.application.runs import reset_run
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
        assert db.execute("SELECT event_type FROM events").fetchall() == [("run.started",), ("observation.recorded",)]


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
            (1, "run.started"), (2, "observation.recorded"),
            (3, "run.advanced"), (4, "observation.recorded"),
        ]
        assert db.execute("SELECT count(*) FROM operations").fetchone() == (1,)

def test_reset_closes_old_run(tmp_path):
    database = tmp_path / "reset.sqlite3"

    with local_client(database) as client:
        authenticate(client)

        original = client.post(
            "/api/v1/runs", json=START
        ).json()

        old_run_id = original["run_id"]

        replacement = reset_run(
            client.app.state.repository,
            old_run_id,
        )

        assert replacement.run_id != old_run_id
        assert replacement.mission_s == 0
        assert replacement.step == 0

    # Restart the application and verify persistence.
    with local_client(database) as restarted:
        authenticate(restarted)

        old_advance = restarted.post(
            f"/api/v1/runs/{old_run_id}/advance",
            json={"advance_id": "after-reset", "expected_step": 0},
        )

        assert old_advance.status_code == 409
        assert old_advance.json()["detail"] == "RUN_CLOSED"

    with closing(sqlite3.connect(database)) as db:
        old_run = db.execute(
            "SELECT status FROM runs WHERE run_id = ?",
            (old_run_id,),
        ).fetchone()

        new_run = db.execute(
            """SELECT status, mission_s, reset_from_run_id
               FROM runs WHERE run_id = ?""",
            (replacement.run_id,),
        ).fetchone()

        assert old_run == ("closed",)
        assert new_run == ("active", 0, old_run_id)

        events = db.execute(
            """SELECT event_type FROM events
               WHERE run_id = ? ORDER BY event_seq""",
            (old_run_id,),
        ).fetchall()

        assert ("run.closed",) in events

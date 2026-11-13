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
    database = tmp_path / "runs.sqlite3"
    with local_client(database) as client:
        tokens = client.post("/api/v1/demo/session").json()
        client.headers["Authorization"] = "Bearer " + tokens["facilitator"]
        old = client.post("/api/v1/runs", json=START).json()
        old_url = f"/api/v1/runs/{old['run_id']}"
        assert client.post(old_url + "/advance", json={"advance_id": "a-1", "expected_step": 0}).status_code == 200

        reset = {"reset_id": "reset-01"}
        response = client.post(old_url + "/reset", json=reset)
        assert response.status_code == 200
        receipt = response.json()
        assert receipt["run_id"] != old["run_id"]
        assert receipt == {**{key: START[key] for key in ("scenario_id", "scenario_version", "seed")},
                           "run_id": receipt["run_id"], "mission_s": 0, "step": 0,
                           "reset_id": "reset-01", "reset_from_run_id": old["run_id"]}

        assert client.post(old_url + "/reset", json=reset).json() == receipt
        assert client.post(old_url + "/reset", json={"reset_id": "reset-02"}).json() == {"detail": "RUN_CLOSED"}
        assert client.post(old_url + "/advance", json={"advance_id": "a-2", "expected_step": 1}).json() == {
            "detail": "RUN_CLOSED"}
        assert client.post("/api/v1/runs/missing/reset", json=reset).json() == {"detail": "RUN_NOT_FOUND"}
        assert client.post(old_url + "/reset", json={**reset, "seed": 1}).status_code == 422
        assert client.post(old_url + "/reset", json=reset, headers={"Origin": "http://elsewhere.test"}).status_code == 403
        assert client.post(old_url + "/reset", json=reset,
                           headers={"Authorization": "Bearer " + tokens["crew"]}).status_code == 403

    with local_client(database) as restarted:
        tokens = restarted.post("/api/v1/demo/session").json()
        restarted.headers["Authorization"] = "Bearer " + tokens["facilitator"]
        assert restarted.post(old_url + "/reset", json=reset).json() == receipt
        assert restarted.post(old_url + "/advance", json={"advance_id": "a-2", "expected_step": 1}).json() == {
            "detail": "RUN_CLOSED"}
        new_url = f"/api/v1/runs/{receipt['run_id']}"
        assert restarted.post(new_url + "/advance", json={"advance_id": "a-1", "expected_step": 0}).json()[
            "mission_s"] == 60
        old_view = restarted.get(old_url + "/crew", headers={"Authorization": "Bearer " + tokens["crew"]})
        assert old_view.status_code == 200
        assert (old_view.json()["run_id"], old_view.json()["mission_s"]) == (old["run_id"], 60)

    with closing(sqlite3.connect(database)) as db:
        runs = dict((row[0], row[1:]) for row in db.execute(
            "SELECT run_id, status, mission_s, reset_from_run_id FROM runs"))
        assert runs == {old["run_id"]: ("closed", 60, None),
                        receipt["run_id"]: ("active", 60, old["run_id"])}
        assert db.execute(
            "SELECT event_type FROM events WHERE run_id = ? ORDER BY event_seq", (old["run_id"],)
        ).fetchall() == [("run.started",), ("observation.recorded",), ("run.advanced",),
                         ("observation.recorded",), ("run.closed",)]
        assert db.execute(
            "SELECT event_type FROM events WHERE run_id = ? ORDER BY event_seq LIMIT 2", (receipt["run_id"],)
        ).fetchall() == [("run.started",), ("observation.recorded",)]

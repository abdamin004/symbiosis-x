"""Private Crew check-ins persist without entering operational or Ground data."""

import sqlite3
from contextlib import closing

from fastapi.testclient import TestClient

from symbiosis_x.main import create_app


START = {
    "start_id": "private-checkin-test",
    "scenario_id": "nominal",
    "scenario_version": "1",
    "seed": 42,
}
CHECK_IN = {
    "check_in_id": "checkin-sim01-01",
    "crew_id": "SIM-01",
    "note": "Fictional check-in for the integration test.",
    "synthetic": True,
}


def make_client(database):
    return TestClient(
        create_app(database_path=database, enable_local_demo=True),
        base_url="http://127.0.0.1",
        client=("127.0.0.1", 60000),
    )


def tokens(client):
    response = client.post("/api/v1/demo/session")
    assert response.status_code == 200
    return response.json()


def auth(client, token):
    client.headers["Authorization"] = f"Bearer {token}"


def test_private_checkin_is_persisted_and_role_restricted(tmp_path):
    database = tmp_path / "private-checkins.sqlite3"
    with make_client(database) as client:
        credentials = tokens(client)
        auth(client, credentials["facilitator"])
        started = client.post("/api/v1/runs", json=START)
        assert started.status_code == 200
        run_id = started.json()["run_id"]

        url = f"/api/v1/runs/{run_id}/crew/check-ins"
        auth(client, credentials["crew"])
        created = client.post(url, json=CHECK_IN)
        assert created.status_code == 201, created.text
        receipt = created.json()
        assert receipt == {
            **CHECK_IN,
            "run_id": run_id,
            "mission_s": 0,
        }
        assert client.post(url, json=CHECK_IN).json() == receipt
        assert client.post(url, json={**CHECK_IN, "note": "changed"}).status_code == 409
        assert client.get(f"{url}/{CHECK_IN['check_in_id']}").json() == receipt

        # Crew-private content is not exposed through the operational Ground projection.
        auth(client, credentials["ground"])
        assert client.get(f"/api/v1/runs/{run_id}/ground").status_code in (200, 404)
        assert client.get(f"{url}/{CHECK_IN['check_in_id']}").status_code == 403
        assert client.post(url, json=CHECK_IN).status_code == 403

    with closing(sqlite3.connect(database)) as db:
        event = db.execute(
            """SELECT event_type, visibility, payload_json FROM events
               WHERE run_id = ? AND event_id = ?""",
            (run_id, CHECK_IN["check_in_id"]),
        ).fetchone()
        assert event[0:2] == ("crew.check_in", "crew")
        assert CHECK_IN["note"] in event[2]
        assert db.execute(
            "SELECT COUNT(*) FROM telemetry_observations WHERE run_id = ?",
            (run_id,),
        ).fetchone() == (1,)

    with make_client(database) as restarted:
        credentials = tokens(restarted)
        auth(restarted, credentials["crew"])
        persisted = restarted.get(
            f"/api/v1/runs/{run_id}/crew/check-ins/{CHECK_IN['check_in_id']}"
        )
        assert persisted.status_code == 200
        assert persisted.json() == receipt


def test_checkin_requires_synthetic_roster_member_and_active_run(tmp_path):
    database = tmp_path / "private-validation.sqlite3"
    with make_client(database) as client:
        credentials = tokens(client)
        auth(client, credentials["facilitator"])
        run_id = client.post("/api/v1/runs", json=START).json()["run_id"]
        auth(client, credentials["crew"])

        url = f"/api/v1/runs/{run_id}/crew/check-ins"
        assert client.post(url, json={**CHECK_IN, "synthetic": False}).status_code == 422
        assert client.post(url, json={**CHECK_IN, "crew_id": "NOT-ON-ROSTER"}).status_code == 409
        assert client.post(url, json={**CHECK_IN, "note": "   "}).status_code == 409

        auth(client, credentials["facilitator"])
        reset = client.post(
            f"/api/v1/runs/{run_id}/reset",
            json={"reset_id": "reset-checkin-test"},
        )
        assert reset.status_code == 200
        auth(client, credentials["crew"])
        assert client.post(url, json={**CHECK_IN, "check_in_id": "after-close"}).status_code == 409

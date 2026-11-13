
"""SX-04D: Private check-ins are accessible to Crew only."""

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


def make_client(database):
    return TestClient(
        create_app(
            database_path=database,
            enable_local_demo=True,
        ),
        base_url="http://127.0.0.1",
        client=("127.0.0.1", 60000),
    )


def get_tokens(client):
    response = client.post("/api/v1/demo/session")
    assert response.status_code == 200, response.text
    return response.json()


def authorize(client, token):
    client.headers["Authorization"] = f"Bearer {token}"


def test_checkin_round_trip_is_crew_only(tmp_path):
    database = tmp_path / "crew_checkins.sqlite3"

    with make_client(database) as client:
        tokens = get_tokens(client)

        # Start a simulation as facilitator.
        authorize(client, tokens["facilitator"])

        start_response = client.post(
            "/api/v1/runs",
            json=START,
        )
        assert start_response.status_code == 200

        run_id = start_response.json()["run_id"]

        checkin_url = (
            f"/api/v1/runs/{run_id}/crew/check-ins"
        )

        # Crew can submit a synthetic check-in.
        authorize(client, tokens["crew"])

        payload = {
            "crew_id": "crew-member-01",
            "note": "Feeling well during the simulation.",
            "synthetic": True,
        }

        create_response = client.post(
            checkin_url,
            json=payload,
        )

        assert create_response.status_code == 201, (
            create_response.text
        )

        record = create_response.json()

        assert record["run_id"] == run_id
        assert record["crew_id"] == payload["crew_id"]
        assert record["note"] == payload["note"]
        assert record["synthetic"] is True

        record_id = record["record_id"]
        assert record_id

        read_url = f"{checkin_url}/{record_id}"

        # Crew can retrieve the authorized record.
        read_response = client.get(read_url)

        assert read_response.status_code == 200
        assert read_response.json() == record

        # Ground cannot create a private check-in.
        authorize(client, tokens["ground"])

        denied_write = client.post(
            checkin_url,
            json=payload,
        )
        assert denied_write.status_code in (401, 403)

        # Ground cannot read a private check-in.
        denied_read = client.get(read_url)
        assert denied_read.status_code in (401, 403)

        # Ground cannot access the Crew projection.
        denied_projection = client.get(
            f"/api/v1/runs/{run_id}/crew"
        )
        assert denied_projection.status_code in (401, 403)

    # Confirm the private record was persisted.
    with closing(sqlite3.connect(database)) as db:
        saved = db.execute(
            """SELECT event_type, visibility
               FROM events
               WHERE run_id = ? AND event_id = ?""",
            (run_id, record_id),
        ).fetchone()

        assert saved == ("crew.check_in", "crew")

    # Restart: Crew can still read the saved check-in.
    with make_client(database) as restarted:
        new_tokens = get_tokens(restarted)
        authorize(restarted, new_tokens["crew"])

        persisted = restarted.get(read_url)

        assert persisted.status_code == 200
        assert persisted.json() == record


def test_reject_non_synthetic_checkin(tmp_path):
    database = tmp_path / "invalid_checkin.sqlite3"

    with make_client(database) as client:
        tokens = get_tokens(client)
        authorize(client, tokens["facilitator"])

        response = client.post(
            "/api/v1/runs",
            json=START,
        )
        assert response.status_code == 200
        run_id = response.json()["run_id"]

        authorize(client, tokens["crew"])

        response = client.post(
            f"/api/v1/runs/{run_id}/crew/check-ins",
            json={
                "crew_id": "crew-member-01",
                "note": "Private test",
                "synthetic": False,
            },
        )

        assert response.status_code == 422

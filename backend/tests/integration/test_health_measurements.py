"""SX-24D: typed synthetic health data remains a private, durable Crew-only lane."""

import sqlite3
from contextlib import closing

from test_runs import START, local_client


READING = {
    "measurement_id": "hr-sim-01-0001",
    "crew_id": "SIM-01",
    "synthetic": True,
    "measurement": {
        "metric": "heart_rate", "value": 95, "unit": "bpm", "quality": "valid",
        "observed_at_s": 0, "source_id": "synthetic.watch.sim-01",
    },
    "context": {"activity": "rest"},
}


def test_measurement_is_private_and_idempotent(tmp_path):
    database = tmp_path / "health-measurements.sqlite3"
    with local_client(database) as client:
        tokens = client.post("/api/v1/demo/session").json()
        headers = lambda role: {"Authorization": "Bearer " + tokens[role]}  # noqa: E731
        started = client.post("/api/v1/runs", json=START, headers=headers("facilitator"))
        assert started.status_code == 200
        run_id = started.json()["run_id"]
        url = f"/api/v1/runs/{run_id}/crew/measurements"
        created = client.post(url, json=READING, headers=headers("crew"))
        assert created.status_code == 201, created.text
        receipt = created.json()
        assert receipt["measurement_id"] == READING["measurement_id"]
        assert receipt["measurement"]["value"] == 95
        assert receipt["received_at_s"] == 0
        assert created.headers["Cache-Control"] == "no-store"

        assert client.post(url, json=READING, headers=headers("crew")).json() == receipt
        assert client.post(url, json={**READING, "context": {"activity": "exercise"}},
                           headers=headers("crew")).status_code == 409
        assert client.get(url + "/" + READING["measurement_id"],
                          headers=headers("crew")).json() == receipt
        assert client.post(url, json=READING, headers=headers("ground")).status_code == 403
        assert client.get(url + "/" + READING["measurement_id"],
                          headers=headers("ground")).status_code == 403
        assert client.post(url, json={**READING, "synthetic": False},
                           headers=headers("crew")).status_code == 422
        assert client.post(url, json={**READING, "measurement_id": "bad-crew", "crew_id": "REAL-01"},
                           headers=headers("crew")).status_code == 422
        assert client.post(url, json={**READING, "measurement_id": "future",
                                     "measurement": {**READING["measurement"], "observed_at_s": 100}},
                           headers=headers("crew")).status_code == 422
        ground = client.get(f"/api/v1/runs/{run_id}/ground", headers=headers("ground"))
        assert ground.status_code == 200
        assert "synthetic.watch.sim-01" not in ground.text
    with closing(sqlite3.connect(database)) as db:
        assert db.execute(
            "SELECT count(*) FROM events WHERE event_type = 'crew.health_measurement' AND visibility = 'crew'"
        ).fetchone() == (1,)
        assert db.execute(
            "SELECT metric, numeric_value, unit FROM health_observations"
        ).fetchall() == [("heart_rate", 95.0, "bpm")]
    with local_client(database) as restarted:
        tokens = restarted.post("/api/v1/demo/session").json()
        receipt_again = restarted.get(url + "/" + READING["measurement_id"],
                                      headers={"Authorization": "Bearer " + tokens["crew"]})
        assert receipt_again.status_code == 200
        assert receipt_again.json() == receipt

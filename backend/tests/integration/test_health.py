"""Service probes answer without depending on, or changing, the run store."""

import sqlite3
from contextlib import closing

from fastapi.testclient import TestClient

from symbiosis_x.main import create_app

START = {"start_id": "start-01", "scenario_id": "nominal", "scenario_version": "1", "seed": 4242}


def test_live_does_not_require_ready_store(tmp_path):
    unavailable = tmp_path / "missing-directory" / "never-created.sqlite3"
    app = create_app(database_path=unavailable)

    # Without entering the lifespan the store is never migrated or opened.
    response = TestClient(app).get("/health/live")

    assert response.status_code == 200
    assert response.json() == {"status": "live"}
    assert response.headers["cache-control"] == "no-store"
    assert not unavailable.parent.exists()


def test_live_leaves_mission_time_unchanged(tmp_path):
    database = tmp_path / "runs.sqlite3"
    app = create_app(database_path=database, enable_local_demo=True)
    with TestClient(app, base_url="http://127.0.0.1", client=("127.0.0.1", 60000)) as client:
        token = client.post("/api/v1/demo/session").json()["facilitator"]
        client.headers["Authorization"] = "Bearer " + token
        run_id = client.post("/api/v1/runs", json=START).json()["run_id"]
        with closing(sqlite3.connect(database)) as db:
            before = db.execute("SELECT mission_s, (SELECT count(*) FROM events) FROM runs").fetchall()

        del client.headers["Authorization"]
        for _ in range(3):
            assert client.get("/health/live").status_code == 200

    with closing(sqlite3.connect(database)) as db:
        after = db.execute("SELECT mission_s, (SELECT count(*) FROM events) FROM runs").fetchall()
    assert before == after == [(0, 2)]
    assert run_id

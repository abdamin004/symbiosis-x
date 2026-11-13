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


def ready_client(database, manifest=None):
    app = create_app(database_path=database, golden_manifest_path=manifest, enable_local_demo=True)
    return TestClient(app, base_url="http://127.0.0.1", client=("127.0.0.1", 60000))


def cursor(database):
    with closing(sqlite3.connect(database)) as db:
        return db.execute("SELECT mission_s, (SELECT count(*) FROM events) FROM runs").fetchall()


def test_ready_checks_schema_without_advancing_run(tmp_path):
    database = tmp_path / "runs.sqlite3"
    with ready_client(database) as client:
        token = client.post("/api/v1/demo/session").json()["facilitator"]
        run_id = client.post("/api/v1/runs", json=START,
                             headers={"Authorization": "Bearer " + token}).json()["run_id"]
        before = cursor(database)
        for _ in range(3):
            response = client.get("/health/ready")
            assert response.status_code == 200
        assert response.json() == {"status": "ready", "reason": None,
                                   "checks": {"store": "ok", "schema": "ok", "manifest": "ok"}}
        assert response.headers["cache-control"] == "no-store"
        assert cursor(database) == before
        assert run_id

        # A schema revision the code does not expect makes the service unready without repairing it.
        with closing(sqlite3.connect(database)) as db:
            db.execute("PRAGMA user_version = 2")
        response = client.get("/health/ready")
        assert response.status_code == 503
        assert response.json() == {"status": "not_ready", "reason": "SCHEMA_MISMATCH",
                                   "checks": {"store": "ok", "schema": "mismatch", "manifest": "ok"}}
        with closing(sqlite3.connect(database)) as db:
            assert db.execute("PRAGMA user_version").fetchone() == (2,)
        assert cursor(database) == before


def test_ready_reports_bounded_reasons_without_paths(tmp_path):
    database = tmp_path / "runs.sqlite3"
    missing = tmp_path / "secret-folder" / "absent.json"
    with ready_client(database, missing) as client:
        response = client.get("/health/ready")
    assert response.status_code == 503
    assert response.json()["reason"] == "MANIFEST_MISSING"
    assert response.json()["checks"]["manifest"] == "missing"
    assert "secret-folder" not in response.text and str(tmp_path) not in response.text

    broken = tmp_path / "broken.json"
    for content in ("{not json", '{"scenario_id": "sx01-golden"}'):
        broken.write_text(content, encoding="utf-8")
        with ready_client(database, broken) as client:
            response = client.get("/health/ready")
        assert response.status_code == 503
        assert response.json()["reason"] == "MANIFEST_INVALID"
        assert str(tmp_path) not in response.text


def test_ready_never_creates_the_store(tmp_path):
    never_created = tmp_path / "not-yet.sqlite3"
    # Without the lifespan nothing has migrated the store yet.
    response = TestClient(create_app(database_path=never_created)).get("/health/ready")
    assert response.status_code == 503
    assert response.json() == {"status": "not_ready", "reason": "STORE_UNAVAILABLE",
                               "checks": {"store": "unavailable", "schema": "unknown", "manifest": "ok"}}
    assert not never_created.exists()

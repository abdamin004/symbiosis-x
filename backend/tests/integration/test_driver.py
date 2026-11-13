"""SX-15B and SX-15: optional driver shares the manual cursor and honors pause."""

from test_runs import START, local_client


def test_driver_shares_advance_cursor(tmp_path):
    with local_client(tmp_path / "driver.sqlite3") as client:
        tokens = client.post("/api/v1/demo/session").json()
        auth = {"Authorization": "Bearer " + tokens["facilitator"]}
        run_id = client.post("/api/v1/runs", json=START, headers=auth).json()["run_id"]
        root = f"/api/v1/runs/{run_id}"

        manual = client.post(root + "/advance", json={
            "advance_id": "manual-first", "expected_step": 0,
        }, headers=auth)
        assert manual.status_code == 200
        assert manual.json()["mission_s"] == 60

        driver_late = client.post(root + "/driver/advance", json={
            "advance_id": "driver-late", "expected_step": 0,
        }, headers=auth)
        assert driver_late.status_code == 409
        assert driver_late.json()["detail"] == "STALE_STEP"

        driver = client.post(root + "/driver/advance", json={
            "advance_id": "driver-second", "expected_step": 1,
        }, headers=auth)
        assert driver.status_code == 409
        assert driver.json()["detail"] == "NO_NEXT_STEP"

        with client.app.state.repository.read() as db:
            assert db.execute("SELECT mission_s FROM runs WHERE run_id = ?", (run_id,)).fetchone()[0] == 60
            assert db.execute(
                "SELECT count(*) FROM events WHERE run_id = ? AND event_type = 'run.advanced'",
                (run_id,),
            ).fetchone()[0] == 1


def test_pause_stops_automatic_advance(tmp_path):
    with local_client(tmp_path / "pause.sqlite3") as client:
        tokens = client.post("/api/v1/demo/session").json()
        auth = {"Authorization": "Bearer " + tokens["facilitator"]}
        run_id = client.post("/api/v1/runs", json=START, headers=auth).json()["run_id"]
        root = f"/api/v1/runs/{run_id}"

        paused = client.post(root + "/driver/pause", json={"paused": True}, headers=auth)
        assert paused.status_code == 200
        assert paused.json() == {"run_id": run_id, "paused": True, "mission_s": 0}

        blocked = client.post(root + "/driver/advance", json={
            "advance_id": "driver-paused", "expected_step": 0,
        }, headers=auth)
        assert blocked.status_code == 409
        assert blocked.json()["detail"] == "DRIVER_PAUSED"

        # Pause controls the automatic driver only; manual facilitator stepping remains available.
        manual = client.post(root + "/advance", json={
            "advance_id": "manual-while-paused", "expected_step": 0,
        }, headers=auth)
        assert manual.status_code == 200
        assert manual.json()["mission_s"] == 60

        resumed = client.post(root + "/driver/pause", json={"paused": False}, headers=auth)
        assert resumed.status_code == 200
        assert resumed.json()["paused"] is False
        blocked_stale = client.post(root + "/driver/advance", json={
            "advance_id": "driver-old-cursor", "expected_step": 0,
        }, headers=auth)
        assert blocked_stale.status_code == 409
        assert blocked_stale.json()["detail"] == "STALE_STEP"

        assert client.post(root + "/driver/pause", json={"paused": True},
                           headers={"Authorization": "Bearer " + tokens["ground"]}).status_code == 403

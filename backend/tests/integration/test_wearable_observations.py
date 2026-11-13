import json
import sqlite3
from contextlib import closing

from test_runs import START, local_client


def test_dropout_and_late_sample_preserve_last_accepted_wearable_reading(tmp_path):
    database = tmp_path / "wearables.sqlite3"
    with local_client(database) as client:
        tokens = client.post("/api/v1/demo/session").json()
        headers = {role: {"Authorization": f"Bearer {token}"} for role, token in tokens.items()}

        def run_history(start_id):
            started = client.post(
                "/api/v1/runs", json={**START, "scenario_id": "crew-wearables", "start_id": start_id},
                headers=headers["facilitator"],
            )
            assert started.status_code == 200, started.text
            run_id = started.json()["run_id"]
            base = f"/api/v1/runs/{run_id}"
            url = base + "/crew/wearables"
            results = {}
            for step, time in enumerate((0, 20, 50, 60, 70, 71, 72, 90, 100, 120)):
                if step:
                    command = {"advance_id": f"a-{step}", "expected_step": step - 1}
                    response = client.post(base + "/advance", json=command, headers=headers["facilitator"])
                    assert response.status_code == 200, response.text
                    assert response.json()["mission_s"] == time
                    retry = client.post(base + "/advance", json=command, headers=headers["facilitator"])
                    assert retry.json() == response.json()
                response = client.get(url, params={"crew_id": "SIM-02"}, headers=headers["crew"])
                assert response.status_code == 200, response.text
                assert response.headers["Cache-Control"] == "no-store"
                result = response.json()
                assert result["mission_s"] == time
                results[time] = result["channels"]

            response = client.get(url, params={"crew_id": "SIM-01"}, headers=headers["crew"])
            assert all(channel["reading"]["status"] == "missing" for channel in response.json()["channels"].values())
            assert client.get(url, params={"crew_id": "SIM-02"}, headers=headers["ground"]).status_code == 403
            ground = client.get(base + "/ground", headers=headers["ground"])
            assert ground.status_code == 200
            assert "sim.crew.wristband" not in ground.text
            assert "MOTION_ARTIFACT" not in ground.text
            return run_id, results

        run_id, results = run_history("one")
        other_run_id, other = run_history("two")
        assert run_id != other_run_id
        for time in results:
            assert json.loads(json.dumps(results[time]).replace(run_id, other_run_id)) == other[time]

        def wrist(time):
            return results[time]["wristband"]["reading"]
        assert (wrist(20)["status"], wrist(20)["age_s"]) == ("held", 20)
        assert wrist(20)["evidence"]["quality"] == "unavailable"
        assert wrist(60)["accepted"]["value"] == 74
        assert wrist(70)["status"] == "stale"
        assert results[70]["back_pod"]["reading"]["status"] == "missing"
        assert results[71]["back_pod"]["reading"]["accepted"]["value"] == 0.8
        assert wrist(72)["evidence"]["quality"] == "suspect"
        assert wrist(72)["accepted"]["value"] == 74
        assert wrist(100)["accepted"]["value"] == 74

    with closing(sqlite3.connect(database)) as db:
        assert db.execute(
            "SELECT count(*) FROM health_observations WHERE run_id = ?", (run_id,),
        ).fetchone() == (6,)
        assert db.execute(
            "SELECT DISTINCT visibility, crew_id FROM health_observations",
        ).fetchall() == [("crew", "SIM-02")]

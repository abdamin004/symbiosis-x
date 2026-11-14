"""Verify the synthetic health profile is available to Crew only."""

import json

from test_runs import START, authenticate, local_client


def test_profile_is_crew_only(tmp_path):
    with local_client(tmp_path / "health-profile.sqlite3") as client:
        authenticate(client)
        started = client.post("/api/v1/runs", json=START)
        assert started.status_code == 200
        run_id = started.json()["run_id"]
        url = f"/api/v1/runs/{run_id}"

        authenticate(client, "crew")
        crew_response = client.get(url + "/crew")
        assert crew_response.status_code == 200
        profile = crew_response.json()["health_profile"]
        assert profile["crew_id"] == "SIM-01"
        assert profile["simulated"] is True
        assert profile["display_name"] == "Mara Vale"
        assert profile["history"]["status"] == "recorded"
        assert all(entry["fictional"] is True for entry in profile["history"]["entries"])
        metrics = {"heart_rate", "blood_pressure", "glucose", "temperature",
                   "sleep", "sleep_quality", "mood", "symptoms"}
        for crew_id in ("SIM-01", "SIM-02", "SIM-03", "SIM-04"):
            member = client.get(url + "/crew", params={"crew_id": crew_id}).json()["health_profile"]
            assert {baseline["metric"] for baseline in member["baselines"]} == metrics
            assert all(baseline["source_id"].startswith("synthetic.") for baseline in member["baselines"])
        assert profile["baselines"][0]["value"] == 72

        authenticate(client, "ground")
        ground_response = client.get(url + "/ground")
        assert ground_response.status_code == 200
        ground = ground_response.json()
        ground_text = json.dumps(ground)
        assert "health_profile" not in ground
        assert "history" not in ground_text
        assert "baselines" not in ground_text
        assert "synthetic.sim-01-health-baseline-v1" not in ground_text
        assert profile["history"]["entries"][0]["note"] not in ground_text


def test_selected_crew_health_is_isolated_by_run_and_person(tmp_path):
    database = tmp_path / "selected-crew.sqlite3"
    with local_client(database) as client:
        authenticate(client)
        first = client.post("/api/v1/runs", json=START).json()["run_id"]
        second = client.post("/api/v1/runs", json={**START, "start_id": "second"}).json()["run_id"]
        authenticate(client, "crew")
        response = client.post(f"/api/v1/runs/{first}/crew/measurements", json={
            "measurement_id": "sana-reading", "crew_id": "SIM-02", "synthetic": True,
            "measurement": {"metric": "heart_rate", "value": 73, "unit": "bpm",
                            "observed_at_s": 0, "source_id": "synthetic.test.sana", "quality": "valid"},
            "context": {"activity": "rest"},
        })
        assert response.status_code == 201
    with local_client(database) as client:
        authenticate(client, "crew")
        def view(run, crew):
            response = client.get(f"/api/v1/runs/{run}/crew", params={"crew_id": crew})
            assert response.status_code == 200
            return response.json()
        sana = view(first, "SIM-02")
        ivo = view(first, "SIM-03")
        assert sana["health_profile"]["baselines"][0]["value"] == 68
        assert sana["health_assessment"]["crew_id"] == "SIM-02"
        assert sana["health_assessment"]["evidence"]["value"] == 73
        assert ivo["health_profile"]["baselines"][0]["value"] == 76
        assert ivo["health_assessment"] is None
        assert view(first, "SIM-04")["health_profile"]["baselines"][0]["value"] == 71
        assert view(second, "SIM-02")["health_assessment"] is None
        assert client.get(f"/api/v1/runs/{first}/crew?crew_id=unknown").status_code == 404
        authenticate(client, "ground")
        assert client.get(f"/api/v1/runs/{first}/crew?crew_id=SIM-02").status_code == 403
        assert "synthetic.test.sana" not in client.get(f"/api/v1/runs/{first}/ground").text


def test_assessment_appears_only_in_crew(tmp_path):
    """The same SIM-01 reading is compared independently against two references."""
    with local_client(tmp_path / "assessment.sqlite3") as client:
        tokens = client.post("/api/v1/demo/session").json()
        auth = lambda role: {"Authorization": "Bearer " + tokens[role]}  # noqa: E731
        run_id = client.post("/api/v1/runs", json=START, headers=auth("facilitator")).json()["run_id"]
        root = f"/api/v1/runs/{run_id}"
        assert client.get(root + "/crew", headers=auth("crew")).json()["health_assessment"] is None
        reading = {
            "measurement_id": "assessment-hr-sim-01",
            "crew_id": "SIM-01", "synthetic": True,
            "measurement": {
                "metric": "heart_rate", "value": 95, "unit": "bpm",
                "observed_at_s": 0, "source_id": "synthetic.watch.sim-01",
                "quality": "valid",
            },
            "context": {"activity": "rest"},
        }
        created = client.post(root + "/crew/measurements", json=reading, headers=auth("crew"))
        assert created.status_code == 201, created.text
        crew = client.get(root + "/crew", headers=auth("crew")).json()
        assessment = crew["health_assessment"]
        assert assessment["metric"] == "heart_rate"
        assert assessment["crew_id"] == "SIM-01"
        assert assessment["personal"]["status"] == "outside_personal_range"
        assert assessment["reference"]["status"] == "within_reference"
        assert assessment["personal"]["rule_id"] != assessment["reference"]["rule_id"]
        assert assessment["reference"]["earth_based"] is True
        assert assessment["synthetic"] is True
        assert crew["decision_rev"] == 0
        ground = client.get(root + "/ground", headers=auth("ground"))
        assert ground.status_code == 200
        assert "health_assessment" not in ground.text
        assert "synthetic.watch.sim-01" not in ground.text
        assert "outside_personal_range" not in ground.text

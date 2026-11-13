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
        assert profile["history"] == {"status": "unknown", "entries": []}
        assert profile["baselines"] == [
            {
                "metric": "heart_rate",
                "value": 72,
                "unit": "bpm",
                "context": "Synthetic resting value during quiet seated activity",
                "source_id": "synthetic.sim-01-health-baseline-v1",
            }
        ]

        authenticate(client, "ground")
        ground_response = client.get(url + "/ground")
        assert ground_response.status_code == 200
        ground = ground_response.json()
        ground_text = json.dumps(ground)
        assert "health_profile" not in ground
        assert "history" not in ground_text
        assert "baselines" not in ground_text
        assert "synthetic.sim-01-health-baseline-v1" not in ground_text


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

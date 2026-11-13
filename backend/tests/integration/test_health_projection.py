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

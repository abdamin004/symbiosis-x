"""SX-04D named acceptance: Crew-only private check-in round trip."""

from test_runs import START, local_client


def test_checkin_round_trip_is_crew_only(tmp_path):
    with local_client(tmp_path / "crew-checkin.sqlite3") as client:
        tokens = client.post("/api/v1/demo/session").json()
        role = lambda who: {"Authorization": "Bearer " + tokens[who]}  # noqa: E731
        started = client.post("/api/v1/runs", json=START, headers=role("facilitator"))
        assert started.status_code == 200
        run_id = started.json()["run_id"]
        url = f"/api/v1/runs/{run_id}/crew/check-ins"
        payload = {
            "check_in_id": "sx04d-roundtrip-01",
            "crew_id": "SIM-01",
            "note": "Synthetic onboard-only assessment for the acceptance test.",
            "synthetic": True,
        }

        result = client.post(url, json=payload, headers=role("crew"))
        assert result.status_code == 201, result.text
        receipt = result.json()
        assert receipt["check_in_id"] == payload["check_in_id"]
        assert receipt["run_id"] == run_id
        assert receipt["note"] == payload["note"]
        assert result.headers["Cache-Control"] == "no-store"

        read = client.get(url + "/" + payload["check_in_id"], headers=role("crew"))
        assert read.status_code == 200
        assert read.json() == receipt
        assert read.headers["Cache-Control"] == "no-store"
        assert client.post(url, json=payload, headers=role("crew")).json() == receipt

        assert client.post(url, json=payload, headers=role("ground")).status_code == 403
        assert client.get(url + "/" + payload["check_in_id"], headers=role("ground")).status_code == 403
        assert client.post(url, json=payload, headers=role("facilitator")).status_code == 403
        ground = client.get(f"/api/v1/runs/{run_id}/ground", headers=role("ground"))
        assert ground.status_code == 200
        assert payload["note"] not in ground.text
        assert client.get(url + "/" + payload["check_in_id"]).status_code == 401

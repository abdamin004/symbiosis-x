"""Verify Crew and Ground read the same run without changing its clock."""

import pytest

from test_runs import START, authenticate, local_client


def test_crew_read_keeps_clock(tmp_path):
    with local_client(tmp_path / "runs.sqlite3") as client:
        authenticate(client)
        run_id = client.post("/api/v1/runs", json=START).json()["run_id"]
        advance = f"/api/v1/runs/{run_id}/advance"
        step = {"advance_id": "advance-01", "expected_step": 0}
        assert client.post(advance, json=step).status_code == 200

        url = f"/api/v1/runs/{run_id}/crew"
        authenticate(client, "ground")
        assert client.get(url + "?role=crew").status_code == 403
        authenticate(client, "crew")
        response = client.get(url)
        assert response.status_code == 200
        assert response.headers["Cache-Control"] == "no-store"
        crew = response.json()
        assert crew["run_id"] == run_id
        assert crew["mission_s"] == crew["co2"]["observed_at_s"] == 60
        assert crew["co2"]["value"] == pytest.approx(2000)
        assert client.get(url).json() == crew
        assert client.get("/api/v1/runs/unknown/crew").status_code == 404
        assert client.post(advance, json=step).status_code == 403

        with client.app.state.repository.read() as db:
            assert db.execute("SELECT mission_s FROM runs").fetchone()[0] == 60
            assert db.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 4


def test_ground_has_no_onboard_fallback(tmp_path):
    database = tmp_path / "runs.sqlite3"
    with local_client(database) as client:
        authenticate(client)
        run_id = client.post("/api/v1/runs", json=START).json()["run_id"]
        url = f"/api/v1/runs/{run_id}"
        authenticate(client, "crew")
        assert client.get(url + "/crew").json()["co2"]["observed_at_s"] == 0
        assert client.get(url + "/ground").status_code == 403
        authenticate(client, "ground")
        assert client.get(url + "/ground").json()["packet"] is None

        authenticate(client)
        assert client.post(url + "/advance", json={"advance_id": "a1", "expected_step": 0}).status_code == 200
        authenticate(client, "crew")
        assert client.get(url + "/crew").json()["co2"]["observed_at_s"] == 60
        authenticate(client, "ground")
        delivered = client.get(url + "/ground").json()
        assert delivered["mission_s"] == 60
        assert delivered["packet"]["co2"]["observed_at_s"] == 0
        assert delivered["packet"]["delivery"] == {
            "observed_at_s": 0, "received_at_s": 60, "age_s": 60, "link_status": "delayed",
        }
        assert "crew" not in delivered
        assert client.get(url + "/ground").json() == delivered

        with client.app.state.repository.write() as db:
            db.execute("UPDATE messages SET delivered_at_s = NULL WHERE run_id = ?", (run_id,))
        assert client.get(url + "/ground").json()["packet"] is None
        assert client.get("/api/v1/runs/unknown/ground").status_code == 404

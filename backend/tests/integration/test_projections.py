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


GOLDEN_START = {"start_id": "trace-start", "scenario_id": "sx01-golden", "scenario_version": "1", "seed": 4242}


def test_trace_filters_by_role_and_delivery(tmp_path):
    with local_client(tmp_path / "trace.sqlite3") as client:
        tokens = client.post("/api/v1/demo/session").json()
        as_role = lambda who: {"Authorization": "Bearer " + tokens[who]}  # noqa: E731
        run_id = client.post("/api/v1/runs", json=GOLDEN_START, headers=as_role("facilitator")).json()["run_id"]
        url = f"/api/v1/runs/{run_id}"
        # A private onboard case: Crew-only, it must never enter either role's operational trace.
        case = client.post(f"{url}/crew/emergencies", headers=as_role("crew"), json={
            "operation_id": "op-private", "drill_id": "drill-chest-pain-v1",
            "reported_by": "SIM-01", "synthetic": True}).json()

        def advance(advance_id, expected_step, target):
            response = client.post(f"{url}/advance", headers=as_role("facilitator"), json={
                "advance_id": advance_id, "expected_step": expected_step, "target_mission_s": target})
            assert response.status_code == 200, response.text

        def steps(view):
            return [(r["mission_s"], r["actor"], r["step"], r["result"], r["reason_code"], r["next_owner"])
                    for r in view["trace"]]

        advance("to-13", 0, 780)
        crew = client.get(f"{url}/crew", headers=as_role("crew")).json()
        ground_response = client.get(f"{url}/ground", headers=as_role("ground"))
        ground = ground_response.json()

        # Crew sees every operational milestone so far, including the 13:00 hold.
        assert steps(crew) == [
            (60, "monitor", "incident_opened", "INSUFFICIENT_EVIDENCE", None, "crew"),
            (480, "ground", "advice_queued", "queued", None, "crew"),
            (600, "monitor", "incident_opened", "INSUFFICIENT_EVIDENCE", None, "crew"),
            (780, "relay", "advice_received", "held", "STALE_BASIS", "crew"),
        ]
        scrubber_case = crew["trace"][0]["case_id"]
        assert scrubber_case.startswith("inc-") and crew["trace"][1]["case_id"] == "advice-op-demo-013"

        # Ground has only v102 (observed 01:00): the scrubber case and its own advice.
        # The 10:00 power case and the 13:00 disposition have not been delivered.
        assert ground["packet"]["snapshot_id"] == "ground-v102"
        assert steps(ground) == steps(crew)[:2]
        assert ground["trace"][0]["case_id"] == scrubber_case

        advance("to-15", 5, 900)
        ground_900 = client.get(f"{url}/ground", headers=as_role("ground"))
        assert ground_900.json()["packet"]["snapshot_id"] == "ground-v103"
        assert [r["step"] for r in ground_900.json()["trace"]] == [
            "incident_opened", "advice_queued", "incident_opened"]

        crew_text = client.get(f"{url}/crew", headers=as_role("crew")).json()["trace"].__repr__()
        for text in (ground_response.text, ground_900.text, crew_text):
            # No private case, no raw tool input or evidence, no undelivered disposition for Ground.
            for marker in (case["case_id"], case["drill_id"], "SIM-01", "evt-scrubber-degraded",
                           "evt-power-drops", "removal_m3_h", "component_id", "basis_snapshot_id"):
                assert marker not in text, marker
        for text in (ground_response.text, ground_900.text):
            assert "advice_received" not in text and "STALE_BASIS" not in text

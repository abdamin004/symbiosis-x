"""SX-22E: real golden route composes intervening faults, packets and held advice."""

import sqlite3
from contextlib import closing
from hashlib import sha256
from pathlib import Path

import pytest

from test_runs import authenticate, local_client

ROOT = Path(__file__).resolve().parents[3]
GOLDEN = ROOT / "scenarios" / "sx01-golden-v1.json"
GOLDEN_START = {
    "start_id": "golden-start", "scenario_id": "sx01-golden",
    "scenario_version": "1", "seed": 4242,
}


def _read(client, run_id, role):
    authenticate(client, role)
    return client.get(f"/api/v1/runs/{run_id}/{role}").json()


def _step(client, run_id, *, advance_id, expected_step, target_mission_s):
    authenticate(client)
    return client.post(
        f"/api/v1/runs/{run_id}/advance",
        json={"advance_id": advance_id, "expected_step": expected_step,
              "target_mission_s": target_mission_s},
    )


def test_compose_applies_due_events_in_order(tmp_path):
    database = tmp_path / "golden.sqlite3"
    original_manifest = sha256(GOLDEN.read_bytes()).hexdigest()
    with local_client(database) as client:
        authenticate(client)
        start = client.post("/api/v1/runs", json=GOLDEN_START)
        assert start.status_code == 200, start.text
        run_id = start.json()["run_id"]
        assert start.json()["mission_s"] == 0

        jump = _step(client, run_id, advance_id="jump-13", expected_step=0, target_mission_s=780)
        assert jump.status_code == 200, jump.text
        receipt = jump.json()
        assert (receipt["mission_s"], receipt["step"]) == (780, 5)

        crew = _read(client, run_id, "crew")
        ground = _read(client, run_id, "ground")
        assert crew["decision_rev"] == 103
        assert crew["co2"]["observed_at_s"] == 780
        assert crew["co2"]["value"] == pytest.approx(2063.7446813, abs=0.02)
        assert ground["packet"]["snapshot_id"] == "ground-v102"
        assert ground["packet"]["decision_rev"] == 102
        assert ground["packet"]["power_headroom"]["value"] == pytest.approx(0.60)
        assert ground["packet"]["delivery"]["received_at_s"] == 360
        assert sha256(GOLDEN.read_bytes()).hexdigest() == original_manifest

        with client.app.state.repository.read() as db:
            events = db.execute(
                "SELECT event_type, mission_s FROM events WHERE run_id = ? ORDER BY event_seq",
                (run_id,),
            ).fetchall()
            journal = [tuple(item) for item in events]
            assert journal.index(("fault.scrubber_degraded", 60)) < journal.index(("fault.power_drop", 600))
            assert journal.index(("fault.power_drop", 600)) < journal.index(("crew.advisory_received", 780))
            received = db.execute(
                """SELECT payload_json FROM events WHERE run_id = ?
                   AND event_type = 'crew.advisory_received'""",
                (run_id,),
            ).fetchone()[0]
            assert '"reason_code":"STALE_BASIS"' in received
            assert '"applied":false' in received
            assert db.execute(
                """SELECT count(*) FROM events WHERE run_id = ?
                   AND event_type = 'crew.action_committed'""",
                (run_id,),
            ).fetchone()[0] == 0
            before = db.execute(
                "SELECT count(*) FROM events WHERE run_id = ?", (run_id,)
            ).fetchone()[0]

        retry = _step(client, run_id, advance_id="jump-13", expected_step=0, target_mission_s=780)
        assert retry.status_code == 200 and retry.json() == receipt
        with client.app.state.repository.read() as db:
            assert db.execute(
                "SELECT count(*) FROM events WHERE run_id = ?", (run_id,)
            ).fetchone()[0] == before

        final = _step(client, run_id, advance_id="jump-15", expected_step=5, target_mission_s=900)
        assert final.status_code == 200, final.text
        end_ground = _read(client, run_id, "ground")
        assert end_ground["packet"]["snapshot_id"] == "ground-v103"
        assert end_ground["packet"]["decision_rev"] == 103
        assert end_ground["packet"]["power_headroom"]["value"] == pytest.approx(0.20)

    with local_client(database) as restarted:
        assert _read(restarted, run_id, "ground") == end_ground
        assert sha256(GOLDEN.read_bytes()).hexdigest() == original_manifest


def test_golden_start_and_nominal_runs_are_independent(tmp_path):
    with local_client(tmp_path / "two.sqlite3") as client:
        authenticate(client)
        nominal = client.post("/api/v1/runs", json={
            "start_id": "nominal-other", "scenario_id": "nominal",
            "scenario_version": "1", "seed": 4242,
        })
        assert nominal.status_code == 200
        golden = client.post("/api/v1/runs", json=GOLDEN_START)
        assert golden.status_code == 200
        assert nominal.json()["run_id"] != golden.json()["run_id"]
        assert client.post(
            f"/api/v1/runs/{nominal.json()['run_id']}/advance",
            json={"advance_id": "nominal-step", "expected_step": 0},
        ).json()["mission_s"] == 60
        assert _step(
            client, golden.json()["run_id"], advance_id="golden-step",
            expected_step=0, target_mission_s=780,
        ).json()["mission_s"] == 780

"""SX-18D: replay the saved golden scenario through the real API and compare both projections.

The run is driven one beat at a time by the facilitator. At every beat in
scenarios/expected/sx01-golden-v1.json the actual Crew and Ground responses
are compared with the pinned values, Ground deliveries are checked when they
land, and at 13:00 Crew tries to approve the stale advice through the commit
gate. The scenario files themselves must not change.
"""

import json
from hashlib import sha256
from pathlib import Path

import pytest

from test_runs import local_client

ROOT = Path(__file__).resolve().parents[3]
MANIFEST = ROOT / "scenarios" / "sx01-golden-v1.json"
EXPECTED = ROOT / "scenarios" / "expected" / "sx01-golden-v1.json"
START = {"start_id": "golden-replay", "scenario_id": "sx01-golden", "scenario_version": "1", "seed": 4242}
STEPS_S = (0, 60, 360, 480, 600, 780, 900)


def _quantity(actual, expected, tolerance):
    assert actual["unit"] == expected["unit"]
    assert actual["observed_at_s"] == expected["observed_at_s"]
    assert actual["value"] == pytest.approx(expected["value"], abs=tolerance)
    if "kind" in expected:
        assert actual["kind"] == expected["kind"]


def _ground_matches(ground, expected, tolerance):
    packet = ground["packet"]
    assert packet["decision_rev"] == expected["decision_rev"]
    _quantity(packet["co2"], expected["co2"], tolerance)
    _quantity(packet["power_headroom"], expected["power_headroom"], tolerance)
    if "delivery" in expected:
        assert {key: packet["delivery"][key] for key in expected["delivery"]} == expected["delivery"]


def test_golden_replay_through_api(tmp_path):
    pinned = [sha256(path.read_bytes()).hexdigest() for path in (MANIFEST, EXPECTED)]
    expected = json.loads(EXPECTED.read_text(encoding="utf-8"))
    tolerance = expected["co2_tolerance_ppm"]
    beats = {beat["mission_s"]: beat for beat in expected["beats"]}
    deliveries = {delivery["received_at_s"]: delivery for delivery in expected["deliveries"]}

    with local_client(tmp_path / "golden-replay.sqlite3") as client:
        tokens = client.post("/api/v1/demo/session").json()
        as_role = lambda who: {"Authorization": "Bearer " + tokens[who]}  # noqa: E731
        started = client.post("/api/v1/runs", json=START, headers=as_role("facilitator"))
        assert started.status_code == 200, started.text
        run_id = started.json()["run_id"]
        url = f"/api/v1/runs/{run_id}"
        seen_beats, seen_deliveries = [], []

        for step, mission_s in enumerate(STEPS_S):
            if step:
                advanced = client.post(f"{url}/advance", headers=as_role("facilitator"),
                                       json={"advance_id": f"beat-{mission_s}", "expected_step": step - 1})
                assert advanced.status_code == 200, advanced.text
                assert (advanced.json()["mission_s"], advanced.json()["step"]) == (mission_s, step)
            crew = client.get(f"{url}/crew", headers=as_role("crew")).json()
            ground = client.get(f"{url}/ground", headers=as_role("ground")).json()
            assert crew["mission_s"] == ground["mission_s"] == mission_s

            if mission_s in beats:
                beat = beats[mission_s]
                assert crew["decision_rev"] == beat["crew"]["decision_rev"], beat["beat_id"]
                assert crew["co2"]["observed_at_s"] == beat["crew"]["co2"]["observed_at_s"]
                assert crew["co2"]["value"] == pytest.approx(beat["crew"]["co2"]["value"], abs=tolerance)
                _ground_matches(ground, beat["ground"], tolerance)
                seen_beats.append(beat["beat_id"])
            if mission_s in deliveries:
                _ground_matches(ground, deliveries[mission_s]["ground"], tolerance)
                assert ground["packet"]["delivery"]["received_at_s"] == mission_s
                seen_deliveries.append(deliveries[mission_s]["delivery_id"])

            if mission_s == 780:
                stale = beats[780]
                # 13:00: Ground still reads v102 at 0.60 kW; Crew reads v103 at 0.20 kW.
                assert (ground["packet"]["snapshot_id"], ground["packet"]["decision_rev"]) == ("ground-v102", 102)
                assert ground["packet"]["power_headroom"]["value"] == pytest.approx(0.60)
                plan = client.post(f"{url}/plans/evaluate", headers=as_role("crew")).json()
                assert plan["decision_rev"] == 103
                standby = next(c for c in plan["candidates"] if c["candidate_id"] == "start_standby")
                assert (standby["result"], standby["reason_code"]) == ("rejected", "POWER_LIMIT")
                assert (standby["required_kw"], standby["available_kw"]) == (pytest.approx(0.40), pytest.approx(0.20))
                # The v102 advice arrived and was held onboard, not applied.
                assert [(r["step"], r["result"], r["reason_code"]) for r in crew["trace"]][-1] == (
                    "advice_received", "held", "STALE_BASIS")
                # Crew approving that advice on its v102 basis is rejected by the commit gate.
                approval = client.post(f"{url}/actions", headers=as_role("crew"), json={
                    "operation_id": stale["action_receipt"]["operation_id"],
                    "candidate_id": "start_standby", "basis_decision_rev": 102})
                assert approval.status_code == 200, approval.text
                receipt = approval.json()
                assert {key: receipt[key] for key in stale["action_receipt"]} == stale["action_receipt"]

        assert seen_beats == [beat["beat_id"] for beat in expected["beats"]]
        assert seen_deliveries == [delivery["delivery_id"] for delivery in expected["deliveries"]]
        assert client.post(f"{url}/advance", headers=as_role("facilitator"), json={
            "advance_id": "past-end", "expected_step": len(STEPS_S) - 1}).json() == {"detail": "NO_NEXT_STEP"}

        with client.app.state.repository.read() as db:
            applied = db.execute(
                """SELECT count(*) FROM events WHERE run_id = ?
                   AND (event_type = 'crew.action_committed' OR event_type LIKE 'command.%')""",
                (run_id,)).fetchone()[0]
            final_rev = db.execute("SELECT decision_rev FROM runs WHERE run_id = ?", (run_id,)).fetchone()[0]
        assert applied == len(beats[780]["applied_effects"]) == 0
        assert final_rev == 103

    assert [sha256(path.read_bytes()).hexdigest() for path in (MANIFEST, EXPECTED)] == pinned

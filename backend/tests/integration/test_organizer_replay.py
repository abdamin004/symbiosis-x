"""SX-12C: an opt-in synthetic incoming-data case must replay deterministically.

This is a synthetic stand-in for the organizer's future approved data feed.
The canonical golden fixture is immutable and its acceptance values must hold.
"""
import json
from hashlib import sha256
from pathlib import Path

import pytest

from test_runs import local_client

ROOT = Path(__file__).resolve().parents[3]
CANONICAL = ROOT / "scenarios" / "sx01-golden-v1.json"
CANONICAL_EXPECTED = ROOT / "scenarios" / "expected" / "sx01-golden-v1.json"
VARIANT = ROOT / "scenarios" / "variants" / "organizer-replay.json"
VARIANT_EXPECTED = ROOT / "scenarios" / "expected" / "organizer-replay.json"


def _replay(client, scenario_id, run_index):
    tokens = client.post("/api/v1/demo/session").json()
    facilitator = {"Authorization": "Bearer " + tokens["facilitator"]}
    crew_headers = {"Authorization": "Bearer " + tokens["crew"]}
    ground_headers = {"Authorization": "Bearer " + tokens["ground"]}

    started = client.post("/api/v1/runs", json={
        "start_id": f"replay-{scenario_id}-{run_index}",
        "scenario_id": scenario_id, "scenario_version": "1", "seed": 4242,
    }, headers=facilitator)
    assert started.status_code == 200, started.text
    run_id = started.json()["run_id"]
    api = f"/api/v1/runs/{run_id}"

    first = client.post(api + "/advance", json={
        "advance_id": "advance-to-780", "expected_step": 0, "target_mission_s": 780,
    }, headers=facilitator)
    assert first.status_code == 200, first.text
    assert first.json()["mission_s"] == 780
    crew780 = client.get(api + "/crew", headers=crew_headers)
    ground780 = client.get(api + "/ground", headers=ground_headers)
    assert crew780.status_code == ground780.status_code == 200

    with client.app.state.repository.read() as db:
        applied780 = db.execute(
            "SELECT COUNT(*) FROM events WHERE run_id = ? AND event_type = 'crew.action_committed'",
            (run_id,),
        ).fetchone()[0]
        sources = [
            row[0] for row in db.execute(
                "SELECT DISTINCT source_id FROM telemetry_observations WHERE run_id = ?",
                (run_id,),
            )
        ]

    with client.app.state.repository.read() as db:
        power_change = db.execute(
            "SELECT payload_json FROM events WHERE run_id = ? AND event_type = 'fault.power_drop'",
            (run_id,),
        ).fetchone()
        crew_power = json.loads(power_change[0])["power_headroom_kw"]

    second = client.post(api + "/advance", json={
        "advance_id": "advance-to-900", "expected_step": 5, "target_mission_s": 900,
    }, headers=facilitator)
    assert second.status_code == 200, second.text
    ground900 = client.get(api + "/ground", headers=ground_headers)
    assert ground900.status_code == 200
    return {
        "crew_revision": crew780.json()["decision_rev"],
        "ground_revision": ground780.json()["packet"]["decision_rev"],
        "crew_co2": crew780.json()["co2"]["value"],
        "crew_power": crew_power,
        "ground_co2": ground780.json()["packet"]["co2"]["value"],
        "ground_power": ground780.json()["packet"]["power_headroom"]["value"],
        "ground_snapshot": ground780.json()["packet"]["snapshot_id"],
        "ground900_revision": ground900.json()["packet"]["decision_rev"],
        "ground900_co2": ground900.json()["packet"]["co2"]["value"],
        "ground900_power": ground900.json()["packet"]["power_headroom"]["value"],
        "ground900_snapshot": ground900.json()["packet"]["snapshot_id"],
        "applied_effects": applied780,
        "sources": sorted(sources),
    }


def test_variant_replays_without_golden_changes(tmp_path):
    frozen_files = (CANONICAL, CANONICAL_EXPECTED)
    checksums = [sha256(f.read_bytes()).hexdigest() for f in frozen_files]
    variant_manifest = json.loads(VARIANT.read_text(encoding="utf-8"))
    expected = json.loads(VARIANT_EXPECTED.read_text(encoding="utf-8"))
    canonical_expected = json.loads(CANONICAL_EXPECTED.read_text(encoding="utf-8"))
    assert variant_manifest["synthetic"] is True
    assert variant_manifest["approved_organizer_data"] is False

    with local_client(tmp_path / "replay.sqlite3") as client:
        v1 = _replay(client, "organizer-replay", 1)
        v2 = _replay(client, "organizer-replay", 2)
        g1 = _replay(client, "sx01-golden", 1)
        g2 = _replay(client, "sx01-golden", 2)

    assert v1 == v2, "synthetic organizer replay must be deterministic"
    assert g1 == g2, "canonical golden replay must stay deterministic"
    check780 = expected["checkpoint_780"]
    check900 = expected["checkpoint_900"]
    assert v1["crew_revision"] == check780["crew_decision_rev"]
    assert v1["ground_revision"] == check780["ground_decision_rev"]
    assert v1["crew_co2"] == pytest.approx(check780["crew_co2_ppm"], abs=0.01)
    assert v1["ground_co2"] == pytest.approx(check780["ground_co2_ppm"], abs=0.01)
    assert v1["crew_power"] == pytest.approx(check780["crew_power_headroom_kw"])
    assert v1["ground_power"] == pytest.approx(check780["ground_power_headroom_kw"])
    assert v1["ground_snapshot"] == check780["ground_snapshot_id"]
    assert v1["applied_effects"] == check780["applied_effect_count"] == 0
    assert "synthetic.organizer.co2" in v1["sources"]
    assert v1["ground900_revision"] == check900["ground_decision_rev"]
    assert v1["ground900_snapshot"] == check900["ground_snapshot_id"]
    assert v1["ground900_co2"] == pytest.approx(check900["ground_co2_ppm"], abs=0.01)
    assert v1["ground900_power"] == pytest.approx(check900["ground_power_headroom_kw"])

    canonical780 = canonical_expected["beats"][-1]
    canonical900 = canonical_expected["deliveries"][-1]
    assert g1["crew_revision"] == canonical780["crew"]["decision_rev"] == 103
    assert g1["ground_revision"] == canonical780["ground"]["decision_rev"] == 102
    assert g1["crew_co2"] == pytest.approx(canonical780["crew"]["co2"]["value"], abs=0.01)
    assert g1["ground_co2"] == pytest.approx(canonical780["ground"]["co2"]["value"], abs=0.01)
    assert g1["crew_power"] == pytest.approx(canonical780["crew"]["power_headroom"]["value"])
    assert g1["ground_power"] == pytest.approx(canonical780["ground"]["power_headroom"]["value"])
    assert g1["applied_effects"] == 0
    assert g1["ground900_revision"] == canonical900["ground"]["decision_rev"]
    assert g1["ground900_co2"] == pytest.approx(canonical900["ground"]["co2"]["value"], abs=0.01)
    assert g1["ground900_power"] == pytest.approx(canonical900["ground"]["power_headroom"]["value"])
    assert [sha256(f.read_bytes()).hexdigest() for f in frozen_files] == checksums


def test_variant_rejects_non_synthetic_and_bad_sample_times(tmp_path):
    from symbiosis_x.simulation.scenario import load_organizer_manifest

    source = json.loads(VARIANT.read_text(encoding="utf-8"))
    source["approved_organizer_data"] = True
    bad = tmp_path / "unapproved.json"
    bad.write_text(json.dumps(source), encoding="utf-8")
    with pytest.raises(ValueError, match="SYNTHETIC_TEST_DATA_ONLY"):
        load_organizer_manifest(bad)
    source["approved_organizer_data"] = False
    source["incoming_observations"][0]["received_at_s"] = 1
    bad.write_text(json.dumps(source), encoding="utf-8")
    with pytest.raises(ValueError, match="BAD_SAMPLE_TIME"):
        load_organizer_manifest(bad)

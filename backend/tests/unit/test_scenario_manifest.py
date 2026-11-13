"""SX-18A: the golden scenario manifest validates without a running app."""

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "backend" / "src"))
from symbiosis_x.simulation.spacecraft.atmosphere import advance_co2_ppm

MANIFEST = ROOT / "scenarios" / "sx01-golden-v1.json"
EXPECTED = ROOT / "scenarios" / "expected" / "sx01-golden-v1.json"
EXAMPLES = ROOT / "contracts" / "examples"

REFERENCE_TIMESTAMPS_S = {
    "ground_initial_observed": -60,
    "scrubber_degraded": 60,
    "ground_receives_v102": 360,
    "ground_advice_issued": 480,
    "power_drops": 600,
    "stale_advice_arrives": 780,
    "ground_receives_v103": 900,
}
DISPLAY_BEATS_S = [0, 60, 480, 600, 780]
DELIVERY_BEATS_S = [360, 900]


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def is_int(value):
    return isinstance(value, int) and not isinstance(value, bool)


def time_fields(node, path="$"):
    """Yield every mission-second field (``*_s``) anywhere in the document."""
    if isinstance(node, dict):
        for key, value in node.items():
            here = f"{path}.{key}"
            if key.endswith("_s") and not isinstance(value, (dict, list)):
                yield here, value
            yield from time_fields(value, here)
    elif isinstance(node, list):
        for index, value in enumerate(node):
            yield from time_fields(value, f"{path}[{index}]")


def modeled_co2(manifest, mission_s):
    cabin = manifest["cabin"]
    degraded_at = manifest["reference_timestamps_s"]["scrubber_degraded"]
    co2 = float(cabin["initial_co2_ppm"])
    segments = [(0, min(mission_s, degraded_at), cabin["nominal_removal_m3_h"]),
                (degraded_at, mission_s, cabin["degraded_removal_m3_h"])]
    for start, end, removal in segments:
        if end > start:
            co2 = advance_co2_ppm(co2, duration_s=end - start, volume_m3=cabin["volume_m3"],
                                  generation_m3_h=cabin["generation_m3_h"], removal_m3_h=removal)
    return co2


def test_golden_manifest_validates():
    manifest = load(MANIFEST)
    expected = load(EXPECTED)

    # Identity, seed and model version are pinned in both files.
    for doc in (manifest, expected):
        assert doc["scenario_id"] == "sx01-golden"
        assert doc["scenario_version"] == "1"
        assert doc["seed"] == 4242 and is_int(doc["seed"])
        assert doc["model_version"] == "cabin-1"
        assert doc["synthetic"] is True
    assert manifest["policy_version"] == "demo-1"
    assert manifest["noise"] == "off"
    assert manifest["cabin"]["volume_m3"] == 100

    # Inputs and expected role values stay in separate files.
    assert not {"beats", "deliveries", "crew", "ground"} & manifest.keys()
    assert not {"cabin", "scripted_events", "reference_timestamps_s"} & expected.keys()

    # Every mission time is an integer number of seconds.
    for doc in (manifest, expected):
        for where, value in time_fields(doc):
            assert is_int(value), f"{where} is not integer seconds: {value!r}"

    # The seven reference timestamps.
    assert manifest["reference_timestamps_s"] == REFERENCE_TIMESTAMPS_S
    assert manifest["start_s"] == 0
    assert manifest["end_s"] >= max(REFERENCE_TIMESTAMPS_S.values())

    # Five display beats and the intermediate Relay deliveries.
    beats = manifest["display_beats"]
    assert [b["mission_s"] for b in beats] == DISPLAY_BEATS_S
    assert len({b["beat_id"] for b in beats}) == len(beats)
    deliveries = manifest["delivery_events"]
    assert [d["received_at_s"] for d in deliveries] == DELIVERY_BEATS_S
    for delivery in deliveries:
        assert delivery["observed_at_s"] < delivery["received_at_s"]
    initial = manifest["ground_initial_snapshot"]
    assert (initial["decision_rev"], initial["observed_at_s"]) == (100, -60)

    revisions = {r["decision_rev"]: r["effective_at_s"] for r in manifest["decision_revisions"]}
    assert list(revisions.values()) == sorted(revisions.values())
    for delivery in deliveries:
        assert revisions[delivery["decision_rev"]] <= delivery["observed_at_s"]

    # Expected values cover every display beat and every delivery.
    assert [b["beat_id"] for b in expected["beats"]] == [b["beat_id"] for b in beats]
    assert [b["mission_s"] for b in expected["beats"]] == DISPLAY_BEATS_S
    assert [d["delivery_id"] for d in expected["deliveries"]] == [d["delivery_id"] for d in deliveries]
    assert [d["received_at_s"] for d in expected["deliveries"]] == DELIVERY_BEATS_S

    tolerance = expected["co2_tolerance_ppm"]
    for beat in expected["beats"]:
        now, crew, ground = beat["mission_s"], beat["crew"], beat["ground"]
        # Crew sees the modeled cabin onboard at mission time.
        assert crew["co2"]["observed_at_s"] == now
        assert crew["co2"]["value"] == pytest.approx(modeled_co2(manifest, now), abs=tolerance)
        active = max(rev for rev, at in revisions.items() if at <= now)
        assert crew["decision_rev"] == active
        # Ground sees only what had been delivered by mission time.
        delivery = ground["delivery"]
        assert delivery["received_at_s"] <= now
        assert delivery["age_s"] == now - delivery["observed_at_s"]
        assert ground["co2"]["observed_at_s"] == delivery["observed_at_s"]
        assert ground["decision_rev"] <= crew["decision_rev"]
        for role in (crew, ground):
            assert role["co2"]["unit"] == "ppm"
            assert role["power_headroom"]["unit"] == "kW"
            assert role["scrubber_removal"]["unit"] == "m3/h"

    for delivery in expected["deliveries"]:
        ground = delivery["ground"]
        observed = ground["co2"]["observed_at_s"]
        assert ground["co2"]["value"] == pytest.approx(modeled_co2(manifest, observed), abs=tolerance)

    # The 13:00 beat agrees with the frozen SX-01A contract examples.
    stale = expected["beats"][-1]
    crew_example = load(EXAMPLES / "crew-v103.json")
    ground_example = load(EXAMPLES / "ground-v102.json")
    receipt_example = load(EXAMPLES / "action-receipts.json")
    assert crew_example["mission_s"] == ground_example["mission_s"] == stale["mission_s"]
    assert stale["crew"]["decision_rev"] == crew_example["decision_rev"] == 103
    assert stale["ground"]["decision_rev"] == ground_example["decision_rev"] == 102
    for field in ("co2", "scrubber_removal", "power_headroom"):
        assert stale["crew"][field] == crew_example["equipment"][field]
        assert stale["ground"][field] == ground_example["equipment"][field]
    assert stale["ground"]["delivery"] == {
        k: ground_example["delivery"][k] for k in ("observed_at_s", "received_at_s", "age_s")
    }
    assert stale["action_receipt"] == receipt_example
    assert stale["action_receipt"]["applied"] is False
    assert stale["applied_effects"] == []

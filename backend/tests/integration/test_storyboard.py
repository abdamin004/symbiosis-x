"""SX-18B: the saved backup frames match a fresh golden replay and the five reference beats."""

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from scripts.export_golden_storyboard import MANIFEST, STORYBOARD, build_storyboard  # noqa: E402

EXPECTED = ROOT / "scenarios" / "expected" / "sx01-golden-v1.json"
PRIVATE_KEYS = {"run_id", "health_profile", "health_assessment", "check_in", "note_text", "crew_id"}


def _keys(node):
    if isinstance(node, dict):
        for key, value in node.items():
            yield key
            yield from _keys(value)
    elif isinstance(node, list):
        for item in node:
            yield from _keys(item)


def _matches(actual, expected, tolerance):
    assert actual["unit"] == expected["unit"]
    assert actual["observed_at_s"] == expected["observed_at_s"]
    assert actual["value"] == pytest.approx(expected["value"], abs=tolerance)


def test_saved_frames_match_golden_run(tmp_path):
    saved = json.loads(STORYBOARD.read_text(encoding="utf-8"))
    fresh = build_storyboard(tmp_path)
    assert saved == fresh

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    expected = json.loads(EXPECTED.read_text(encoding="utf-8"))
    tolerance = expected["co2_tolerance_ppm"]
    assert (saved["seed"], saved["model_version"], saved["policy_version"]) == (
        manifest["seed"], manifest["model_version"], manifest["policy_version"])
    assert saved["synthetic"] is True

    frames = saved["frames"]
    assert [frame["beat_id"] for frame in frames] == [beat["beat_id"] for beat in manifest["display_beats"]]
    for frame, beat in zip(frames, expected["beats"], strict=True):
        assert frame["mission_s"] == beat["mission_s"]
        assert frame["crew"]["decision_rev"] == beat["crew"]["decision_rev"]
        _matches(frame["crew"]["co2"], beat["crew"]["co2"], tolerance)
        ground = frame["ground"]
        assert ground["decision_rev"] == beat["ground"]["decision_rev"]
        _matches(ground["co2"], beat["ground"]["co2"], tolerance)
        _matches(ground["power_headroom"], beat["ground"]["power_headroom"], tolerance)
        for key, value in beat["ground"].get("delivery", {}).items():
            assert ground["delivery"][key] == value

    # 13:00: Ground holds v102 at 0.60 kW while Crew is on v103, standby is power-limited,
    # and the stale advice is held onboard.
    last = frames[-1]
    assert (last["ground"]["snapshot_id"], last["ground"]["decision_rev"]) == ("ground-v102", 102)
    assert last["ground"]["power_headroom"]["value"] == pytest.approx(0.60)
    assert last["crew"]["decision_rev"] == 103
    assert last["crew"]["standby"] == {
        "result": "rejected", "reason_code": "POWER_LIMIT", "required_kw": 0.4, "available_kw": 0.2}
    assert (last["crew"]["trace"][-1]["step"], last["crew"]["trace"][-1]["reason_code"]) == (
        "advice_received", "STALE_BASIS")

    # Frames are role-scoped and shareable: no run ID or private health fields.
    assert not PRIVATE_KEYS & set(_keys(saved))

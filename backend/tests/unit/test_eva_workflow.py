from dataclasses import replace
import json
from pathlib import Path

import pytest

from symbiosis_x.simulation.spacecraft.mechanical import MAX_PRESSURE_DELTA_KPA
from symbiosis_x.workflows.eva import Readiness, readiness_problem, rehearsed_outcome, step_profile

SCENARIOS = Path(__file__).resolve().parents[3] / "scenarios"
CONFIG = json.loads((SCENARIOS / "variants/eva-antenna-service-v1.json").read_text())
EXPECTED = json.loads((SCENARIOS / "expected/eva-antenna-service-v1.json").read_text())


def test_eva_requires_readiness_and_never_opens_both_airlock_hatches():
    ready = Readiness(
        mission_capable=True, qualified=True, crew_available=True, airlock_available=True,
        comms_ready=True, tether_ready=True, oxygen_pct=100, battery_pct=100, return_margin_s=75,
    )
    assert readiness_problem(ready, CONFIG) == ""
    for field in ("mission_capable", "qualified", "crew_available", "airlock_available", "comms_ready", "tether_ready"):
        assert readiness_problem(replace(ready, **{field: False}), CONFIG)
    for field in ("oxygen_pct", "battery_pct", "return_margin_s"):
        assert readiness_problem(replace(ready, **{field: 1}), CONFIG)

    for recall_at in (None, *range(105)):
        frames = step_profile(15, recall_at)
        assert frames[0].inner and frames[-1].inner
        assert all(not (frame.inner and frame.outer) for frame in frames)
        assert all(frame.pressure_kpa <= MAX_PRESSURE_DELTA_KPA for frame in frames if frame.outer)
        for left, right in zip(frames, frames[1:]):
            assert not (left.inner and right.outer or left.outer and right.inner)

    expected = EXPECTED["nominal"]
    assert rehearsed_outcome(CONFIG, 15, verify_at_s=104)["antenna_after_db"] == expected["antenna_before_db"]
    result = rehearsed_outcome(CONFIG, 15, verify_at_s=105)
    assert {key: result[key] for key in expected} == expected


@pytest.mark.parametrize("fault", ["suit_link", "suit_reserve"])
def test_eva_recall_preserves_crew_return_and_does_not_finish_repair(fault):
    result = rehearsed_outcome(CONFIG, 15, fault=CONFIG["seeded_faults"][fault], verify_at_s=105)
    expected = EXPECTED["recall"]
    assert {key: result[key] for key in expected} == expected
    assert result["recall_reason"]
    assert result["repair_verified_at_s"] is None

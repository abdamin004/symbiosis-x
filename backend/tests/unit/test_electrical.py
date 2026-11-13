"""SX-03B: standby power is checked against bus headroom in kW."""

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "backend" / "src"))
from symbiosis_x.contracts.commands import StartStandby
from symbiosis_x.simulation.spacecraft.electrical import (
    STANDBY_DEMAND_KW,
    StandbyPowerCheck,
    check_standby_power,
)


def test_standby_blocked_at_point_two_kw():
    result = check_standby_power(headroom_kw=0.20, demand_kw=0.40)

    assert result == StandbyPowerCheck("blocked", 0.40, 0.20, "POWER_LIMIT")
    assert result.unit == "kW"
    assert STANDBY_DEMAND_KW == 0.40
    assert check_standby_power(0.20) == result


def test_blocked_result_feeds_the_planner_candidate():
    candidate = check_standby_power(0.20).as_rejected_candidate()

    StartStandby.model_validate(candidate)
    example = json.loads((ROOT / "contracts/examples/candidate-results.json").read_text())
    expected = next(c for c in example["candidates"] if c["candidate_id"] == "start_standby")
    assert candidate == expected


def test_standby_ready_with_enough_headroom():
    assert check_standby_power(0.60) == StandbyPowerCheck("ready", 0.40, 0.60)
    assert check_standby_power(0.1 + 0.3).outcome == "ready"
    with pytest.raises(ValueError, match="rejected candidate"):
        check_standby_power(0.60).as_rejected_candidate()


def test_missing_evidence_stays_unknown():
    assert check_standby_power(None) == StandbyPowerCheck("unknown", 0.40, None, "HEADROOM_UNKNOWN")
    assert check_standby_power(0.60, feeder_connected=None) == StandbyPowerCheck(
        "unknown", 0.40, 0.60, "FEEDER_UNKNOWN")
    # A known shortfall is still reported as a block when feeder evidence is missing.
    assert check_standby_power(0.20, feeder_connected=None).reason_code == "POWER_LIMIT"
    assert check_standby_power(0.60, feeder_connected=False) == StandbyPowerCheck(
        "blocked", 0.40, 0.60, "FEEDER_DISCONNECTED")
    with pytest.raises(ValueError, match="rejected candidate"):
        check_standby_power(None).as_rejected_candidate()


@pytest.mark.parametrize("headroom, demand, error", [
    (-0.1, 0.40, ValueError), (float("nan"), 0.40, ValueError),
    (0.20, float("inf"), ValueError), (0.20, -1, ValueError),
    ("0.20", 0.40, TypeError), (True, 0.40, TypeError), (0.20, None, TypeError),
])
def test_invalid_power_input(headroom, demand, error):
    with pytest.raises(error):
        check_standby_power(headroom, demand)

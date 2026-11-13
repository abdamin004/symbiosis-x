"""SX-02: phase, next waypoint and ETA come from the plan and mission time only."""

from dataclasses import replace
from pathlib import Path

import pytest

from symbiosis_x.simulation.spacecraft.navigation import (
    Checkpoint, FlightPlan, PhaseHold, load_flight_plan, navigation_state,
)

ROOT = Path(__file__).resolve().parents[3]
ISS_PILOT = ROOT / "scenarios" / "variants" / "iss-research-pilot-v1.json"
REPLAY_S = [0, 59, 60, 300, 780, 14399, 14400, 16200, 64800, 70000]


def sequence(plan, hold=None):
    return [navigation_state(plan, mission_s, hold=hold) for mission_s in REPLAY_S]


def test_seed_repeats_phase_and_eta():
    first, second = load_flight_plan(ISS_PILOT), load_flight_plan(ISS_PILOT)
    assert first == second
    assert sequence(first) == sequence(second)

    states = {s.mission_s: s for s in sequence(first)}
    assert (states[0].phase, states[0].next_waypoint.label, states[0].eta_s, states[0].eta_basis) == (
        "Departure", "Primary scrubber degraded", 60, "scheduled")
    assert (states[59].phase, states[59].eta_s) == ("Departure", 60)
    assert (states[60].phase, states[60].checkpoint.label) == ("Outbound", "Primary scrubber degraded")
    assert (states[780].next_waypoint.phase, states[780].eta_s) == ("Approach", 14400)
    assert states[14400].phase == "Approach"
    assert (states[64800].phase, states[64800].next_waypoint, states[64800].eta_s, states[64800].eta_basis) == (
        "Recovery", None, None, "complete")
    assert states[70000] == replace(states[64800], mission_s=70000)

    # Holding entry to Approach keeps the plan and makes the ETA conditional, even when overdue.
    hold = PhaseHold(phase="Approach", blocker="DOCKING_CHECKS_PENDING")
    held = {s.mission_s: s for s in sequence(first, hold)}
    assert (held[780].phase, held[780].eta_s, held[780].eta_basis, held[780].hold_blocker) == (
        "Outbound", 14400, "conditional", "DOCKING_CHECKS_PENDING")
    assert (held[16200].phase, held[16200].next_waypoint.phase, held[16200].eta_s, held[16200].eta_basis) == (
        "Outbound", "Approach", 14400, "conditional")
    assert load_flight_plan(ISS_PILOT) == first    # holding never edits the plan


def test_plan_rejects_unordered_or_negative_checkpoints():
    with pytest.raises(ValueError, match="PLAN_NOT_ORDERED"):
        FlightPlan(scenario_id="x", version="1", checkpoints=(
            Checkpoint(mission_s=0, phase="A", label="a", site="s"),
            Checkpoint(mission_s=120, phase="B", label="b", site="s"),
            Checkpoint(mission_s=60, phase="C", label="c", site="s")))
    with pytest.raises(ValueError, match="PLAN_MUST_START_AT_ZERO"):
        FlightPlan(scenario_id="x", version="1", checkpoints=(
            Checkpoint(mission_s=60, phase="B", label="b", site="s"),))
    with pytest.raises(ValueError, match="MISSION_TIME_NEGATIVE"):
        navigation_state(load_flight_plan(ISS_PILOT), -1)

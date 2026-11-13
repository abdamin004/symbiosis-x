"""SX-04B: a private check-in is readable by Crew and leaves operations unchanged."""

import json
import sys
from dataclasses import replace
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "backend" / "src"))
from symbiosis_x.crew.activity import CrewActivityState, generation_m3_h
from symbiosis_x.crew.wellbeing import (
    OnboardState,
    OperationalBasis,
    PrivateCheckIn,
    PrivateLane,
    read_check_ins,
    record_check_in,
)

MARKER = "SX01_PRIVATE_CREW_MARKER"


def golden_state():
    roster = json.loads((ROOT / "catalogs/crew/synthetic-roster.json").read_text())
    assert roster["synthetic"] is True
    activity = tuple(
        CrewActivityState(member["crew_id"], member["zone_id"], member["initial_mode"])
        for member in roster["crew"]
    )
    rates = {member["crew_id"]: member["co2_generation_m3_h"] for member in roster["crew"]}
    operational = OperationalBasis(decision_rev=103, mission_s=780, activity=activity)
    private = PrivateLane(crew_roster=frozenset(rates))
    return OnboardState(operational=operational, private=private), rates


def total_generation(state, rates):
    return sum(generation_m3_h(member, rates[member.crew_id]) for member in state.operational.activity)


def test_private_record_does_not_change_operation_revision():
    state, rates = golden_state()
    basis_before = state.operational
    generation_before = total_generation(state, rates)
    check_in = PrivateCheckIn(
        check_in_id="checkin-sim01-01", crew_id="SIM-01", mission_s=780,
        note=f"{MARKER}: mild headache after the scrubber drill (fictional)",
    )

    recorded = record_check_in(state, check_in)

    notes = read_check_ins(recorded, "SIM-01")
    assert [note.note for note in notes] == [check_in.note]
    assert notes[0].mission_s == 780
    assert notes[0].authorized_crew_ids == ("SIM-01",)
    assert notes[0].visibility == "onboard_private" and notes[0].synthetic is True
    assert recorded.operational is basis_before
    assert recorded.operational == basis_before
    assert recorded.operational.decision_rev == 103
    assert total_generation(recorded, rates) == pytest.approx(generation_before) == pytest.approx(0.04)
    assert MARKER not in repr(recorded.operational)
    assert MARKER not in repr(recorded)
    assert state.private.records == ()


def test_only_authorized_crew_read_the_check_in():
    state, _ = golden_state()
    check_in = PrivateCheckIn("checkin-sim01-01", "SIM-01", 780, f"{MARKER} (fictional)")
    recorded = record_check_in(state, check_in)

    assert read_check_ins(recorded, "SIM-02") == ()
    with pytest.raises(PermissionError):
        read_check_ins(recorded, "GROUND")

    shared = record_check_in(state, replace(check_in, authorized_crew_ids=("SIM-01", "SIM-03")))
    assert [note.crew_id for note in read_check_ins(shared, "SIM-03")] == ["SIM-01"]


def test_check_in_validation_and_idempotency():
    state, _ = golden_state()
    check_in = PrivateCheckIn("checkin-sim01-01", "SIM-01", 780, f"{MARKER} (fictional)")
    recorded = record_check_in(state, check_in)

    assert record_check_in(recorded, check_in) is recorded
    with pytest.raises(ValueError, match="already used"):
        record_check_in(recorded, replace(check_in, note="different"))
    with pytest.raises(ValueError, match="synthetic"):
        record_check_in(state, replace(check_in, synthetic=False))
    with pytest.raises(ValueError, match="roster"):
        record_check_in(state, replace(check_in, crew_id="SIM-99"))
    with pytest.raises(ValueError, match="own check-in"):
        record_check_in(state, replace(check_in, authorized_crew_ids=("SIM-02",)))
    with pytest.raises(ValueError, match="onboard crew"):
        record_check_in(state, replace(check_in, authorized_crew_ids=("SIM-01", "GROUND")))
    with pytest.raises(ValueError, match="mission seconds"):
        record_check_in(state, replace(check_in, mission_s=-1))
    with pytest.raises(ValueError, match="note"):
        record_check_in(state, replace(check_in, note="  "))

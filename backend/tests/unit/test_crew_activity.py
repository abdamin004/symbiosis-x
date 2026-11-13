"""Verify confirmed crew activity drives the cabin input exactly once."""

import json
import sys
from dataclasses import replace
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "backend" / "src"))
sys.path.insert(0, str(ROOT))
from symbiosis_x.crew.activity import (
    CrewActivity,
    CrewActivityState,
    apply_activity,
    generation_m3_h,
)
from symbiosis_x.simulation.spacecraft.atmosphere import advance_co2_ppm


def test_only_confirmed_activity_changes_generation():
    roster = json.loads((ROOT / "catalogs/crew/synthetic-roster.json").read_text())
    member = roster["crew"][0]
    rates = member["co2_generation_m3_h"]
    state = CrewActivityState(member["crew_id"], member["zone_id"], member["initial_mode"])
    planned = CrewActivity("activity-01", state.crew_id, state.zone_id, 360,
                           "reduced_activity", "planned")
    confirmed = replace(planned, status="confirmed")

    assert apply_activity(state, planned) is state
    assert generation_m3_h(state, rates) == 0.01
    applied = apply_activity(state, confirmed)
    assert generation_m3_h(applied, rates) == 0.005
    assert applied.accepted == (confirmed,)
    assert apply_activity(applied, confirmed) is applied

    cabin = {"duration_s": 420, "volume_m3": 100, "removal_m3_h": 4}
    baseline = advance_co2_ppm(2026.62, generation_m3_h=generation_m3_h(state, rates), **cabin)
    reduced = advance_co2_ppm(2026.62, generation_m3_h=generation_m3_h(applied, rates), **cabin)
    assert reduced < baseline

    with pytest.raises(ValueError, match="already used"):
        apply_activity(applied, replace(confirmed, mode="baseline"))
    with pytest.raises(ValueError, match="precede"):
        apply_activity(applied, replace(confirmed, event_id="late", mission_s=359))
    with pytest.raises(ValueError, match="modeled zone"):
        apply_activity(state, replace(confirmed, zone_id="other-zone"))


def test_four_astronauts_share_the_cabin():
    from scripts.build_cabin_preview import replay

    roster = json.loads((ROOT / "catalogs/crew/synthetic-roster.json").read_text())
    crew = roster["crew"]
    assert [member["crew_id"] for member in crew] == ["SIM-01", "SIM-02", "SIM-03", "SIM-04"]
    assert {member["zone_id"] for member in crew} == {"cabin-01"}
    baseline = replay(crew, set())
    one_confirmed = replay(crew, {"SIM-02"})
    two_confirmed = replay(crew, {"SIM-02", "SIM-04"})
    assert baseline[:2] == one_confirmed[:2] == two_confirmed[:2]
    assert baseline[2]["co2"] == one_confirmed[2]["co2"] == two_confirmed[2]["co2"]
    assert baseline[2]["generation"] == pytest.approx(0.040)
    assert one_confirmed[2]["generation"] == pytest.approx(0.035)
    assert two_confirmed[2]["generation"] == pytest.approx(0.030)
    assert two_confirmed[-1]["co2"] < one_confirmed[-1]["co2"] < baseline[-1]["co2"]
    assert baseline[-1]["co2"] == pytest.approx(2063.74, abs=0.01)

"""SX-06: three response options, with unknown evidence kept apart from no-feasible."""

import json
from dataclasses import replace
from pathlib import Path

import pytest

from symbiosis_x.contracts.commands import CandidateResults
from symbiosis_x.simulation.spacecraft.atmosphere import advance_co2_ppm
from symbiosis_x.twin.constraints import DEMO_CO2_LIMIT_PPM, PlanInputs, evaluate_candidates

ROOT = Path(__file__).resolve().parents[3]
EXAMPLE = json.loads((ROOT / "contracts" / "examples" / "candidate-results.json").read_text(encoding="utf-8"))


def co2_at_1300():
    co2 = advance_co2_ppm(2000, duration_s=60, volume_m3=100, generation_m3_h=0.04, removal_m3_h=20)
    return advance_co2_ppm(co2, duration_s=720, volume_m3=100, generation_m3_h=0.04, removal_m3_h=4)


# Golden 13:00 onboard evidence: degraded scrubber, 0.20 kW headroom, activity change not permitted.
GOLDEN = PlanInputs(
    basis_snapshot_id="crew-v103", decision_rev=103, co2_ppm=co2_at_1300(), volume_m3=100,
    generation_m3_h=0.04, removal_m3_h=4, power_headroom_kw=0.20, feeder_connected=True,
    standby_removal_m3_h=16, activity_change_permitted=False, reduced_generation_m3_h=0.02,
)


def results(plan):
    return {c.candidate_id: (c.result, c.reason_code) for c in plan.candidates}


def test_known_constraints_differ_from_missing_evidence():
    blocked = evaluate_candidates(GOLDEN)
    assert blocked.status == "NO_FEASIBLE_PLAN"
    assert results(blocked) == {
        "hold_course": ("rejected", "CO2_PEAK_LIMIT"),
        "start_standby": ("rejected", "POWER_LIMIT"),
        "reduce_activity": ("rejected", "ACTIVITY_RESTRICTED"),
    }

    missing = evaluate_candidates(replace(GOLDEN, co2_ppm=None, power_headroom_kw=None,
                                          activity_change_permitted=None))
    assert missing.status == "INSUFFICIENT_EVIDENCE"
    assert results(missing) == {
        "hold_course": ("unknown", "CO2_EVIDENCE_MISSING"),
        "start_standby": ("unknown", "HEADROOM_UNKNOWN"),
        "reduce_activity": ("unknown", "ACTIVITY_PERMISSION_UNKNOWN"),
    }
    assert missing.status != blocked.status
    with pytest.raises(ValueError, match="NOT_A_NO_FEASIBLE_RESULT"):
        missing.as_candidate_results()

    # One known block plus one unknown is still unknown overall: missing evidence never reads as no-feasible.
    partial = evaluate_candidates(replace(GOLDEN, activity_change_permitted=None))
    assert partial.status == "INSUFFICIENT_EVIDENCE"


def test_golden_1300_reproduces_the_frozen_candidate_example():
    plan = evaluate_candidates(GOLDEN)
    assert (plan.basis_snapshot_id, plan.decision_rev, plan.policy_version, plan.horizon_s) == (
        "crew-v103", 103, "demo-1", 21600)
    hold = next(c for c in plan.candidates if c.candidate_id == "hold_course")
    assert hold.peak_co2_ppm == pytest.approx(3757.12, abs=0.005) and hold.peak_co2_ppm > DEMO_CO2_LIMIT_PPM
    contract = plan.as_candidate_results()
    assert isinstance(contract, CandidateResults)
    assert contract.model_dump(mode="json", exclude_none=True) == EXAMPLE


def test_a_feasible_option_makes_the_plan_feasible():
    # Enough headroom for standby: the restored removal keeps the cabin under the demo limit.
    plan = evaluate_candidates(replace(GOLDEN, power_headroom_kw=0.60))
    assert plan.status == "FEASIBLE_PLAN"
    standby = next(c for c in plan.candidates if c.candidate_id == "start_standby")
    assert (standby.result, standby.reason_code) == ("feasible", None)
    assert standby.peak_co2_ppm <= DEMO_CO2_LIMIT_PPM
    assert (standby.required_kw, standby.available_kw) == (0.40, 0.60)

    # Permitted reduced activity is judged on its own CO₂ forecast, not assumed feasible.
    permitted = evaluate_candidates(replace(GOLDEN, activity_change_permitted=True))
    reduce = next(c for c in permitted.candidates if c.candidate_id == "reduce_activity")
    assert reduce.result in {"feasible", "rejected"}
    assert (reduce.reason_code is None) == (reduce.result == "feasible")

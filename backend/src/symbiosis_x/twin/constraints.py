"""Evaluate the three response options against accepted onboard evidence.

Each candidate is feasible, rejected by a known constraint, or unknown because
its evidence is missing. Unknown is never folded into rejected: a plan with
any unknown candidate and no feasible one is INSUFFICIENT_EVIDENCE, not
NO_FEASIBLE_PLAN. The result is advisory. Choosing and applying an option goes
through Crew approval and the commit gate.

The CO₂ limit is the team's labeled 3,200 ppm demo rule, not NASA's one-hour
ppCO₂ reference.
"""

from dataclasses import asdict, dataclass
from typing import Literal

from symbiosis_x.contracts.commands import CandidateResults
from symbiosis_x.simulation.spacecraft.atmosphere import advance_co2_ppm
from symbiosis_x.simulation.spacecraft.electrical import check_standby_power

POLICY_VERSION = "demo-1"
DEMO_CO2_LIMIT_PPM = 3200.0
HORIZON_S = 21_600

CandidateId = Literal["hold_course", "start_standby", "reduce_activity"]
Result = Literal["feasible", "rejected", "unknown"]
PlanStatus = Literal["FEASIBLE_PLAN", "NO_FEASIBLE_PLAN", "INSUFFICIENT_EVIDENCE"]
ReasonCode = Literal[
    "CO2_PEAK_LIMIT", "POWER_LIMIT", "FEEDER_DISCONNECTED", "ACTIVITY_RESTRICTED",
    "CO2_EVIDENCE_MISSING", "HEADROOM_UNKNOWN", "FEEDER_UNKNOWN", "STANDBY_RATE_UNKNOWN",
    "ACTIVITY_PERMISSION_UNKNOWN", "ACTIVITY_RATE_UNKNOWN",
]


@dataclass(frozen=True)
class PlanInputs:
    """Accepted evidence at one decision revision. ``None`` means the evidence is missing."""

    basis_snapshot_id: str
    decision_rev: int
    co2_ppm: float | None
    volume_m3: float
    generation_m3_h: float | None
    removal_m3_h: float | None
    power_headroom_kw: float | None
    feeder_connected: bool | None
    standby_removal_m3_h: float | None
    """Effective removal while the standby scrubber runs alongside the degraded one."""
    activity_change_permitted: bool | None
    reduced_generation_m3_h: float | None
    horizon_s: int = HORIZON_S
    co2_limit_ppm: float = DEMO_CO2_LIMIT_PPM


@dataclass(frozen=True)
class CandidateEvaluation:
    candidate_id: CandidateId
    result: Result
    reason_code: ReasonCode | None = None
    peak_co2_ppm: float | None = None
    required_kw: float | None = None
    available_kw: float | None = None


@dataclass(frozen=True)
class PlanEvaluation:
    status: PlanStatus
    basis_snapshot_id: str
    decision_rev: int
    policy_version: str
    horizon_s: int
    candidates: tuple[CandidateEvaluation, ...]

    def as_candidate_results(self) -> CandidateResults:
        """Express a no-feasible result in the frozen SX-01A candidate contract."""
        if self.status != "NO_FEASIBLE_PLAN":
            raise ValueError("NOT_A_NO_FEASIBLE_RESULT")
        candidates = []
        for c in self.candidates:
            entry = {"candidate_id": c.candidate_id, "status": "rejected", "reason_code": c.reason_code}
            if c.reason_code == "CO2_PEAK_LIMIT":
                entry["peak_co2_ppm"] = round(c.peak_co2_ppm, 2)
            elif c.reason_code == "POWER_LIMIT":
                entry |= {"required_kw": c.required_kw, "available_kw": c.available_kw}
            candidates.append(entry)
        return CandidateResults.model_validate({
            "status": "NO_FEASIBLE_PLAN", "basis_snapshot_id": self.basis_snapshot_id,
            "expected_decision_rev": self.decision_rev, "policy_version": self.policy_version,
            "horizon_s": self.horizon_s, "candidates": candidates,
        })


def _peak_ppm(inputs: PlanInputs, *, generation_m3_h: float, removal_m3_h: float) -> float:
    """Highest CO₂ over the horizon. With fixed inputs the trajectory is monotonic, so check both ends."""
    end = advance_co2_ppm(inputs.co2_ppm, duration_s=inputs.horizon_s, volume_m3=inputs.volume_m3,
                          generation_m3_h=generation_m3_h, removal_m3_h=removal_m3_h)
    return max(inputs.co2_ppm, end)


def _judge_co2(candidate_id: CandidateId, inputs: PlanInputs, *, generation_m3_h: float,
               removal_m3_h: float, **power) -> CandidateEvaluation:
    peak = _peak_ppm(inputs, generation_m3_h=generation_m3_h, removal_m3_h=removal_m3_h)
    if peak > inputs.co2_limit_ppm:
        return CandidateEvaluation(candidate_id, "rejected", "CO2_PEAK_LIMIT", peak, **power)
    return CandidateEvaluation(candidate_id, "feasible", None, peak, **power)


def _cabin_known(inputs: PlanInputs) -> bool:
    return None not in (inputs.co2_ppm, inputs.generation_m3_h, inputs.removal_m3_h)


def _hold_course(inputs: PlanInputs) -> CandidateEvaluation:
    if not _cabin_known(inputs):
        return CandidateEvaluation("hold_course", "unknown", "CO2_EVIDENCE_MISSING")
    return _judge_co2("hold_course", inputs, generation_m3_h=inputs.generation_m3_h,
                      removal_m3_h=inputs.removal_m3_h)


def _start_standby(inputs: PlanInputs) -> CandidateEvaluation:
    power = check_standby_power(inputs.power_headroom_kw, feeder_connected=inputs.feeder_connected)
    kw = {"required_kw": power.required_kw, "available_kw": power.available_kw}
    if power.outcome != "ready":
        result: Result = "rejected" if power.outcome == "blocked" else "unknown"
        return CandidateEvaluation("start_standby", result, power.reason_code, **kw)
    if inputs.standby_removal_m3_h is None:
        return CandidateEvaluation("start_standby", "unknown", "STANDBY_RATE_UNKNOWN", **kw)
    if not _cabin_known(inputs):
        return CandidateEvaluation("start_standby", "unknown", "CO2_EVIDENCE_MISSING", **kw)
    return _judge_co2("start_standby", inputs, generation_m3_h=inputs.generation_m3_h,
                      removal_m3_h=inputs.standby_removal_m3_h, **kw)


def _reduce_activity(inputs: PlanInputs) -> CandidateEvaluation:
    if inputs.activity_change_permitted is False:
        return CandidateEvaluation("reduce_activity", "rejected", "ACTIVITY_RESTRICTED")
    if inputs.activity_change_permitted is None:
        return CandidateEvaluation("reduce_activity", "unknown", "ACTIVITY_PERMISSION_UNKNOWN")
    if inputs.reduced_generation_m3_h is None:
        return CandidateEvaluation("reduce_activity", "unknown", "ACTIVITY_RATE_UNKNOWN")
    if not _cabin_known(inputs):
        return CandidateEvaluation("reduce_activity", "unknown", "CO2_EVIDENCE_MISSING")
    return _judge_co2("reduce_activity", inputs, generation_m3_h=inputs.reduced_generation_m3_h,
                      removal_m3_h=inputs.removal_m3_h)


def evaluate_candidates(inputs: PlanInputs) -> PlanEvaluation:
    """Evaluate hold, standby and reduced activity in a stable order."""
    candidates = (_hold_course(inputs), _start_standby(inputs), _reduce_activity(inputs))
    results = {c.result for c in candidates}
    if "feasible" in results:
        status: PlanStatus = "FEASIBLE_PLAN"
    elif "unknown" in results:
        status = "INSUFFICIENT_EVIDENCE"
    else:
        status = "NO_FEASIBLE_PLAN"
    return PlanEvaluation(status=status, basis_snapshot_id=inputs.basis_snapshot_id,
                          decision_rev=inputs.decision_rev, policy_version=POLICY_VERSION,
                          horizon_s=inputs.horizon_s, candidates=candidates)


@dataclass(frozen=True)
class ExerciseOption:
    candidate_id: Literal["keep_exercise", "defer_exercise"]
    result: Literal["feasible", "rejected"]
    reason_code: Literal["POWER_LIMIT", "CO2_PEAK_LIMIT"] | None
    projected_co2_ppm: float
    peak_co2_ppm: float
    headroom_kw: float
    standby: dict


def evaluate_exercise_options(fixture: dict, *, co2_ppm: float, duration_s: int, headroom_kw: float):
    """Compare an optional simulated exercise load with the same cabin and bus evidence."""
    options = []
    for option, generation, load in (
        ("keep_exercise", fixture["exercise_generation_m3_h"], fixture["exercise_load_kw"]),
        ("defer_exercise", fixture["rest_generation_m3_h"], 0),
    ):
        end = advance_co2_ppm(
            co2_ppm, duration_s=duration_s, volume_m3=fixture["cabin_volume_m3"],
            generation_m3_h=generation, removal_m3_h=fixture["removal_m3_h"],
        )
        peak = max(co2_ppm, end)
        remaining = round(headroom_kw - load, 3)
        reason = (
            "POWER_LIMIT" if remaining < fixture["minimum_headroom_kw"] else
            "CO2_PEAK_LIMIT" if peak > fixture["co2_limit_ppm"] else None
        )
        standby = asdict(check_standby_power(max(0, remaining)))
        options.append(ExerciseOption(
            option, "rejected" if reason else "feasible", reason, end, peak, remaining, standby,
        ))
    return tuple(options)

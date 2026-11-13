"""Run commands and the version-one kickoff decision examples."""

from typing import Annotated, Literal

from pydantic import Field, model_validator

from .events import Contract, Identifier, NonnegativeInt, NonnegativeNumber

Seed = Annotated[int, Field(ge=-(2**63), le=2**63 - 1)]


class StartRunRequest(Contract):
    start_id: Identifier
    scenario_id: Identifier
    scenario_version: Identifier
    seed: Seed


class RunReceipt(Contract):
    run_id: Identifier
    scenario_id: Identifier
    scenario_version: Identifier
    seed: Seed
    mission_s: NonnegativeInt
    step: NonnegativeInt


class AdvanceRunRequest(Contract):
    advance_id: Identifier
    expected_step: NonnegativeInt
    target_mission_s: NonnegativeInt | None = None


class AdvanceReceipt(RunReceipt):
    advance_id: Identifier


class DriverPauseRequest(Contract):
    paused: bool


class DriverPauseReceipt(Contract):
    run_id: Identifier
    paused: bool
    mission_s: NonnegativeInt


class ResetRunRequest(Contract):
    reset_id: Identifier


class ResetReceipt(RunReceipt):
    reset_id: Identifier
    reset_from_run_id: Identifier


CandidateId = Literal["hold_course", "start_standby", "reduce_activity"]


class GroundAdvisoryRequest(Contract):
    """Ground advice on one candidate, citing a snapshot already delivered to Ground."""

    operation_id: Identifier
    basis_snapshot_id: Identifier
    candidate_id: CandidateId


class AdvisoryReceipt(Contract):
    """Queued advice keeps its basis and is due onboard after the relay delay."""

    operation_id: Identifier
    run_id: Identifier
    status: Literal["queued"]
    candidate_id: CandidateId
    basis_snapshot_id: Identifier
    basis_decision_rev: NonnegativeInt
    issued_at_s: NonnegativeInt
    deliver_at_s: NonnegativeInt


class AdvisoryDisposition(Contract):
    """How onboard intake classified Ground advice when it arrived. It never applies anything."""

    operation_id: Identifier
    disposition: Literal["held", "crew_review"]
    reason_code: Literal["STALE_BASIS", "ADVICE_EXPIRED"] | None
    candidate_id: CandidateId
    basis_snapshot_id: Identifier
    basis_decision_rev: NonnegativeInt
    current_decision_rev: NonnegativeInt
    received_at_s: NonnegativeInt
    applied: Literal[False]

    @model_validator(mode="after")
    def held_has_reason(self):
        if (self.disposition == "held") != (self.reason_code is not None):
            raise ValueError("held advice carries a reason; advice for Crew review does not")
        return self


class RejectedCandidate(Contract):
    status: Literal["rejected"]


class HoldCourse(RejectedCandidate):
    candidate_id: Literal["hold_course"]
    reason_code: Literal["CO2_PEAK_LIMIT"]
    peak_co2_ppm: NonnegativeNumber


class StartStandby(RejectedCandidate):
    candidate_id: Literal["start_standby"]
    reason_code: Literal["POWER_LIMIT"]
    required_kw: NonnegativeNumber
    available_kw: NonnegativeNumber


class ReduceActivity(RejectedCandidate):
    candidate_id: Literal["reduce_activity"]
    reason_code: Literal["ACTIVITY_RESTRICTED"]


class CandidateResults(Contract):
    status: Literal["NO_FEASIBLE_PLAN"]
    basis_snapshot_id: Identifier
    expected_decision_rev: NonnegativeInt
    policy_version: Identifier
    horizon_s: Annotated[int, Field(gt=0)]
    candidates: list[Annotated[HoldCourse | StartStandby | ReduceActivity, Field(discriminator="candidate_id")]]

    @model_validator(mode="after")
    def validate_candidates(self):
        if sorted(c.candidate_id for c in self.candidates) != ["hold_course", "reduce_activity", "start_standby"]:
            raise ValueError("expected each kickoff candidate once")
        return self




PlanReasonCode = Literal[
    "CO2_PEAK_LIMIT", "POWER_LIMIT", "FEEDER_DISCONNECTED", "ACTIVITY_RESTRICTED",
    "CO2_EVIDENCE_MISSING", "HEADROOM_UNKNOWN", "FEEDER_UNKNOWN", "STANDBY_RATE_UNKNOWN",
    "ACTIVITY_PERMISSION_UNKNOWN", "ACTIVITY_RATE_UNKNOWN",
]


class PlanCandidate(Contract):
    candidate_id: CandidateId
    result: Literal["feasible", "rejected", "unknown"]
    reason_code: PlanReasonCode | None = None
    peak_co2_ppm: NonnegativeNumber | None = None
    required_kw: NonnegativeNumber | None = None
    available_kw: NonnegativeNumber | None = None


class PlanEvaluationReceipt(Contract):
    status: Literal["FEASIBLE_PLAN", "NO_FEASIBLE_PLAN", "INSUFFICIENT_EVIDENCE"]
    basis_snapshot_id: Identifier
    decision_rev: NonnegativeInt
    policy_version: Identifier
    horizon_s: Annotated[int, Field(gt=0)]
    candidates: list[PlanCandidate]


class ActionRequest(Contract):
    operation_id: Identifier
    candidate_id: CandidateId
    basis_decision_rev: NonnegativeInt
    policy_version: Identifier = "demo-1"
    basis_snapshot_id: Identifier | None = None
    expires_at_s: NonnegativeInt | None = None


class ActionReceipt(Contract):
    """Frozen SX-01A rejection contract used by the published fixture."""

    operation_id: Identifier
    status: Literal["rejected"]
    reason_code: Literal["STALE_DECISION_REV"]
    basis_decision_rev: NonnegativeInt
    current_decision_rev: NonnegativeInt
    applied: Literal[False]


class CrewActionReceipt(Contract):
    """SX-22D response contract; does not mutate the frozen kickoff example."""

    operation_id: Identifier
    candidate_id: CandidateId
    status: Literal["accepted", "rejected"]
    reason_code: PlanReasonCode | Literal["STALE_DECISION_REV", "ACTION_EXPIRED", "POLICY_VERSION_MISMATCH", "BASIS_SNAPSHOT_MISMATCH"] | None = None
    basis_decision_rev: NonnegativeInt
    current_decision_rev: NonnegativeInt
    applied: bool


class ShareCaseStatusRequest(Contract):
    """Crew approves sending one emergency case's minimal status to Ground."""

    operation_id: Identifier


class CaseRelayReceipt(Contract):
    """What Crew queued for Ground: only the alias, generic priority and status."""

    operation_id: Identifier
    case_alias: Identifier
    review_priority: Literal["urgent", "routine"]
    status: Literal["open", "acknowledged"]
    issued_at_s: NonnegativeInt
    deliver_at_s: NonnegativeInt

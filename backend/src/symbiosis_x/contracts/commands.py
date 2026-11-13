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


class AdvanceReceipt(RunReceipt):
    advance_id: Identifier


class ResetRunRequest(Contract):
    reset_id: Identifier


class ResetReceipt(RunReceipt):
    reset_id: Identifier
    reset_from_run_id: Identifier


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


class ActionReceipt(Contract):
    operation_id: Identifier
    status: Literal["rejected"]
    reason_code: Literal["STALE_DECISION_REV"]
    basis_decision_rev: NonnegativeInt
    current_decision_rev: NonnegativeInt
    applied: Literal[False]

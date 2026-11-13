"""Crew plan evaluation and idempotent command boundary."""

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from symbiosis_x.application.exercise_schedule import read_exercise_preview
from symbiosis_x.api.roles import require_role
from symbiosis_x.contracts.commands import (
    CrewActionReceipt, ActionRequest, PlanCandidate, PlanEvaluationReceipt,
)
from symbiosis_x.workflows.planner import evaluate_run
from symbiosis_x.application.commit import CommandConflict, CommandNotFound, commit_command

router = APIRouter(prefix="/api/v1/runs", tags=["decisions"])
require_crew = require_role("crew")


def _plan_receipt(plan) -> PlanEvaluationReceipt:
    return PlanEvaluationReceipt(
        status=plan.status,
        basis_snapshot_id=plan.basis_snapshot_id,
        decision_rev=plan.decision_rev,
        policy_version=plan.policy_version,
        horizon_s=plan.horizon_s,
        candidates=[
            PlanCandidate(
                candidate_id=item.candidate_id,
                result=item.result,
                reason_code=item.reason_code,
                peak_co2_ppm=item.peak_co2_ppm,
                required_kw=item.required_kw,
                available_kw=item.available_kw,
            )
            for item in plan.candidates
        ],
    )


@router.post("/{run_id}/plans/evaluate", response_model=PlanEvaluationReceipt,
             dependencies=[Depends(require_crew)])
def evaluate_plan(run_id: str, request: Request, response: Response) -> PlanEvaluationReceipt:
    """Evaluate accepted evidence without changing the run, journal, or decision revision."""
    response.headers["Cache-Control"] = "no-store"
    try:
        with request.app.state.repository.read() as db:
            return _plan_receipt(evaluate_run(db, run_id))
    except LookupError as error:
        raise HTTPException(404, str(error)) from error


@router.get("/{run_id}/crew/exercise-preview", dependencies=[Depends(require_crew)])
def exercise_preview(run_id: str, request: Request, response: Response) -> dict:
    response.headers["Cache-Control"] = "no-store"
    try:
        with request.app.state.repository.read() as db:
            return read_exercise_preview(db, run_id)
    except LookupError as error:
        raise HTTPException(404, str(error)) from error


@router.post("/{run_id}/actions", response_model=CrewActionReceipt,
             dependencies=[Depends(require_crew)])
def commit_action(run_id: str, command: ActionRequest, request: Request) -> CrewActionReceipt:
    """Delegate the authenticated command to the single transactional commit gate."""
    try:
        return commit_command(request.app.state.repository, run_id, command)
    except CommandNotFound as error:
        raise HTTPException(404, str(error)) from error
    except CommandConflict as error:
        raise HTTPException(409, str(error)) from error


@router.get("/{run_id}/actions/{operation_id}", response_model=CrewActionReceipt,
            dependencies=[Depends(require_crew)])
def get_action(run_id: str, operation_id: str, request: Request, response: Response) -> CrewActionReceipt:
    """Read the immutable receipt for a previously submitted operation."""
    response.headers["Cache-Control"] = "no-store"
    with request.app.state.repository.read() as db:
        row = db.execute(
            """SELECT receipt_json FROM operations
               WHERE run_id = ? AND operation_scope = 'crew_action' AND operation_id = ?""",
            (run_id, operation_id),
        ).fetchone()
        if row is None:
            exists = db.execute("SELECT 1 FROM runs WHERE run_id = ?", (run_id,)).fetchone()
            raise HTTPException(404, "RUN_NOT_FOUND" if exists is None else "ACTION_NOT_FOUND")
        return CrewActionReceipt.model_validate_json(row["receipt_json"])

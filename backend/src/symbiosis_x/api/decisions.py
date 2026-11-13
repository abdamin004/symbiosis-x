"""Crew plan evaluation and idempotent command boundary."""

from hashlib import sha256
import json

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from symbiosis_x.api.roles import require_role
from symbiosis_x.contracts.commands import (
    CrewActionReceipt, ActionRequest, PlanCandidate, PlanEvaluationReceipt,
)
from symbiosis_x.workflows.planner import evaluate_run

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


def _digest(command: ActionRequest) -> str:
    return sha256(command.model_dump_json().encode("utf-8")).hexdigest()


def _record_receipt(db, run_id: str, command: ActionRequest, receipt: CrewActionReceipt, digest: str) -> None:
    db.execute(
        """INSERT INTO operations (run_id, operation_scope, operation_id, request_digest, receipt_json)
           VALUES (?, 'crew_action', ?, ?, ?)""",
        (run_id, command.operation_id, digest, receipt.model_dump_json()),
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


@router.post("/{run_id}/actions", response_model=CrewActionReceipt,
             dependencies=[Depends(require_crew)])
def commit_action(run_id: str, command: ActionRequest, request: Request) -> CrewActionReceipt:
    """Commit one feasible Crew-approved option; retries return the original immutable receipt."""
    digest = _digest(command)
    with request.app.state.repository.write() as db:
        prior = db.execute(
            """SELECT request_digest, receipt_json FROM operations
               WHERE run_id = ? AND operation_scope = 'crew_action' AND operation_id = ?""",
            (run_id, command.operation_id),
        ).fetchone()
        if prior is not None:
            if prior["request_digest"] != digest:
                raise HTTPException(409, "OPERATION_ID_REUSED")
            return CrewActionReceipt.model_validate_json(prior["receipt_json"])

        run = db.execute(
            "SELECT status, decision_rev, mission_s FROM runs WHERE run_id = ?", (run_id,)
        ).fetchone()
        if run is None:
            raise HTTPException(404, "RUN_NOT_FOUND")
        if run["status"] != "active":
            raise HTTPException(409, "RUN_CLOSED")

        current_rev = run["decision_rev"]
        if command.basis_decision_rev != current_rev:
            receipt = CrewActionReceipt(
                operation_id=command.operation_id, candidate_id=command.candidate_id,
                status="rejected", reason_code="STALE_DECISION_REV",
                basis_decision_rev=command.basis_decision_rev,
                current_decision_rev=current_rev, applied=False,
            )
            _record_receipt(db, run_id, command, receipt, digest)
            return receipt

        plan = evaluate_run(db, run_id)
        candidate = next(item for item in plan.candidates if item.candidate_id == command.candidate_id)
        if candidate.result != "feasible":
            receipt = CrewActionReceipt(
                operation_id=command.operation_id, candidate_id=command.candidate_id,
                status="rejected", reason_code=candidate.reason_code,
                basis_decision_rev=command.basis_decision_rev,
                current_decision_rev=current_rev, applied=False,
            )
            _record_receipt(db, run_id, command, receipt, digest)
            return receipt

        next_rev = current_rev + 1
        receipt = CrewActionReceipt(
            operation_id=command.operation_id, candidate_id=command.candidate_id,
            status="accepted", reason_code=None,
            basis_decision_rev=command.basis_decision_rev,
            current_decision_rev=next_rev, applied=True,
        )
        db.execute("UPDATE runs SET decision_rev = ? WHERE run_id = ?", (next_rev, run_id))
        db.execute(
            """INSERT INTO events
               (run_id, event_seq, event_id, event_type, mission_s, visibility, payload_json)
               SELECT ?, COALESCE(MAX(event_seq), 0) + 1, ?, 'crew.action_committed', ?,
                      'operational', ? FROM events WHERE run_id = ?""",
            (run_id, f"action:{command.operation_id}", run["mission_s"],
             json.dumps(receipt.model_dump(mode="json"), sort_keys=True), run_id),
        )
        _record_receipt(db, run_id, command, receipt, digest)
        return receipt


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

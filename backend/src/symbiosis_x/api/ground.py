"""Ground's delivered view of a persisted simulation run, and advice sent from it."""

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from symbiosis_x.api.roles import require_role
from symbiosis_x.application.projections import read_ground
from symbiosis_x.application.runs import RunNotFound
from symbiosis_x.contracts.commands import AdvisoryReceipt, GroundAdvisoryRequest
from symbiosis_x.contracts.projections import CurrentGroundView, GroundCaseStatus
from symbiosis_x.workflows.relay import (
    AdvisoryRejected, CaseRelayRejected, acknowledge_ground_case, queue_ground_advisory,
)

router = APIRouter(prefix="/api/v1/runs", tags=["ground"])

require_ground = require_role("ground")


@router.get("/{run_id}/ground", dependencies=[Depends(require_ground)])
def ground(run_id: str, request: Request, response: Response) -> CurrentGroundView:
    response.headers["Cache-Control"] = "no-store"
    try:
        with request.app.state.repository.read() as db:
            return read_ground(db, run_id)
    except RunNotFound as error:
        raise HTTPException(404, str(error)) from error


@router.post("/{run_id}/ground/advisories", response_model=AdvisoryReceipt,
             dependencies=[Depends(require_ground)])
def advise(run_id: str, command: GroundAdvisoryRequest, request: Request) -> AdvisoryReceipt:
    """Queue advice for Crew. It cites a delivered snapshot and never changes plant state."""
    with request.app.state.repository.write() as db:
        run = db.execute(
            "SELECT run_id, mission_s, status FROM runs WHERE run_id = ?", (run_id,),
        ).fetchone()
        if run is None:
            raise HTTPException(404, "RUN_NOT_FOUND")
        try:
            return queue_ground_advisory(db, run, command)
        except AdvisoryRejected as error:
            raise HTTPException(409, str(error)) from error


@router.post("/{run_id}/ground/health-cases/{case_alias}/acknowledgment", response_model=GroundCaseStatus,
             dependencies=[Depends(require_ground)])
def acknowledge_case(run_id: str, case_alias: str, request: Request, response: Response) -> GroundCaseStatus:
    """Acknowledge a delivered case status. This is Ground's own record and never gates Crew."""
    response.headers["Cache-Control"] = "no-store"
    with request.app.state.repository.write() as db:
        run = db.execute(
            "SELECT run_id, mission_s, status FROM runs WHERE run_id = ?", (run_id,),
        ).fetchone()
        if run is None:
            raise HTTPException(404, "RUN_NOT_FOUND")
        try:
            return acknowledge_ground_case(db, run, case_alias)
        except CaseRelayRejected as error:
            status = 404 if str(error) == "CASE_NOT_DELIVERED" else 409
            raise HTTPException(status, str(error)) from error

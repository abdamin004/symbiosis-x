"""Nominal run commands available to the facilitator."""

from fastapi import APIRouter, Depends, HTTPException, Request

from symbiosis_x.api.roles import require_role
from symbiosis_x.application.runs import RunConflict, RunNotFound, advance_run, reset_run, start_run
from symbiosis_x.contracts.commands import AdvanceReceipt, AdvanceRunRequest, RunReceipt, StartRunRequest

router = APIRouter(prefix="/api/v1/runs", tags=["runs"])


require_facilitator = require_role("facilitator")


@router.post("", response_model=RunReceipt, dependencies=[Depends(require_facilitator)])
def start(command: StartRunRequest, request: Request) -> RunReceipt:
    try:
        return start_run(request.app.state.repository, command)
    except RunNotFound as error:
        raise HTTPException(404, str(error)) from error
    except RunConflict as error:
        raise HTTPException(409, str(error)) from error


@router.post("/{run_id}/advance", response_model=AdvanceReceipt, dependencies=[Depends(require_facilitator)])
def advance(run_id: str, command: AdvanceRunRequest, request: Request) -> AdvanceReceipt:
    try:
        return advance_run(request.app.state.repository, run_id, command)
    except RunNotFound as error:
        raise HTTPException(404, str(error)) from error
    except RunConflict as error:
        raise HTTPException(409, str(error)) from error

@router.post(
    "/{run_id}/reset",
    response_model=RunReceipt,
    dependencies=[Depends(require_facilitator)],
)
def reset(run_id: str, request: Request) -> RunReceipt:
    try:
        return reset_run(request.app.state.repository, run_id)
    except RunNotFound as error:
        raise HTTPException(404, str(error)) from error
    except RunConflict as error:
        raise HTTPException(409, str(error)) from error

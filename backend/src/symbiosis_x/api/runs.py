"""Nominal run commands available to the facilitator."""

from fastapi import APIRouter, Depends, HTTPException, Request

from symbiosis_x.api.roles import require_role
from symbiosis_x.application.runs import (
    RunConflict, RunNotFound, advance_run, end_run, pause_driver, reset_run, start_run,
)
from symbiosis_x.contracts.commands import (
    AdvanceReceipt, AdvanceRunRequest, DriverPauseRequest, DriverPauseReceipt, EndReceipt, EndRunRequest, ResetReceipt, ResetRunRequest, RunReceipt, StartRunRequest,
)

router = APIRouter(prefix="/api/v1/runs", tags=["runs"])


require_facilitator = require_role("facilitator")


@router.post("", response_model=RunReceipt, dependencies=[Depends(require_facilitator)])
def start(command: StartRunRequest, request: Request) -> RunReceipt:
    try:
        return start_run(request.app.state.repository, command, request.app.state.golden_manifest_path)
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


@router.post("/{run_id}/reset", response_model=ResetReceipt, dependencies=[Depends(require_facilitator)])
def reset(run_id: str, command: ResetRunRequest, request: Request) -> ResetReceipt:
    try:
        return reset_run(request.app.state.repository, run_id, command)
    except RunNotFound as error:
        raise HTTPException(404, str(error)) from error
    except RunConflict as error:
        raise HTTPException(409, str(error)) from error


@router.post("/{run_id}/end", response_model=EndReceipt, dependencies=[Depends(require_facilitator)])
def end(run_id: str, command: EndRunRequest, request: Request) -> EndReceipt:
    """End the mission. The run stays readable; later writes are rejected with RUN_CLOSED."""
    try:
        return end_run(request.app.state.repository, run_id, command)
    except RunNotFound as error:
        raise HTTPException(404, str(error)) from error
    except RunConflict as error:
        raise HTTPException(409, str(error)) from error


@router.post(
    "/{run_id}/driver/advance",
    response_model=AdvanceReceipt, dependencies=[Depends(require_facilitator)],
)
def driver_advance(run_id: str, command: AdvanceRunRequest, request: Request) -> AdvanceReceipt:
    """Facilitator-controlled optional tick, sharing the manual advance cursor and writer."""
    try:
        return advance_run(request.app.state.repository, run_id, command, driver=True)
    except RunNotFound as error:
        raise HTTPException(404, str(error)) from error
    except RunConflict as error:
        raise HTTPException(409, str(error)) from error


@router.post(
    "/{run_id}/driver/pause",
    response_model=DriverPauseReceipt, dependencies=[Depends(require_facilitator)],
)
def driver_pause(run_id: str, command: DriverPauseRequest, request: Request) -> DriverPauseReceipt:
    """Pause or resume driver ticks. Manual facilitator commands remain available."""
    try:
        return pause_driver(request.app.state.repository, run_id, command)
    except RunNotFound as error:
        raise HTTPException(404, str(error)) from error
    except RunConflict as error:
        raise HTTPException(409, str(error)) from error

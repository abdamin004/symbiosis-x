"""Crew's current view of a persisted simulation run and onboard emergency drills."""

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from symbiosis_x.api.roles import require_role
from symbiosis_x.application.projections import read_crew
from symbiosis_x.application.runs import RunNotFound
from symbiosis_x.contracts.projections import CurrentCrewView
from symbiosis_x.crew.emergency import (
    AcknowledgeEmergencyRequest,
    EmergencyCase,
    EmergencyConflict,
    EmergencyNotFound,
    EmergencyRejected,
    OpenEmergencyRequest,
    acknowledge_emergency,
    open_emergency,
    read_emergency,
)

router = APIRouter(prefix="/api/v1/runs", tags=["crew"])


@router.get("/{run_id}/crew", dependencies=[Depends(require_role("crew"))])
def crew(run_id: str, request: Request, response: Response) -> CurrentCrewView:
    response.headers["Cache-Control"] = "no-store"
    try:
        with request.app.state.repository.read() as db:
            return read_crew(db, run_id)
    except RunNotFound as error:
        raise HTTPException(404, str(error)) from error


def _emergency_error(error: Exception) -> HTTPException:
    if isinstance(error, EmergencyNotFound):
        return HTTPException(404, str(error))
    if isinstance(error, EmergencyRejected):
        return HTTPException(422, str(error))
    return HTTPException(409, str(error))


@router.post(
    "/{run_id}/crew/emergencies", dependencies=[Depends(require_role("crew"))],
    response_model=EmergencyCase, status_code=201,
)
def open_case(
    run_id: str, command: OpenEmergencyRequest, request: Request, response: Response,
) -> EmergencyCase:
    """Open one local case for a scripted drill. A repeat returns the same case with 200."""
    response.headers["Cache-Control"] = "no-store"
    try:
        case, created = open_emergency(request.app.state.repository, run_id, command)
    except (EmergencyNotFound, EmergencyRejected, EmergencyConflict) as error:
        raise _emergency_error(error) from error
    if not created:
        response.status_code = 200
    return case


@router.get(
    "/{run_id}/crew/emergencies/{case_id}", dependencies=[Depends(require_role("crew"))],
    response_model=EmergencyCase,
)
def read_case(run_id: str, case_id: str, request: Request, response: Response) -> EmergencyCase:
    response.headers["Cache-Control"] = "no-store"
    try:
        return read_emergency(request.app.state.repository, run_id, case_id)
    except EmergencyNotFound as error:
        raise _emergency_error(error) from error


@router.post(
    "/{run_id}/crew/emergencies/{case_id}/acknowledgment", dependencies=[Depends(require_role("crew"))],
    response_model=EmergencyCase,
)
def acknowledge_case(
    run_id: str, case_id: str, command: AcknowledgeEmergencyRequest, request: Request, response: Response,
) -> EmergencyCase:
    """Record the assigned local responder's acknowledgment."""
    response.headers["Cache-Control"] = "no-store"
    try:
        return acknowledge_emergency(request.app.state.repository, run_id, case_id, command)
    except (EmergencyNotFound, EmergencyRejected, EmergencyConflict) as error:
        raise _emergency_error(error) from error

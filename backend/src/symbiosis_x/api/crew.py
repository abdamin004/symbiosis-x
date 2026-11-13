"""Crew's current view of a persisted simulation run and onboard emergency drills."""

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from symbiosis_x.api.roles import require_role
from symbiosis_x.crew.measurements import (
    MeasurementConflict, MeasurementNotFound, MeasurementRejected,
    MeasurementReceipt, SaveMeasurementRequest, read_measurement, save_measurement,
)
from symbiosis_x.application.health_twin import CrewHealthTwin, read_health_twin
from symbiosis_x.application.projections import read_crew, read_run
from symbiosis_x.application.runs import RunConflict, RunNotFound
from symbiosis_x.application.wearable_rechecks import (
    RecheckCommand, RecheckConflict, RecheckNotFound, apply_recheck,
)
from symbiosis_x.application.wearables import CrewWearables, read_wearables
from symbiosis_x.crew.profile import profile_for_crew
from symbiosis_x.contracts.commands import CaseRelayReceipt, ShareCaseStatusRequest
from symbiosis_x.contracts.projections import CurrentCrewView
from symbiosis_x.workflows.monitor import WearableRecheck
from symbiosis_x.workflows.relay import CaseRelayRejected, queue_case_status
from symbiosis_x.crew.followup import (
    AcknowledgeReminderRequest,
    FollowupNotFound,
    FollowupRejected,
    acknowledge_reminder,
)
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
def crew(run_id: str, request: Request, response: Response, crew_id: str = "SIM-01") -> CurrentCrewView:
    response.headers["Cache-Control"] = "no-store"
    try:
        with request.app.state.repository.read() as db:
            return read_crew(db, run_id, crew_id)
    except (RunNotFound, LookupError) as error:
        raise HTTPException(404, str(error)) from error


@router.get("/{run_id}/crew/health-twin", dependencies=[Depends(require_role("crew"))])
def crew_health_twin(run_id: str, crew_id: str, request: Request, response: Response) -> CrewHealthTwin:
    response.headers["Cache-Control"] = "no-store"
    try:
        with request.app.state.repository.read() as db:
            return read_health_twin(db, run_id, crew_id)
    except (RunNotFound, LookupError) as error:
        raise HTTPException(404, str(error)) from error


def _emergency_error(error: Exception) -> HTTPException:
    if isinstance(error, EmergencyNotFound):
        return HTTPException(404, str(error))
    if isinstance(error, EmergencyRejected):
        return HTTPException(422, str(error))
    return HTTPException(409, str(error))


@router.get("/{run_id}/crew/wearables", dependencies=[Depends(require_role("crew"))])
def crew_wearables(run_id: str, crew_id: str, request: Request, response: Response) -> CrewWearables:
    response.headers["Cache-Control"] = "no-store"
    try:
        with request.app.state.repository.read() as db:
            run = read_run(db, run_id)
            if profile_for_crew(crew_id) is None:
                raise HTTPException(404, "CREW_NOT_FOUND")
            return read_wearables(db, run_id, crew_id, run["mission_s"])
    except RunNotFound as error:
        raise HTTPException(404, str(error)) from error


@router.post(
    "/{run_id}/crew/wearables/rechecks/{task_id}",
    dependencies=[Depends(require_role("crew"))],
)
def crew_wearable_recheck(
    run_id: str, task_id: str, crew_id: str, command: RecheckCommand, request: Request, response: Response,
) -> WearableRecheck:
    response.headers["Cache-Control"] = "no-store"
    try:
        return apply_recheck(request.app.state.repository, run_id, crew_id, task_id, command)
    except (RunNotFound, RecheckNotFound) as error:
        raise HTTPException(404, str(error)) from error
    except (RunConflict, RecheckConflict) as error:
        raise HTTPException(409, str(error)) from error


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

@router.post(
    "/{run_id}/crew/emergencies/{case_id}/relay", dependencies=[Depends(require_role("crew"))],
    response_model=CaseRelayReceipt,
)
def share_case_status(
    run_id: str, case_id: str, command: ShareCaseStatusRequest, request: Request, response: Response,
) -> CaseRelayReceipt:
    """Queue the approved minimal case status for Ground. Local escalation never waits for it."""
    response.headers["Cache-Control"] = "no-store"
    with request.app.state.repository.write() as db:
        run = db.execute("SELECT run_id, mission_s, status FROM runs WHERE run_id = ?", (run_id,)).fetchone()
        if run is None:
            raise HTTPException(404, "RUN_NOT_FOUND")
        row = db.execute(
            "SELECT case_json FROM emergency_cases WHERE run_id = ? AND case_id = ?", (run_id, case_id),
        ).fetchone()
        if row is None:
            raise HTTPException(404, "CASE_NOT_FOUND")
        case = EmergencyCase.model_validate_json(row["case_json"])
        try:
            # Only the case ID (for the opaque alias) and status cross into Relay.
            return queue_case_status(db, run, command, case_id=case.case_id, status=case.status)
        except CaseRelayRejected as error:
            raise HTTPException(409, str(error)) from error


@router.post(
    "/{run_id}/crew/reminders/{reminder_id}/acknowledgment", dependencies=[Depends(require_role("crew"))],
)
def acknowledge_crew_reminder(
    run_id: str, reminder_id: str, command: AcknowledgeReminderRequest, request: Request, response: Response,
) -> dict:
    """Acknowledge the current due instance of a personal reminder (Crew only)."""
    response.headers["Cache-Control"] = "no-store"
    try:
        return acknowledge_reminder(request.app.state.repository, run_id, reminder_id, command)
    except FollowupNotFound as error:
        raise HTTPException(404, str(error)) from error
    except FollowupRejected as error:
        status = 409 if str(error) == "RUN_CLOSED" else 422
        raise HTTPException(status, str(error)) from error


@router.post(
    "/{run_id}/crew/measurements",
    dependencies=[Depends(require_role("crew"))],
    response_model=MeasurementReceipt,
    status_code=201,
)
def save_crew_measurement(
    run_id: str, command: SaveMeasurementRequest, request: Request, response: Response,
) -> MeasurementReceipt:
    """Save one private, typed, synthetic Crew measurement and return its stable ID."""
    response.headers["Cache-Control"] = "no-store"
    try:
        return save_measurement(request.app.state.repository, run_id, command)
    except MeasurementNotFound as error:
        raise HTTPException(404, str(error)) from error
    except MeasurementRejected as error:
        raise HTTPException(422, str(error)) from error
    except MeasurementConflict as error:
        raise HTTPException(409, str(error)) from error


@router.get(
    "/{run_id}/crew/measurements/{measurement_id}",
    dependencies=[Depends(require_role("crew"))],
    response_model=MeasurementReceipt,
)
def get_crew_measurement(
    run_id: str, measurement_id: str, request: Request, response: Response,
) -> MeasurementReceipt:
    response.headers["Cache-Control"] = "no-store"
    try:
        return read_measurement(request.app.state.repository, run_id, measurement_id)
    except MeasurementNotFound as error:
        raise HTTPException(404, str(error)) from error

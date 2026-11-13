
"""Crew's current view and private check-ins of a simulation run."""

import json
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from symbiosis_x.api.roles import require_role
from symbiosis_x.application.projections import read_crew
from symbiosis_x.application.runs import RunNotFound
from symbiosis_x.contracts.projections import CurrentCrewView

router = APIRouter(prefix="/api/v1/runs", tags=["crew"])

crew_only = [Depends(require_role("crew"))]


class PrivateCheckInRequest(BaseModel):
    crew_id: str = Field(min_length=1, max_length=64)
    note: str = Field(min_length=1, max_length=1000)
    synthetic: bool = True


class PrivateCheckInRecord(BaseModel):
    record_id: str
    run_id: str
    crew_id: str
    note: str
    synthetic: bool
    mission_s: int


@router.get("/{run_id}/crew", dependencies=crew_only)
def crew(
    run_id: str,
    request: Request,
    response: Response,
) -> CurrentCrewView:
    response.headers["Cache-Control"] = "no-store"
    try:
        with request.app.state.repository.read() as db:
            return read_crew(db, run_id)
    except RunNotFound as error:
        raise HTTPException(404, str(error)) from error


@router.post(
    "/{run_id}/crew/check-ins",
    response_model=PrivateCheckInRecord,
    status_code=201,
    dependencies=crew_only,
)
def create_check_in(
    run_id: str,
    command: PrivateCheckInRequest,
    request: Request,
    response: Response,
) -> PrivateCheckInRecord:
    response.headers["Cache-Control"] = "no-store"

    if command.synthetic is not True:
        raise HTTPException(422, "SYNTHETIC_CHECK_IN_REQUIRED")

    with request.app.state.repository.write() as db:
        run = db.execute(
            "SELECT status, mission_s FROM runs WHERE run_id = ?",
            (run_id,),
        ).fetchone()

        if run is None:
            raise HTTPException(404, "RUN_NOT_FOUND")

        if run["status"] != "active":
            raise HTTPException(409, "RUN_CLOSED")

        record = PrivateCheckInRecord(
            record_id=uuid4().hex,
            run_id=run_id,
            crew_id=command.crew_id,
            note=command.note,
            synthetic=True,
            mission_s=run["mission_s"],
        )

        next_seq = db.execute(
            """SELECT COALESCE(MAX(event_seq), 0) + 1
               FROM events WHERE run_id = ?""",
            (run_id,),
        ).fetchone()[0]

        db.execute(
            """INSERT INTO events
               (run_id, event_seq, event_id, event_type,
                mission_s, visibility, payload_json)
               VALUES (?, ?, ?, 'crew.check_in',
                       ?, 'crew', ?)""",
            (
                run_id,
                next_seq,
                record.record_id,
                record.mission_s,
                record.model_dump_json(),
            ),
        )

    return record


@router.get(
    "/{run_id}/crew/check-ins/{record_id}",
    response_model=PrivateCheckInRecord,
    dependencies=crew_only,
)
def read_check_in(
    run_id: str,
    record_id: str,
    request: Request,
    response: Response,
) -> PrivateCheckInRecord:
    response.headers["Cache-Control"] = "no-store"

    with request.app.state.repository.read() as db:
        record = db.execute(
            """SELECT payload_json
               FROM events
               WHERE run_id = ?
                 AND event_id = ?
                 AND event_type = 'crew.check_in'
                 AND visibility = 'crew'""",
            (run_id, record_id),
        ).fetchone()

        if record is None:
            raise HTTPException(404, "CHECK_IN_NOT_FOUND")

        return PrivateCheckInRecord.model_validate_json(
            record["payload_json"]
        )

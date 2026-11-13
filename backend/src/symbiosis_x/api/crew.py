"""Crew's current view of a persisted simulation run."""

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from symbiosis_x.api.roles import require_role
from symbiosis_x.application.projections import read_crew
from symbiosis_x.application.runs import RunNotFound
from symbiosis_x.contracts.projections import CurrentCrewView

router = APIRouter(prefix="/api/v1/runs", tags=["crew"])


@router.get("/{run_id}/crew", dependencies=[Depends(require_role("crew"))])
def crew(run_id: str, request: Request, response: Response) -> CurrentCrewView:
    response.headers["Cache-Control"] = "no-store"
    try:
        with request.app.state.repository.read() as db:
            return read_crew(db, run_id)
    except RunNotFound as error:
        raise HTTPException(404, str(error)) from error

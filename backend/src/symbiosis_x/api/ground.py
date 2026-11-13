"""Ground's delivered view of a persisted simulation run."""

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from symbiosis_x.api.roles import require_role
from symbiosis_x.application.projections import read_ground
from symbiosis_x.application.runs import RunNotFound
from symbiosis_x.contracts.projections import CurrentGroundView

router = APIRouter(prefix="/api/v1/runs", tags=["ground"])


@router.get("/{run_id}/ground", dependencies=[Depends(require_role("ground"))])
def ground(run_id: str, request: Request, response: Response) -> CurrentGroundView:
    response.headers["Cache-Control"] = "no-store"
    try:
        with request.app.state.repository.read() as db:
            return read_ground(db, run_id)
    except RunNotFound as error:
        raise HTTPException(404, str(error)) from error

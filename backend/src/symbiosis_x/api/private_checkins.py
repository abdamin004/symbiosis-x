"""Crew-only API for synthetic private check-ins."""

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from symbiosis_x.api.roles import require_role
from symbiosis_x.application.checkins import (
    CheckInConflict,
    CheckInNotFound,
    create_check_in,
    read_check_in,
)
from symbiosis_x.contracts.checkins import PrivateCheckInReceipt, PrivateCheckInRequest

router = APIRouter(
    prefix="/api/v1/runs/{run_id}/crew/check-ins",
    tags=["crew"],
    dependencies=[Depends(require_role("crew"))],
)


@router.post("", response_model=PrivateCheckInReceipt, status_code=201)
def create(
    run_id: str,
    command: PrivateCheckInRequest,
    request: Request,
    response: Response,
) -> PrivateCheckInReceipt:
    response.headers["Cache-Control"] = "no-store"
    try:
        return create_check_in(request.app.state.repository, run_id, command)
    except CheckInNotFound as error:
        raise HTTPException(404, str(error)) from error
    except CheckInConflict as error:
        status_code = 422 if str(error) == "SYNTHETIC_CHECK_IN_REQUIRED" else 409
        raise HTTPException(status_code, str(error)) from error


@router.get("/{check_in_id}", response_model=PrivateCheckInReceipt)
def read(
    run_id: str,
    check_in_id: str,
    request: Request,
    response: Response,
) -> PrivateCheckInReceipt:
    response.headers["Cache-Control"] = "no-store"
    try:
        return read_check_in(request.app.state.repository, run_id, check_in_id)
    except CheckInNotFound as error:
        raise HTTPException(404, str(error)) from error

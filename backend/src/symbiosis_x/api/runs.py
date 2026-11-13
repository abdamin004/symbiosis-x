"""Loopback-only nominal demo commands pending the shared role resolver."""

from ipaddress import ip_address

from fastapi import APIRouter, Depends, HTTPException, Request

from symbiosis_x.application.runs import RunConflict, RunNotFound, advance_run, start_run
from symbiosis_x.contracts.commands import AdvanceReceipt, AdvanceRunRequest, RunReceipt, StartRunRequest

router = APIRouter(prefix="/api/v1/runs", tags=["runs"])


def require_local_facilitator(request: Request) -> None:
    # Local pilot only. KAN-29 will supply the server-issued role resolver.
    host = request.url.hostname
    origin = request.headers.get("origin")
    try:
        local_peer = request.client is not None and ip_address(request.client.host).is_loopback
    except ValueError:
        local_peer = False
    if not local_peer or host not in {"127.0.0.1", "localhost", "::1"}:
        raise HTTPException(403, "LOCAL_FACILITATOR_REQUIRED")
    if origin is not None and origin != str(request.base_url).rstrip("/"):
        raise HTTPException(403, "ORIGIN_NOT_ALLOWED")


@router.post("", response_model=RunReceipt, dependencies=[Depends(require_local_facilitator)])
def start(command: StartRunRequest, request: Request) -> RunReceipt:
    try:
        return start_run(request.app.state.repository, command)
    except RunNotFound as error:
        raise HTTPException(404, str(error)) from error
    except RunConflict as error:
        raise HTTPException(409, str(error)) from error


@router.post("/{run_id}/advance", response_model=AdvanceReceipt, dependencies=[Depends(require_local_facilitator)])
def advance(run_id: str, command: AdvanceRunRequest, request: Request) -> AdvanceReceipt:
    try:
        return advance_run(request.app.state.repository, run_id, command)
    except RunNotFound as error:
        raise HTTPException(404, str(error)) from error
    except RunConflict as error:
        raise HTTPException(409, str(error)) from error

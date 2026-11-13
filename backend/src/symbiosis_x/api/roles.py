"""Server-issued credentials for the loopback mission pilot."""

from ipaddress import ip_address
from secrets import compare_digest, token_urlsafe
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

Role = Literal["facilitator", "crew", "ground"]

router = APIRouter(prefix="/api/v1/demo", tags=["demo"])
bearer = HTTPBearer(auto_error=False)


def new_demo_tokens() -> dict[Role, str]:
    return {role: token_urlsafe(32) for role in ("facilitator", "crew", "ground")}


def require_loopback(request: Request) -> None:
    host = request.url.hostname
    origin = request.headers.get("origin")
    try:
        local_peer = request.client is not None and ip_address(request.client.host).is_loopback
    except ValueError:
        local_peer = False
    if not local_peer or host not in {"127.0.0.1", "localhost", "::1"}:
        raise HTTPException(403, "LOCAL_DEMO_REQUIRED")
    if origin is not None and origin != str(request.base_url).rstrip("/"):
        raise HTTPException(403, "ORIGIN_NOT_ALLOWED")


def require_role(role: Role):
    def authorize(
        request: Request,
        credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    ) -> None:
        require_loopback(request)
        tokens = request.app.state.demo_tokens
        if credentials is None or not credentials.credentials.isascii():
            raise HTTPException(401, "DEMO_TOKEN_REQUIRED", headers={"WWW-Authenticate": "Bearer"})
        for token_role, secret in tokens.items():
            if compare_digest(credentials.credentials, secret):
                if token_role == role:
                    return
                raise HTTPException(403, "ROLE_FORBIDDEN")
        raise HTTPException(401, "INVALID_DEMO_TOKEN", headers={"WWW-Authenticate": "Bearer"})

    return authorize


@router.post("/session", dependencies=[Depends(require_loopback)])
def issue_demo_session(request: Request, response: Response) -> dict[Role, str]:
    """Give the local operator credentials for switching between demo viewpoints."""
    tokens = request.app.state.demo_tokens
    if not tokens:
        raise HTTPException(404, "LOCAL_DEMO_DISABLED")
    response.headers["Cache-Control"] = "no-store"
    return tokens

"""Service probes that report process health without touching a run."""

from typing import Literal

from fastapi import APIRouter, Response
from pydantic import BaseModel

router = APIRouter(prefix="/health", tags=["health"])


class LiveStatus(BaseModel):
    status: Literal["live"]


@router.get("/live", response_model=LiveStatus)
def live(response: Response) -> LiveStatus:
    """Answer while FastAPI responds; never open SQLite or read the mission clock."""
    response.headers["Cache-Control"] = "no-store"
    return LiveStatus(status="live")

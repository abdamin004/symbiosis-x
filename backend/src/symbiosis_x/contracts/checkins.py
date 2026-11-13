"""Contracts for synthetic private crew check-ins."""

from pydantic import Field, StrictBool

from .events import Contract, Identifier


class PrivateCheckInRequest(Contract):
    check_in_id: Identifier
    crew_id: Identifier
    note: str = Field(min_length=1, max_length=1000)
    synthetic: StrictBool


class PrivateCheckInReceipt(Contract):
    check_in_id: Identifier
    run_id: Identifier
    crew_id: Identifier
    note: str
    synthetic: StrictBool
    mission_s: int = Field(ge=0)

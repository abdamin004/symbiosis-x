"""Contracts for synthetic private crew check-ins."""

from typing import Annotated

from pydantic import Field, StrictBool

from .events import Contract, Identifier


MoodScore = Annotated[int, Field(ge=1, le=5)]


class PrivateCheckInRequest(Contract):
    check_in_id: Identifier
    crew_id: Identifier
    note: str = Field(max_length=1000)
    mood_score: MoodScore | None = None
    synthetic: StrictBool


class PrivateCheckInReceipt(Contract):
    check_in_id: Identifier
    run_id: Identifier
    crew_id: Identifier
    note: str
    synthetic: StrictBool
    mission_s: int = Field(ge=0)
    mood_score: MoodScore | None = None


class PrivateMoodReport(Contract):
    crew_id: Identifier
    mission_s: int = Field(ge=0)
    mood_score: MoodScore

"""Record synthetic private crew check-ins in the onboard lane.

A check-in holds a fictional note, its mission timestamp and the crew reference
authorized to read it. It lives in a private lane beside the operational basis,
so recording one never touches the decision revision or any plant input.
"""

from dataclasses import dataclass, field, replace
from typing import Literal

from symbiosis_x.crew.activity import CrewActivityState

Visibility = Literal["onboard_private"]
Provenance = Literal["synthetic_fixture"]


@dataclass(frozen=True)
class PrivateCheckIn:
    check_in_id: str
    crew_id: str
    mission_s: int
    # Kept out of repr so the private text never lands in logs or shared traces.
    note: str = field(repr=False)
    authorized_crew_ids: tuple[str, ...] = ()
    visibility: Visibility = "onboard_private"
    provenance: Provenance = "synthetic_fixture"
    synthetic: bool = True


@dataclass(frozen=True)
class PrivateLane:
    crew_roster: frozenset[str]
    records: tuple[PrivateCheckIn, ...] = ()


@dataclass(frozen=True)
class OperationalBasis:
    """The state that operational decisions and the plant read."""

    decision_rev: int
    mission_s: int
    activity: tuple[CrewActivityState, ...] = ()


@dataclass(frozen=True)
class OnboardState:
    operational: OperationalBasis
    private: PrivateLane


def record_check_in(state: OnboardState, check_in: PrivateCheckIn) -> OnboardState:
    """Return the state with the check-in stored in the private lane only."""
    lane = state.private
    if not check_in.synthetic or check_in.provenance != "synthetic_fixture":
        raise ValueError("check-ins accept synthetic fixture records only")
    if check_in.visibility != "onboard_private":
        raise ValueError("check-ins stay in the onboard private lane")
    if not check_in.check_in_id or not check_in.note.strip():
        raise ValueError("check-in requires an ID and a note")
    if type(check_in.mission_s) is not int or check_in.mission_s < 0:
        raise ValueError("check-in requires nonnegative integer mission seconds")
    if check_in.crew_id not in lane.crew_roster:
        raise ValueError("check-in crew member is not on the onboard roster")
    readers = check_in.authorized_crew_ids or (check_in.crew_id,)
    if check_in.crew_id not in readers:
        raise ValueError("the crew member must be able to read their own check-in")
    if not set(readers) <= lane.crew_roster:
        raise ValueError("authorized readers must be onboard crew")
    check_in = replace(check_in, authorized_crew_ids=tuple(readers))

    for prior in lane.records:
        if prior.check_in_id == check_in.check_in_id:
            if prior != check_in:
                raise ValueError("check-in ID already used with different values")
            return state

    # The operational basis is carried over as the same object, unchanged.
    return replace(state, private=replace(lane, records=(*lane.records, check_in)))


def read_check_ins(state: OnboardState, reader_crew_id: str) -> tuple[PrivateCheckIn, ...]:
    """Return the check-ins this onboard crew member is authorized to read."""
    if reader_crew_id not in state.private.crew_roster:
        raise PermissionError("only onboard crew can read private check-ins")
    return tuple(
        record for record in state.private.records if reader_crew_id in record.authorized_crew_ids
    )

"""Apply confirmed synthetic crew activity within a single simulation run."""

from dataclasses import dataclass, replace
from typing import Literal

ActivityMode = Literal["baseline", "reduced_activity"]
ActivityStatus = Literal["planned", "confirmed"]


@dataclass(frozen=True)
class CrewActivity:
    event_id: str
    crew_id: str
    zone_id: str
    mission_s: int
    mode: ActivityMode
    status: ActivityStatus


@dataclass(frozen=True)
class CrewActivityState:
    crew_id: str
    zone_id: str
    mode: ActivityMode
    # The runtime can reconstruct this state from its accepted event journal.
    accepted: tuple[CrewActivity, ...] = ()


def apply_activity(state: CrewActivityState, event: CrewActivity) -> CrewActivityState:
    """Return the new crew state and retain only accepted confirmations."""
    if (event.crew_id, event.zone_id) != (state.crew_id, state.zone_id):
        raise ValueError("activity must match the crew member and modeled zone")
    if not event.event_id or type(event.mission_s) is not int or event.mission_s < 0:
        raise ValueError("activity requires an event ID and nonnegative mission seconds")
    if event.mode not in ("baseline", "reduced_activity"):
        raise ValueError("unknown activity mode")
    if event.status == "planned":
        return state
    if event.status != "confirmed":
        raise ValueError("unknown activity status")

    for prior in state.accepted:
        if prior.event_id == event.event_id:
            if prior != event:
                raise ValueError("confirmed activity ID already used with different values")
            return state
    if state.accepted and event.mission_s < state.accepted[-1].mission_s:
        raise ValueError("confirmed activity cannot precede the current crew activity")

    return replace(state, mode=event.mode, accepted=(*state.accepted, event))


def generation_m3_h(state: CrewActivityState, rates: dict[str, float]) -> float:
    """Read this crew member's effective CO₂ input for the current mode."""
    return rates[state.mode]

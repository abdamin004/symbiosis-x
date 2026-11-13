"""Planned flight phase, next waypoint and schedule-based ETA.

Navigation reads mission time and an approved plan of checkpoints. It has no
randomness and no wall clock, so a replay of the same plan and mission times
returns the same phase and ETA sequence. A readiness hold never edits the
plan: the craft stays in its current phase and the ETA to the held checkpoint
becomes conditional, even after its scheduled time has passed.
"""

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

EtaBasis = Literal["scheduled", "conditional", "complete"]


@dataclass(frozen=True)
class Checkpoint:
    mission_s: int
    phase: str
    label: str
    site: str


@dataclass(frozen=True)
class FlightPlan:
    scenario_id: str
    version: str
    checkpoints: tuple[Checkpoint, ...]

    def __post_init__(self) -> None:
        if not self.checkpoints:
            raise ValueError("PLAN_EMPTY")
        times = [c.mission_s for c in self.checkpoints]
        if any(type(t) is not int for t in times) or times[0] != 0:
            raise ValueError("PLAN_MUST_START_AT_ZERO")
        if any(later <= earlier for earlier, later in zip(times, times[1:])):
            raise ValueError("PLAN_NOT_ORDERED")


@dataclass(frozen=True)
class PhaseHold:
    """Readiness blocks entry to ``phase`` until ``blocker`` clears."""

    phase: str
    blocker: str


@dataclass(frozen=True)
class NavigationState:
    mission_s: int
    phase: str
    checkpoint: Checkpoint
    next_waypoint: Checkpoint | None
    eta_s: int | None
    eta_basis: EtaBasis
    hold_blocker: str | None


def load_flight_plan(path: Path) -> FlightPlan:
    """Read the ``legs`` of a versioned scenario as planned checkpoints."""
    document = json.loads(Path(path).read_text(encoding="utf-8"))
    checkpoints = tuple(
        Checkpoint(mission_s=leg["time"], phase=leg["phase"], label=leg["label"], site=leg["site"])
        for leg in document["legs"]
    )
    return FlightPlan(scenario_id=document["scenario_id"], version=str(document["version"]),
                      checkpoints=checkpoints)


def navigation_state(plan: FlightPlan, mission_s: int, *, hold: PhaseHold | None = None) -> NavigationState:
    """Return the phase at ``mission_s`` and the next planned checkpoint with its ETA."""
    if type(mission_s) is not int:
        raise TypeError("mission time must be integer seconds")
    if mission_s < 0:
        raise ValueError("MISSION_TIME_NEGATIVE")

    reached = [i for i, c in enumerate(plan.checkpoints) if c.mission_s <= mission_s]
    index = reached[-1]
    blocker = None
    if hold is not None:
        # The checkpoint that enters the held phase; a hold on the starting phase has nothing to hold.
        held = next((i for i in range(1, len(plan.checkpoints))
                     if plan.checkpoints[i].phase == hold.phase
                     and plan.checkpoints[i - 1].phase != hold.phase), None)
        if held is not None and index >= held - 1:
            # Stay at the last checkpoint before the held phase; the plan itself is unchanged.
            index = min(index, held - 1)
            blocker = hold.blocker

    current = plan.checkpoints[index]
    upcoming = plan.checkpoints[index + 1] if index + 1 < len(plan.checkpoints) else None
    if upcoming is None:
        basis: EtaBasis = "complete"
    else:
        basis = "conditional" if blocker else "scheduled"
    return NavigationState(
        mission_s=mission_s, phase=current.phase, checkpoint=current, next_waypoint=upcoming,
        eta_s=upcoming.mission_s if upcoming else None, eta_basis=basis, hold_blocker=blocker,
    )

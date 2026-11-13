"""Crew-only comparison of authored spaceflight observations."""

from typing import Literal

from symbiosis_x.contracts.events import Contract, NonnegativeInt


class GravityPhase(Contract):
    phase: Literal["preflight", "orbit", "reentry", "recovery"]
    starts_at_s: NonnegativeInt
    mobility: str
    orientation: str
    rest: str


class GravityContext(Contract):
    schema_version: Literal[1] = 1
    source_id: Literal["synthetic.health-story-gravity-v1"] = "synthetic.health-story-gravity-v1"
    synthetic: Literal[True] = True
    baseline: GravityPhase
    current: GravityPhase
    elapsed_in_phase_s: NonnegativeInt
    orbital_exposure_s: NonnegativeInt
    next_phase_at_s: NonnegativeInt | None


def project_gravity_context(fixture: dict, crew_id: str, mission_s: int) -> GravityContext | None:
    if crew_id != fixture["subject_crew_id"]:
        return None
    phases = [GravityPhase.model_validate(segment) for segment in fixture["gravity_phases"]]
    if (
        [segment.phase for segment in phases] != ["preflight", "orbit", "reentry", "recovery"]
        or phases[0].starts_at_s != 0
        or any(left.starts_at_s >= right.starts_at_s for left, right in zip(phases, phases[1:]))
    ):
        raise ValueError("GRAVITY_TIMELINE_MISMATCH")
    baseline, orbit, reentry, _ = phases
    current = next(segment for segment in reversed(phases) if segment.starts_at_s <= mission_s)
    next_phase = next((segment for segment in phases if segment.starts_at_s > mission_s), None)
    return GravityContext(
        baseline=baseline,
        current=current,
        elapsed_in_phase_s=mission_s - current.starts_at_s,
        orbital_exposure_s=max(0, min(mission_s, reentry.starts_at_s) - orbit.starts_at_s),
        next_phase_at_s=next_phase.starts_at_s if next_phase else None,
    )

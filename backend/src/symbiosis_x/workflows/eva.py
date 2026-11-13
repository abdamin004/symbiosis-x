"""Generate synthetic antenna-service profiles using the vehicle airlock model.

A case is released and verified by the Flight Commander. Profiles are read-only
until release. They describe a vehicle-airlock rehearsal using authored values.
"""

from dataclasses import asdict, dataclass
from typing import Literal

from symbiosis_x.simulation.spacecraft.airlock import Airlock, AirlockState, advance_airlock
from symbiosis_x.simulation.spacecraft.cabin_gas import Compartment, Plant, initial_state, readings

PLANT = Plant((Compartment("Cabin", 60), Compartment("Airlock", 5)))
LOCK = Airlock("Cabin", "Airlock", pump_mol_s_kpa=4, open_hatch_mol_s_kpa=2)


@dataclass(frozen=True)
class Readiness:
    mission_capable: bool
    qualified: bool
    crew_available: bool
    airlock_available: bool
    comms_ready: bool
    tether_ready: bool
    oxygen_pct: int
    battery_pct: int
    return_margin_s: int


def readiness_problem(checks: Readiness, scenario: dict) -> str:
    if not checks.mission_capable:
        return "Spacewalk requires Horizon in parking orbit or secured at the station."
    if not checks.qualified or not checks.crew_available:
        return "A qualified spacewalker and airlock watch must be available."
    if not checks.airlock_available:
        return "The airlock must be available before release."
    if not checks.comms_ready:
        return "Suit link offline. Restore communications before release."
    if not checks.tether_ready:
        return "Check the tether before releasing the spacewalk."
    if (checks.oxygen_pct < scenario["minimum_release_oxygen_pct"]
            or checks.battery_pct < scenario["minimum_release_battery_pct"]
            or checks.return_margin_s < scenario["minimum_return_margin_s"]):
        return "Suit reserve or return margin is below the release limit."
    return ""


def recall_reason(scenario: dict, *, comms_ready=True, oxygen_pct=100, battery_pct=100) -> str:
    if not comms_ready:
        return "Suit link lost"
    if oxygen_pct <= scenario["oxygen_reserve_pct"] or battery_pct <= scenario["battery_reserve_pct"]:
        return "Suit reserve at return limit"
    return ""


@dataclass(frozen=True)
class Frame:
    pressure_kpa: float
    inner: bool
    outer: bool


def airlock_frame(state: AirlockState) -> Frame:
    chamber = readings(state.cabin, PLANT)[1]
    return Frame(round(chamber.total_pressure_kpa, 2), state.inner_open, state.outer_open)


def step_profile(tick: int, recall_at: int | None = None) -> list[Frame]:
    """Follow the crew through the same airlock for outbound and return passage."""
    state = AirlockState(initial_state(PLANT), "inner_open")
    frames = [airlock_frame(state)]
    for elapsed in range(1, 7 * tick + 1):
        side: Literal["cabin", "vacuum"] = "vacuum" if tick < elapsed <= 6 * tick else "cabin"
        if recall_at is not None and elapsed > recall_at:
            # If already outside, give the crew one tick to reach the chamber.
            if recall_at < 2 * tick or elapsed > recall_at + tick:
                side = "cabin"
        state = advance_airlock(state, PLANT, LOCK, 1, requested_side=side)
        frames.append(airlock_frame(state))
        if elapsed >= 2 * tick and side == "vacuum" and not state.outer_open:
            raise ValueError("The authored EVA reaches the exterior before pressure equalizes")
        if recall_at is not None and elapsed >= recall_at + tick and state.inner_open:
            break
    if not state.inner_open:
        raise ValueError("The authored EVA return exceeds its airlock window")
    return frames


def build_eva_rehearsal(scenario: dict, tick: int) -> dict:
    nominal = step_profile(tick)
    recalls = {}
    for elapsed in range(len(nominal) - 1):
        profile = step_profile(tick, elapsed)
        recalls[elapsed] = [asdict(frame) for frame in profile[elapsed:]]
    return {
        **{key: value for key, value in scenario.items() if key != "seeded_faults"},
        "nominal": [asdict(frame) for frame in nominal],
        "recalls": recalls,
    }


def rehearsed_outcome(
    scenario: dict, tick: int, *, fault: dict | None = None, verify_at_s: int | None = None
) -> dict:
    """Resolve the authored acceptance case through the pressure and return gates."""
    reason = recall_reason(
        scenario, **{key: value for key, value in (fault or {}).items() if key != "elapsed_s"}
    )
    recall_at = fault["elapsed_s"] if reason else None
    frames = step_profile(tick, recall_at)
    safe_return = len(frames) - 1 if frames[-1].inner else None
    verified = (
        not reason and safe_return is not None and verify_at_s is not None
        and verify_at_s >= safe_return
    )
    before = scenario["antenna_before_db"]
    return {
        "safe_return_at_s": safe_return,
        "recall_reason": reason,
        "repair_verified_at_s": verify_at_s if verified else None,
        "antenna_before_db": before,
        "antenna_after_db": scenario["antenna_after_db"] if verified else before,
    }

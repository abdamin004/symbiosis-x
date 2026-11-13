"""Private fictional training cues derived from current compartment gas."""

from dataclasses import dataclass
from typing import Literal

from symbiosis_x.simulation.spacecraft.cabin_gas import (
    CO2_LIMIT_PPM,
    NOMINAL_O2_FRACTION,
    NOMINAL_PRESSURE_KPA,
    CabinState,
    CompartmentReading,
    Plant,
    readings,
)

# Gameplay settings for the cabin drill.
DEMO_LOW_PRESSURE_KPA = NOMINAL_PRESSURE_KPA * 0.8
DEMO_LOW_O2_PARTIAL_KPA = NOMINAL_PRESSURE_KPA * NOMINAL_O2_FRACTION * 0.8

ExposureReason = Literal["low_cabin_pressure", "low_oxygen_partial_pressure", "elevated_co2"]
EXPOSURE_SOURCE_ID = "synthetic.cabin-exposure-demo-v1"


@dataclass(frozen=True)
class CabinExposure:
    """Onboard cue, separate from crew workload inputs and voluntary reports."""

    crew_id: str
    environment: CompartmentReading
    observed_at_s: int
    workload_cue: Literal["nominal", "ease_workload"]
    reasons: tuple[ExposureReason, ...]
    source_id: str = EXPOSURE_SOURCE_ID
    synthetic: bool = True


def crew_cabin_exposure(state: CabinState, plant: Plant, crew_id: str) -> CabinExposure:
    """Read the crew member's current room. Recompute on movement or gas change."""
    members = [member for member in plant.crew if member.crew_id == crew_id]
    if len(members) != 1:
        raise ValueError("exposure requires one current compartment for the crew member")
    [member] = members
    room = next(room for room in readings(state, plant) if room.compartment_id == member.compartment_id)
    reasons: list[ExposureReason] = []
    if room.total_pressure_kpa < DEMO_LOW_PRESSURE_KPA:
        reasons.append("low_cabin_pressure")
    if room.o2_partial_kpa < DEMO_LOW_O2_PARTIAL_KPA:
        reasons.append("low_oxygen_partial_pressure")
    if room.co2_ppm > CO2_LIMIT_PPM:
        reasons.append("elevated_co2")
    return CabinExposure(crew_id, room, state.mission_s, "ease_workload" if reasons else "nominal", tuple(reasons))

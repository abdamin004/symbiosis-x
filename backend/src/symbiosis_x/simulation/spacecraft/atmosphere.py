"""Pure, single-zone CO₂ model and cabin pressure signal for the synthetic cabin scenario."""

from dataclasses import dataclass
from math import exp, expm1, isfinite
from typing import Literal

PPM_PER_FRACTION = 1_000_000
SECONDS_PER_HOUR = 3_600


def advance_co2_ppm(
    co2_ppm: float,
    *,
    duration_s: float,
    volume_m3: float,
    generation_m3_h: float,
    removal_m3_h: float,
) -> float:
    """Advance a well-mixed cabin over one interval of fixed generation and removal.

    Removal is effective air-scrubbing flow. The removal of CO₂ itself is
    proportional to the concentration. Split the interval at any input change.
    """
    for name, value in (
        ("co2_ppm", co2_ppm),
        ("duration_s", duration_s),
        ("volume_m3", volume_m3),
        ("generation_m3_h", generation_m3_h),
        ("removal_m3_h", removal_m3_h),
    ):
        if not isfinite(value) or value < 0:
            raise ValueError(f"{name} must be finite and nonnegative")
    if volume_m3 == 0:
        raise ValueError("volume_m3 must be positive")

    time_per_volume = duration_s / SECONDS_PER_HOUR / volume_m3
    removal_exposure = removal_m3_h * time_per_volume
    if removal_exposure == 0:
        return co2_ppm + generation_m3_h * time_per_volume * PPM_PER_FRACTION

    # expm1 keeps very small decay fractions accurate as removal tends to zero.
    removed_fraction = -expm1(-removal_exposure)
    generation_factor = removed_fraction / removal_exposure
    return (
        co2_ppm * exp(-removal_exposure)
        + generation_m3_h * time_per_volume * generation_factor * PPM_PER_FRACTION
    )


# Synthetic sea-level cabin atmosphere (14.7 psia). A labeled demo value, not flight data.
NOMINAL_CABIN_PRESSURE_KPA = 101.3
PRESSURE_SOURCE_ID = "sim.cabin.pressure"
PRESSURE_UNIT = "kPa"


@dataclass(frozen=True)
class PressureReading:
    source_id: str
    entity_id: str
    observed_at_s: int
    value: float | None
    unit: Literal["kPa"]
    quality: Literal["valid", "unavailable"]
    reason_code: Literal["PRESSURE_UNAVAILABLE"] | None


def sample_cabin_pressure(pressure_kpa: float | None, *, mission_s: int,
                          entity_id: str = "cabin-01") -> PressureReading:
    """Read total cabin pressure in kPa. Missing input is an unavailable reading, never a guess."""
    if type(mission_s) is not int or mission_s < 0:
        raise ValueError("mission time must be nonnegative integer seconds")
    if pressure_kpa is None:
        return PressureReading(PRESSURE_SOURCE_ID, entity_id, mission_s, None, PRESSURE_UNIT,
                               "unavailable", "PRESSURE_UNAVAILABLE")
    if isinstance(pressure_kpa, bool) or not isfinite(pressure_kpa) or pressure_kpa < 0:
        raise ValueError("cabin pressure must be finite and nonnegative kPa")
    return PressureReading(PRESSURE_SOURCE_ID, entity_id, mission_s, float(pressure_kpa), PRESSURE_UNIT,
                           "valid", None)


def co2_partial_pressure_kpa(co2_ppm: float | None, pressure_kpa: float | None) -> float | None:
    """Convert CO₂ concentration to partial pressure. Without both inputs the answer is unknown."""
    if co2_ppm is None or pressure_kpa is None:
        return None
    return co2_ppm / PPM_PER_FRACTION * pressure_kpa

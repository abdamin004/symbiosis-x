"""Pure, single-zone CO₂ model for the synthetic cabin scenario."""

from math import exp, expm1, isfinite

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

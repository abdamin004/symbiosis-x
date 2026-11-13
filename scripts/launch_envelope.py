"""Generate the synthetic ascent and insertion envelope for the local game."""

TICK_SECONDS = 15


def launch_envelope(config: dict) -> dict:
    """Precompute game reserve and insertion eligibility at each coast tick."""
    ascent = config["ascent"]
    timings = ("burn_s", "separation_deadline_s", "minimum_coast_s", "coast_limit_s")
    if any(ascent[key] <= 0 or ascent[key] % TICK_SECONDS for key in timings):
        raise ValueError("Ascent timings must be positive multiples of a mission tick")
    if ascent["burn_s"] >= ascent["separation_deadline_s"]:
        raise ValueError("Booster burnout must precede the separation deadline")
    if ascent["minimum_coast_s"] > ascent["coast_limit_s"]:
        raise ValueError("Insertion readiness must precede the coast limit")

    coast = []
    for seconds in range(0, ascent["coast_limit_s"] + 1, TICK_SECONDS):
        reserve = max(0, ascent["reserve_initial"] - seconds // TICK_SECONDS * ascent["coast_cost_per_tick"])
        after_burn = reserve - ascent["insertion_cost"]
        coast.append({
            "seconds": seconds,
            "reserve": reserve,
            "can_insert": seconds >= ascent["minimum_coast_s"] and after_burn >= ascent["minimum_reserve"],
            "after_burn": max(0, after_burn),
        })
    return {**ascent, "tick_s": TICK_SECONDS, "coast": coast}

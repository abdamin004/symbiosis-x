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

    insertion = ascent.get("insertion_profile")
    if insertion and not (insertion["initial_periapsis_km"] < insertion["minimum_periapsis_km"]
                          <= insertion["target_periapsis_km"] <= insertion["apoapsis_km"]):
        raise ValueError("The insertion profile must raise periapsis into the stable orbit envelope")

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


def rendezvous_envelope(config: dict) -> dict:
    """Build the fictional station track and annotate its capture window."""
    rendezvous = config["rendezvous"]
    track = rendezvous["approach"]
    if not track or [sample["seconds"] for sample in track] != list(range(0, len(track)*TICK_SECONDS, TICK_SECONDS)):
        raise ValueError("The approach track must start at zero and follow the mission tick")

    window_end = track[-1]["seconds"]
    return {
        **rendezvous,
        "approach": [
            {
                **sample,
                "capture": sample["range"] <= 10 and 0 <= sample["closing"] <= 1 and sample["seconds"] < window_end,
                "expired": sample["seconds"] == window_end,
            }
            for sample in track
        ],
    }



def propulsion_envelope(config: dict) -> dict:
    """Build authored stage budgets and burn costs in synthetic kilograms."""
    model = config["propulsion"]
    if any(type(value) is not int or value < 0 for value in model.values()):
        raise ValueError("Propulsion inventory and costs must be nonnegative integers")
    ascent, recovery = config["ascent"], config["return"]
    if model["booster_solid_kg"] <= 0 or model["return_liquid_kg"] < recovery["reserve_cost"] + model["departure_cost"]:
        raise ValueError("Propulsion inventory cannot cover ascent or return")
    separate_return = "rendezvous" in config
    if separate_return and (not model["match_cost"] or not model["departure_cost"]):
        raise ValueError("Rendezvous needs independent matching and departure burns")
    return {
        "solid": model["booster_solid_kg"],
        "upper": ascent["reserve_initial"],
        "return": model["return_liquid_kg"],
        "separateReturn": separate_return,
        "costs": {
            "insertion": ascent["insertion_cost"],
            "transfer": config.get("rendezvous", {}).get("phasing_cost", 0),
            "match": model["match_cost"],
            "departure": model["departure_cost"],
            "retrograde": recovery["reserve_cost"],
        },
    }

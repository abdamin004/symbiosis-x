"""Synthetic submission fault. The playback compresses the modeled cabin clock."""

from dataclasses import asdict

from symbiosis_x.crew.cabin_exposure import crew_cabin_exposure
from symbiosis_x.simulation.spacecraft.atmosphere import advance_co2_ppm
from symbiosis_x.simulation.spacecraft.cabin_gas import CO2_LIMIT_PPM, Compartment, CrewLoad, Plant, initial_state

ROOM = "cabin-01"
START_PPM = 2000
REPAIR_S = 12000
RECOVERY_S = 22800
SAMPLE_S = 600


def cabin_sample(time_s: int) -> dict:
    inputs = {"volume_m3": 100, "generation_m3_h": 0.04}
    peak = advance_co2_ppm(START_PPM, duration_s=min(time_s, REPAIR_S), removal_m3_h=0, **inputs)
    value = advance_co2_ppm(peak, duration_s=max(0, time_s - REPAIR_S), removal_m3_h=20, **inputs)
    return {"time_s": time_s, "ppm": round(value), "flow_m3_h": 20 if time_s == 0 or time_s >= REPAIR_S else 0}


def cabin_exposure(crew_id: str, time_s: int) -> dict:
    plant = Plant((Compartment(ROOM, 100),), crew=(CrewLoad(crew_id, ROOM),))
    sample = cabin_sample(time_s)
    state = initial_state(plant, co2_ppm=sample["ppm"], mission_s=time_s)
    return asdict(crew_cabin_exposure(state, plant, crew_id))


def submission_cabin() -> dict:
    return {
        "limit_ppm": CO2_LIMIT_PPM,
        "repair_s": REPAIR_S,
        "sample_s": SAMPLE_S,
        "samples": [cabin_sample(time) for time in range(0, RECOVERY_S + 1, SAMPLE_S)],
    }

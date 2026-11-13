"""Build the shared, fictional ISS research replay for both local canvases."""

import json
from itertools import combinations

if __package__:
    from .build_cabin_preview import ROOT, replay
else:
    from build_cabin_preview import ROOT, replay

from symbiosis_x.simulation.spacecraft.atmosphere import advance_co2_ppm


def build_replays(crew: list[dict]) -> tuple[dict, dict]:
    scenario = json.loads((ROOT / "scenarios/variants/iss-research-pilot-v1.json").read_text())
    crew_ids = [member["crew_id"] for member in crew]
    runs = {}
    for count in range(len(crew_ids) + 1):
        for selected in combinations(crew_ids, count):
            cabin_frames = replay(crew, set(selected))
            runs[",".join(selected)] = [
                mission_frame(leg, cabin_frames, index)
                for index, leg in enumerate(scenario["legs"])
            ]
    return scenario, runs


def mission_frame(leg: dict, cabin_frames: list[dict], index: int) -> dict:
    if index < len(cabin_frames):
        cabin = cabin_frames[index]
        air_source = "Outbound cabin model"
    elif leg["vehicle"] == "Outbound capsule":
        previous = cabin_frames[-1]
        cabin = {
            **previous,
            "co2": advance_co2_ppm(
                previous["co2"], duration_s=leg["time"] - previous["time"],
                volume_m3=100, generation_m3_h=previous["generation"],
                removal_m3_h=previous["removal"],
            ),
        }
        air_source = "Outbound cabin model"
    elif leg["vehicle"] == "ISS laboratory":
        cabin = {"co2": 2400, "removal": None, "power": None, "generation": None}
        air_source = "Scripted station environment"
    else:
        cabin = {"co2": 2000, "removal": 20, "power": 0.60, "generation": 0.04}
        air_source = "Scripted return environment"

    # CO2 is modeled in the outbound cabin. Use a fixed O2 fraction for display
    # and group the remaining volume as balance gases, including nitrogen.
    co2_pct = cabin["co2"] / 10_000
    return {
        **cabin, **leg, "air_source": air_source,
        "air": {"oxygen_pct": 20.9, "co2_pct": co2_pct, "balance_pct": 79.1 - co2_pct},
        "habitat": {
            "beds": 3 if leg["phase"] == "Station rest" else 0,
            "wc": "In use" if leg["phase"] == "Station rest" else "Available",
            "meal": "Meal and hydration window" if leg["phase"] == "Station rest" else "Scheduled",
        },
    }


def crew_history(frames: list[dict], crew_ids: list[str]) -> dict:
    """Deterministic device fixtures, separate from the atmosphere model."""
    return {
        crew_id: [
            {
                "time": frame["time"],
                "heart_rate": 69 + 2 * i + (7 if frame["phase"] == "Station research" else 0)
                             - (4 if frame["phase"] == "Station rest" and i < 3 else 0),
                "pitch": 18 if frame["phase"] == "Station research" and i == 1 else 4 + i,
                "roll": 3 + i,
                "speed": 0.3 if frame["phase"] == "Station research" else 0.0,
                "emg": 0.42 if frame["phase"] == "Station research" and i == 1 else 0.18,
            }
            for frame in frames
        ]
        for i, crew_id in enumerate(crew_ids)
    }

"""Render the local cabin pilot from the actual Python simulation and SX-01A fixture."""

import argparse
import json
import sys
from itertools import combinations
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend" / "src"))
from symbiosis_x.crew.activity import (
    CrewActivity,
    CrewActivityState,
    apply_activity,
    generation_m3_h,
)
from symbiosis_x.simulation.spacecraft.atmosphere import advance_co2_ppm

ACTIVITY_S = 360
CHECKPOINTS = (
    (0, "Nominal", 20, 0.60),
    (60, "Primary degraded", 4, 0.60),
    (ACTIVITY_S, "Activity checkpoint", 4, 0.60),
    (600, "Power drops", 4, 0.20),
    (780, "Ground handoff", 4, 0.20),
)


def replay(crew: list[dict], confirmed_ids: set[str]) -> list[dict]:
    states = {
        member["crew_id"]: CrewActivityState(member["crew_id"], member["zone_id"], member["initial_mode"])
        for member in crew
    }
    frames = []
    co2_ppm = 2000.0
    for time, label, removal, power in CHECKPOINTS:
        if frames:
            previous = frames[-1]
            co2_ppm = advance_co2_ppm(
                co2_ppm,
                duration_s=time - previous["time"],
                volume_m3=100,
                generation_m3_h=previous["generation"],
                removal_m3_h=previous["removal"],
            )
        if time == ACTIVITY_S:
            for crew_id, state in states.items():
                activity = CrewActivity(
                    f"demo-activity-{crew_id}", crew_id, state.zone_id, time,
                    "reduced_activity", "confirmed" if crew_id in confirmed_ids else "planned",
                )
                states[crew_id] = apply_activity(state, activity)
        generation = sum(
            generation_m3_h(states[member["crew_id"]], member["co2_generation_m3_h"])
            for member in crew
        )
        frames.append({
            "time": time, "label": label, "co2": co2_ppm, "removal": removal,
            "power": power, "generation": generation,
        })
    return frames

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path, help="Path to the generated HTML preview")
    args = parser.parse_args()

    roster = json.loads((ROOT / "catalogs/crew/synthetic-roster.json").read_text())
    crew = roster["crew"]
    crew_ids = [member["crew_id"] for member in crew]
    ground = json.loads((ROOT / "contracts/examples/ground-v102.json").read_text())
    replays = {
        ",".join(selected): replay(crew, set(selected))
        for size in range(len(crew_ids) + 1)
        for selected in combinations(crew_ids, size)
    }
    data = {
        "crew_ids": crew_ids,
        "replays": replays,
        "ground": ground,
        "activity_s": ACTIVITY_S,
    }
    template = (ROOT / "docs/demo/cabin.html").read_text(encoding="utf-8")
    payload = json.dumps(data).replace("<", "\\u003c")
    args.output.write_text(template.replace("__REPLAY_DATA__", payload), encoding="utf-8")


if __name__ == "__main__":
    main()

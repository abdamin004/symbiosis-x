"""Render the local cabin pilot from the actual Python simulation and SX-01A fixture."""

import argparse
import json
import sys
from dataclasses import replace
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


def replay(member: dict, event: CrewActivity) -> list[dict]:
    state = CrewActivityState(member["crew_id"], member["zone_id"], member["initial_mode"])
    rates = member["co2_generation_m3_h"]
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
        if time == event.mission_s:
            state = apply_activity(state, event)
        frames.append({
            "time": time, "label": label, "co2": co2_ppm, "removal": removal,
            "power": power, "generation": generation_m3_h(state, rates),
        })
    return frames


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path, help="Path to the generated HTML preview")
    args = parser.parse_args()

    roster = json.loads((ROOT / "catalogs/crew/synthetic-roster.json").read_text())
    member = roster["crew"][0]
    planned = CrewActivity(
        "demo-activity-01", member["crew_id"], member["zone_id"], ACTIVITY_S,
        "reduced_activity", "planned",
    )
    ground = json.loads((ROOT / "contracts/examples/ground-v102.json").read_text())
    data = {
        "crew": replay(member, planned),
        "reduced": replay(member, replace(planned, status="confirmed")),
        "ground": ground,
        "crew_id": member["crew_id"],
        "activity_s": ACTIVITY_S,
    }
    template = (ROOT / "docs/demo/cabin.html").read_text(encoding="utf-8")
    payload = json.dumps(data).replace("<", "\\u003c")
    args.output.write_text(template.replace("__REPLAY_DATA__", payload), encoding="utf-8")


if __name__ == "__main__":
    main()

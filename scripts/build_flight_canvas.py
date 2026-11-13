"""Build the player view from the room catalog and Python cabin replay."""

import argparse
import json
from pathlib import Path

if __package__:
    from .build_cabin_preview import ACTIVITY_S, ROOT
    from .iss_mission_replay import build_replays, crew_history
else:
    from build_cabin_preview import ACTIVITY_S, ROOT
    from iss_mission_replay import build_replays, crew_history


def build(output: Path) -> None:
    crew = json.loads((ROOT / "catalogs/crew/synthetic-roster.json").read_text())["crew"]
    crew_ids = [member["crew_id"] for member in crew]
    rooms = json.loads((ROOT / "catalogs/sx01/rooms.json").read_text())["rooms"]
    launch = json.loads((ROOT / "scenarios/variants/launch-checkout-v1.json").read_text())
    scenario, frames = build_replays(crew)
    data = json.dumps({
        "metrics": json.loads((ROOT / "catalogs/crew/health-metrics.json").read_text())["metrics"],
        "rooms": rooms, "crew": crew_ids, "activity_s": ACTIVITY_S, "launch": launch,
        "frames": frames, "history": crew_history(frames[""], crew_ids), "research": scenario["research"],
    }, ensure_ascii=False).replace("<", "\\u003c")
    template = (ROOT / "docs/demo/flight.html").read_text(encoding="utf-8")
    workflow = (ROOT / "docs/demo/flight-workflow.js").read_text(encoding="utf-8")
    widgets = (ROOT / "docs/demo/flight-widgets.js").read_text(encoding="utf-8")
    stations = (ROOT / "docs/demo/flight-stations.js").read_text(encoding="utf-8")
    checkout = (ROOT / "docs/demo/launch-checkout.js").read_text(encoding="utf-8")
    icons = (ROOT / "frontend/src/ui/icons/lucide/flight.svg").read_text(encoding="utf-8")
    output.write_text(
        template.replace("__FLIGHT_DATA__", data)
        .replace("__FLIGHT_WORKFLOW__", workflow).replace("__FLIGHT_WIDGETS__", widgets)
        .replace("__FLIGHT_STATIONS__", stations).replace("__LAUNCH_CHECKOUT__", checkout).replace("__HUD_ICONS__", icons),
        encoding="utf-8",
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    build(parser.parse_args().output)

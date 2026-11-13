"""Build the player view from the room catalog and Python cabin replay."""

import argparse
import json
from pathlib import Path

if __package__:
    from .flight_airlock_rehearsal import build_airlock_rehearsal
    from .flight_health_rehearsal import build_health_rehearsal
    from .build_cabin_preview import ACTIVITY_S, ROOT
    from .iss_mission_replay import build_replays, crew_history
    from .launch_envelope import launch_envelope, propulsion_envelope, rendezvous_envelope
    from .flight_orbit import navigation_reference
else:
    from flight_airlock_rehearsal import build_airlock_rehearsal
    from flight_health_rehearsal import build_health_rehearsal
    from build_cabin_preview import ACTIVITY_S, ROOT
    from iss_mission_replay import build_replays, crew_history
    from launch_envelope import launch_envelope, propulsion_envelope, rendezvous_envelope
    from flight_orbit import navigation_reference


def build(output: Path) -> None:
    crew = json.loads((ROOT / "catalogs/crew/synthetic-roster.json").read_text())["crew"]
    crew_ids = [member["crew_id"] for member in crew]
    rooms = json.loads((ROOT / "catalogs/sx01/rooms.json").read_text())["rooms"]
    missions = []
    for preset in ("launch-checkout-v1", "orbital-systems-checkout-v1"):
        mission = json.loads((ROOT / f"scenarios/variants/{preset}.json").read_text())
        mission["propulsion_budget"] = propulsion_envelope(mission)
        mission["ascent"] = launch_envelope(mission)
        mission["navigation"] = navigation_reference(mission["ascent"], mission["propulsion"]["rcs_pulses"])
        if "rendezvous" in mission:
            mission["rendezvous"] = rendezvous_envelope(mission)
        missions.append(mission)
    scenario, frames = build_replays(crew)
    ground = json.loads((ROOT / "contracts/examples/ground-v102.json").read_text())
    data = json.dumps({
        "metrics": json.loads((ROOT / "catalogs/crew/health-metrics.json").read_text())["metrics"],
        "rooms": rooms, "crew": crew_ids, "activity_s": ACTIVITY_S, "missions": missions,
        "airlock": build_airlock_rehearsal(),
        "health_drill": build_health_rehearsal(ROOT / "scenarios/sx01-golden-v1.json"),
        "replay_ground": {
            "snapshot_id": ground["snapshot_id"], "decision_rev": ground["decision_rev"],
            "delivery": ground["delivery"], "co2": ground["equipment"]["co2"],
            "power_headroom": ground["equipment"]["power_headroom"],
        },
        "replay_version": scenario["version"],
        "frames": frames, "history": crew_history(frames[""], crew_ids), "research": scenario["research"],
    }, ensure_ascii=False).replace("<", "\\u003c")
    template = (ROOT / "docs/demo/flight.html").read_text(encoding="utf-8")
    workflow = (ROOT / "docs/demo/flight-workflow.js").read_text(encoding="utf-8")
    flight_ground = (ROOT / "docs/demo/flight-ground.js").read_text(encoding="utf-8")
    widgets = (ROOT / "docs/demo/flight-widgets.js").read_text(encoding="utf-8")
    stations = (ROOT / "docs/demo/flight-stations.js").read_text(encoding="utf-8")
    launch_scene = (ROOT / "docs/demo/launch-scene.js").read_text(encoding="utf-8")
    missions_ui = (ROOT / "docs/demo/flight-missions.js").read_text(encoding="utf-8")
    checkout = (ROOT / "docs/demo/launch-checkout.js").read_text(encoding="utf-8")
    timed_demo = (ROOT / "docs/demo/flight-demo.js").read_text(encoding="utf-8")
    anatomy = (ROOT / "docs/demo/flight-anatomy.html").read_text(encoding="utf-8")
    crew_routines = (ROOT / "docs/demo/flight-crew.js").read_text(encoding="utf-8")
    docking_scene = (ROOT / "docs/demo/docking-scene.js").read_text(encoding="utf-8")
    navigation = (ROOT / "docs/demo/flight-navigation.js").read_text(encoding="utf-8")
    processes = (ROOT / "docs/demo/flight-processes.js").read_text(encoding="utf-8")
    icons = (ROOT / "frontend/src/ui/icons/lucide/flight.svg").read_text(encoding="utf-8")
    output.write_text(
        template.replace("__FLIGHT_DATA__", data)
        .replace("__FLIGHT_WORKFLOW__", workflow).replace("__FLIGHT_GROUND__", flight_ground)
        .replace("__FLIGHT_WIDGETS__", widgets)
        .replace("__FLIGHT_STATIONS__", stations).replace("__LAUNCH_SCENE__", launch_scene)
        .replace("__FLIGHT_MISSIONS__", missions_ui)
        .replace("__FLIGHT_DEMO__", timed_demo).replace("__LAUNCH_CHECKOUT__", checkout).replace("__HUD_ICONS__", icons)
        .replace("__FLIGHT_ANATOMY__", anatomy).replace("__FLIGHT_CREW__", crew_routines)
        .replace("__DOCKING_SCENE__", docking_scene).replace("__FLIGHT_NAVIGATION__", navigation)
        .replace("__FLIGHT_PROCESSES__", processes),
        encoding="utf-8",
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    build(parser.parse_args().output)

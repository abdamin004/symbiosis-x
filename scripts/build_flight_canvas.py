"""Build the player view from the room catalog and Python cabin replay."""

import argparse
import json
from itertools import combinations
from pathlib import Path

if __package__:
    from .build_cabin_preview import ACTIVITY_S, ROOT, replay
else:
    from build_cabin_preview import ACTIVITY_S, ROOT, replay


def build(output: Path) -> None:
    crew = json.loads((ROOT / "catalogs/crew/synthetic-roster.json").read_text())["crew"]
    crew_ids = [member["crew_id"] for member in crew]
    rooms = json.loads((ROOT / "catalogs/sx01/rooms.json").read_text())["rooms"]
    ground = json.loads((ROOT / "contracts/examples/ground-v102.json").read_text())["delivery"]
    frames = {
        ",".join(selected): replay(crew, set(selected))
        for count in range(len(crew_ids) + 1)
        for selected in combinations(crew_ids, count)
    }
    data = json.dumps({
        "rooms": rooms, "crew": crew_ids, "activity_s": ACTIVITY_S,
        "frames": frames, "relay_delivery_s": ground["received_at_s"],
    }, ensure_ascii=False).replace("<", "\\u003c")
    template = (ROOT / "docs/demo/flight.html").read_text(encoding="utf-8")
    output.write_text(template.replace("__FLIGHT_DATA__", data), encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    build(parser.parse_args().output)

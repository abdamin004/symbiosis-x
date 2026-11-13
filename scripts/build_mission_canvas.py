"""Render the mission canvas with the shared room and measurement catalogs."""

import argparse
import json
from itertools import combinations
from pathlib import Path

if __package__:
    from .build_cabin_preview import ROOT, replay
else:
    from build_cabin_preview import ROOT, replay


def read_catalog(path: str) -> dict:
    return json.loads((ROOT / path).read_text(encoding="utf-8"))


def build(output: Path) -> None:
    crew = read_catalog("catalogs/crew/synthetic-roster.json")["crew"]
    crew_ids = [member["crew_id"] for member in crew]
    runs = {
        ",".join(selected): replay(crew, set(selected))
        for count in range(len(crew_ids) + 1)
        for selected in combinations(crew_ids, count)
    }
    data = {
        "rooms": read_catalog("catalogs/sx01/rooms.json")["rooms"],
        "metrics": read_catalog("catalogs/crew/health-metrics.json")["metrics"],
        "crew_ids": crew_ids,
        "replays": runs,
        "sensor": read_catalog("catalogs/sx01/sensors.json")["sensors"][0],
        "ground": read_catalog("contracts/examples/ground-v102.json"),
    }
    template = (ROOT / "docs/demo/mission.html").read_text(encoding="utf-8")
    payload = json.dumps(data, ensure_ascii=False).replace("<", "\\u003c")
    output.write_text(template.replace("__ROOM_CATALOG__", payload), encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    build(parser.parse_args().output)

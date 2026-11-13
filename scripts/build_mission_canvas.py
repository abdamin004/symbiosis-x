"""Render the room catalog into the standalone mission canvas template."""

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def build(output: Path) -> None:
    catalog = json.loads((ROOT / "catalogs/sx01/rooms.json").read_text(encoding="utf-8"))
    template = (ROOT / "docs/demo/mission.html").read_text(encoding="utf-8")
    data = json.dumps(catalog, ensure_ascii=False).replace("<", "\\u003c")
    output.write_text(template.replace("__ROOM_CATALOG__", data), encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    build(parser.parse_args().output)

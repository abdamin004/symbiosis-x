"""SX-18B: export five role-scoped backup frames from the golden replay.

Drives the sx01-golden run through the real API on a fresh SQLite file, one
beat at a time, and records what Crew and Ground each see at the five display
beats in scenarios/sx01-golden-v1.json. Frames hold operational fields only:
no run ID, no private health data, no wall-clock time. Values are rounded so
the file is stable across platforms. The backup player reads the saved file
with no service running.

    python scripts/export_golden_storyboard.py            # write the storyboard
    python scripts/export_golden_storyboard.py --check    # compare with a fresh replay
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "scenarios" / "sx01-golden-v1.json"
STORYBOARD = ROOT / "scenarios" / "expected" / "sx01-golden-storyboard.json"
STEPS_S = (0, 60, 360, 480, 600, 780)


def _quantity(quantity: dict | None, *, kind: str | None = None) -> dict | None:
    if quantity is None:
        return None
    frame = {"value": round(quantity["value"], 2), "unit": quantity["unit"],
             "observed_at_s": quantity["observed_at_s"]}
    if kind or quantity.get("kind"):
        frame["kind"] = kind or quantity["kind"]
    return frame


def _trace(records: list[dict]) -> list[dict]:
    keep = ("mission_s", "actor", "step", "result", "reason_code")
    return [{key: record.get(key) for key in keep} for record in records]


def _crew_frame(crew: dict, plan: dict) -> dict:
    standby = next(c for c in plan["candidates"] if c["candidate_id"] == "start_standby")
    return {
        "decision_rev": crew["decision_rev"],
        "co2": _quantity(crew["co2"], kind="modeled_estimate"),
        "standby": {key: standby.get(key) for key in ("result", "reason_code", "required_kw", "available_kw")},
        "trace": _trace(crew["trace"]),
    }


def _ground_frame(ground: dict) -> dict:
    packet = ground["packet"]
    return {
        "snapshot_id": packet["snapshot_id"],
        "decision_rev": packet["decision_rev"],
        "co2": _quantity(packet["co2"]),
        "power_headroom": _quantity(packet.get("power_headroom")),
        "delivery": packet["delivery"],
        "trace": _trace(ground["trace"]),
    }


def build_storyboard(workdir: Path) -> dict:
    """Run the golden replay on a fresh store in workdir and return the frames."""
    sys.path.insert(0, str(ROOT / "backend" / "src"))
    from fastapi.testclient import TestClient

    from symbiosis_x.main import create_app

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    beats = {beat["mission_s"]: beat for beat in manifest["display_beats"]}
    app = create_app(database_path=workdir / "storyboard.sqlite3", enable_local_demo=True,
                     golden_manifest_path=MANIFEST)
    frames = []
    with TestClient(app, base_url="http://127.0.0.1", client=("127.0.0.1", 60000)) as client:
        tokens = client.post("/api/v1/demo/session").json()

        def call(method: str, path: str, role: str, body: dict | None = None) -> dict:
            response = client.request(method, path, json=body, headers={"Authorization": "Bearer " + tokens[role]})
            response.raise_for_status()
            return response.json()

        run_id = call("POST", "/api/v1/runs", "facilitator", {
            "start_id": "storyboard", "scenario_id": manifest["scenario_id"],
            "scenario_version": manifest["scenario_version"], "seed": manifest["seed"]})["run_id"]
        url = f"/api/v1/runs/{run_id}"
        for step, mission_s in enumerate(STEPS_S):
            if step:
                call("POST", f"{url}/advance", "facilitator",
                     {"advance_id": f"storyboard-{mission_s}", "expected_step": step - 1})
            if mission_s not in beats:
                continue
            crew = call("GET", f"{url}/crew", "crew")
            ground = call("GET", f"{url}/ground", "ground")
            plan = call("POST", f"{url}/plans/evaluate", "crew")
            assert crew["mission_s"] == ground["mission_s"] == mission_s
            beat = beats[mission_s]
            frames.append({
                "beat_id": beat["beat_id"], "label": beat["label"], "mission_s": mission_s,
                "crew": _crew_frame(crew, plan), "ground": _ground_frame(ground),
            })

    return {
        "schema_version": 1,
        "storyboard_id": "sx01-golden-storyboard",
        "synthetic": True,
        "provenance": "synthetic_fixture",
        "generated_by": "scripts/export_golden_storyboard.py",
        "scenario_id": manifest["scenario_id"],
        "scenario_version": manifest["scenario_version"],
        "seed": manifest["seed"],
        "model_version": manifest["model_version"],
        "policy_version": manifest["policy_version"],
        "time_unit": "s",
        "clock": "mission",
        "note": "Saved role-scoped frames for the offline backup player. Crew and Ground each show only "
                "their own projection; no run ID or private health data is stored.",
        "frames": frames,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="fail if the saved frames differ from a fresh replay")
    args = parser.parse_args()
    with tempfile.TemporaryDirectory() as workdir:
        fresh = build_storyboard(Path(workdir))
    if args.check:
        saved = json.loads(STORYBOARD.read_text(encoding="utf-8"))
        if saved != fresh:
            print("Saved storyboard differs from a fresh golden replay.", file=sys.stderr)
            return 1
        print(f"{STORYBOARD.relative_to(ROOT)} matches a fresh replay ({len(fresh['frames'])} frames).")
        return 0
    STORYBOARD.write_text(json.dumps(fresh, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {len(fresh['frames'])} frames to {STORYBOARD.relative_to(ROOT)}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

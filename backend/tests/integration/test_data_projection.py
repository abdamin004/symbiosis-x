"""SX-12D: private metadata in an imported sample never leaves the import boundary.

A copy of the synthetic organizer-replay variant carries a private marker and
crew metadata on every incoming CO₂ sample. The run replays it through the
real API. Crew gets the authorized, normalized reading with its provenance;
Ground, Relay payloads, the operational journal and both role traces contain
neither the marker nor the private metadata.
"""

import json
import sqlite3
from contextlib import closing
from pathlib import Path

import pytest

import symbiosis_x.simulation.scenario as scenario
from test_runs import local_client

ROOT = Path(__file__).resolve().parents[3]
VARIANT = ROOT / "scenarios" / "variants" / "organizer-replay.json"
START = {"start_id": "import-privacy", "scenario_id": "organizer-replay", "scenario_version": "1", "seed": 4242}
MARKER = "PRIVATE-MARKER-sx12d-import"
PRIVATE_METADATA = {"wearer_crew_id": "SIM-01", "wearer_note": MARKER,
                    "device_serial": "PRIVATE-SERIAL-sx12d", "location_label": "PRIVATE-BUNK-sx12d"}


def test_imported_private_marker_stays_onboard(tmp_path, monkeypatch):
    manifest = json.loads(VARIANT.read_text(encoding="utf-8"))
    for sample in manifest["incoming_observations"]:
        sample.update(PRIVATE_METADATA)
    marked = tmp_path / "organizer-replay-marked.json"
    marked.write_text(json.dumps(manifest), encoding="utf-8")
    monkeypatch.setattr(scenario, "ORGANIZER_MANIFEST_PATH", marked)
    first = manifest["incoming_observations"][0]

    database = tmp_path / "import.sqlite3"
    with local_client(database) as client:
        tokens = client.post("/api/v1/demo/session").json()
        as_role = lambda who: {"Authorization": "Bearer " + tokens[who]}  # noqa: E731
        started = client.post("/api/v1/runs", json=START, headers=as_role("facilitator"))
        assert started.status_code == 200, started.text
        run_id = started.json()["run_id"]
        url = f"/api/v1/runs/{run_id}"

        shared = []
        for advance_id, step, target in (("to-01", 0, 60), ("to-06", 1, 360), ("to-13", 2, 780), ("to-15", 5, 900)):
            advanced = client.post(f"{url}/advance", headers=as_role("facilitator"), json={
                "advance_id": advance_id, "expected_step": step, "target_mission_s": target})
            assert advanced.status_code == 200, advanced.text
            crew = client.get(f"{url}/crew", headers=as_role("crew"))
            ground = client.get(f"{url}/ground", headers=as_role("ground"))
            shared += [(f"Ground at {target} s", ground.text), (f"Crew trace at {target} s", str(crew.json()["trace"]))]
            if target == 60:
                # Crew gets the authorized import: the normalized value and its source, nothing else.
                assert crew.json()["co2"]["value"] == pytest.approx(first["value"])
                assert crew.json()["co2"]["source_id"] == first["source_id"]
            if target == 360:
                # The imported 01:00 reading reached Ground through Relay, so the search covers it.
                assert ground.json()["packet"]["co2"]["value"] == pytest.approx(first["value"])

    with closing(sqlite3.connect(database)) as db:
        relay = " ".join(row[0] for row in db.execute(
            """SELECT payload_json FROM messages WHERE run_id = ?
               UNION ALL SELECT payload_json FROM snapshots WHERE run_id = ?""", (run_id, run_id)))
        journal = db.execute(
            """SELECT group_concat(event_id || ' ' || payload_json, ' ') FROM events
               WHERE run_id = ? AND visibility = 'operational'""", (run_id,)).fetchone()[0]
        stored = db.execute(
            """SELECT group_concat(source_id || ' ' || unit, ' ') FROM telemetry_observations
               WHERE run_id = ?""", (run_id,)).fetchone()[0]
        imported = db.execute(
            """SELECT payload_json FROM events WHERE run_id = ? AND event_type = 'observation.recorded'
               AND mission_s = 60""", (run_id,)).fetchone()[0]

    assert json.loads(imported)["payload"]["provenance"] == "synthetic_test_fixture"
    for label, text in [*shared, ("Relay payloads", relay), ("operational journal", journal),
                        ("shared telemetry", stored)]:
        for private in (MARKER, *PRIVATE_METADATA, *PRIVATE_METADATA.values()):
            assert private not in text, f"{private!r} leaked into {label}"

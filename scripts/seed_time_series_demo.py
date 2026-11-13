"""Initialize an isolated SQLite file with the synthetic time-series pilot."""

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend/src"))
from symbiosis_x.simulation.spacecraft.atmosphere import advance_co2_ppm
from symbiosis_x.storage.repository import Repository
from symbiosis_x.storage.sqlite import migrate
from symbiosis_x.telemetry.sampling import CabinCO2Sensor

RUN_ID = "demo-time-series-v1"
MODEL_VERSION = "cabin-1"


def read_json(path: str) -> dict:
    return json.loads((ROOT / path).read_text(encoding="utf-8"))


def seed(database: Path) -> bool:
    """Insert the dedicated run once, with its journal and projections in one write."""
    fixture = read_json("scenarios/variants/time-series-pilot-v1.json")
    cabin = fixture["cabin"]
    health = fixture["health"]
    sensor = CabinCO2Sensor(**read_json("catalogs/sx01/sensors.json")["sensors"][0])
    components = read_json("catalogs/sx01/components.json")["components"]
    volume = next(item["volume_m3"] for item in components if item["entity_id"] == sensor.entity_id)
    crew = read_json("catalogs/crew/synthetic-roster.json")["crew"]
    observations = []
    co2_ppm = cabin["initial_co2_ppm"]
    for time in range(0, cabin["end_s"] + 1, sensor.sample_period_s):
        if time:
            previous = time - sensor.sample_period_s
            removal = (
                cabin["degraded_removal_m3_h"] if previous >= cabin["fault_at_s"]
                else cabin["nominal_removal_m3_h"]
            )
            co2_ppm = advance_co2_ppm(
                co2_ppm, duration_s=sensor.sample_period_s, volume_m3=volume,
                generation_m3_h=cabin["generation_m3_h"], removal_m3_h=removal,
            )
        sample = sensor.sample(co2_ppm, run_id=RUN_ID, mission_s=time, model_version=MODEL_VERSION)
        observations.append((time, sample["event_id"], "operational", sample))
    for member in crew:
        crew_id = member["crew_id"]
        for time, value in zip(health["observation_times_s"], health["values_by_crew"][crew_id], strict=True):
            event_id = f'{health["source_id"]}:{crew_id}:{time}'
            observations.append((time, event_id, "crew", {
                "crew_id": crew_id, "source_id": health["source_id"], "metric": health["metric"],
                "observed_at_s": time, "received_at_s": time, "value": value, "unit": health["unit"],
                "context": health["context"], "quality": "valid",
            }))

    migrate(database)
    with Repository(database).write() as connection:
        existing = connection.execute(
            "SELECT scenario_id, scenario_version FROM runs WHERE run_id = ?", (RUN_ID,),
        ).fetchone()
        if existing is not None:
            if tuple(existing) != (fixture["scenario_id"], fixture["scenario_version"]):
                raise ValueError(f"Run {RUN_ID} is reserved for the synthetic time-series pilot")
            return False
        connection.execute(
            """INSERT INTO runs
               (run_id, scenario_id, scenario_version, seed, schema_version,
                model_version, policy_version, mission_s)
               VALUES (?, ?, ?, ?, 1, ?, 'demo-1', ?)""",
            (RUN_ID, fixture["scenario_id"], fixture["scenario_version"], fixture["seed"],
             MODEL_VERSION, cabin["end_s"]),
        )
        for sequence, (time, event_id, visibility, sample) in enumerate(sorted(observations), 1):
            event_type = "observation.recorded" if visibility == "operational" else "health.measurement.recorded"
            connection.execute(
                """INSERT INTO events
                   (run_id, event_seq, event_id, event_type, mission_s, visibility, payload_json)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (RUN_ID, sequence, event_id, event_type, time, visibility, json.dumps(sample)),
            )
            if visibility == "operational":
                payload = sample["payload"]
                connection.execute(
                    """INSERT INTO telemetry_observations
                       (run_id, event_id, entity_id, source_id, metric, observed_at_s,
                        received_at_s, value, unit, quality, model_version)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (RUN_ID, event_id, sample["entity_id"], sample["source_id"], payload["metric"],
                     sample["observed_at_s"], sample["received_at_s"], payload["value"],
                     payload["unit"], payload["quality"], sample["model_version"]),
                )
            else:
                connection.execute(
                    """INSERT INTO health_observations
                       (run_id, event_id, crew_id, source_id, metric, observed_at_s,
                        received_at_s, numeric_value, unit, context_json, quality)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (RUN_ID, event_id, sample["crew_id"], sample["source_id"], sample["metric"],
                     sample["observed_at_s"], sample["received_at_s"], sample["value"],
                     sample["unit"], json.dumps(sample["context"]), sample["quality"]),
                )
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("database", type=Path, help="Path to the demo SQLite file")
    args = parser.parse_args()
    created = seed(args.database)
    print(f"{'Initialized' if created else 'Already initialized'} {RUN_ID} in {args.database}")


if __name__ == "__main__":
    main()

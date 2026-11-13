"""Write and read the private synthetic device stream on the run clock."""

import json
from dataclasses import asdict, dataclass

from symbiosis_x.crew.wearable_series import (
    EVENT_TYPE, WearableObservation, WearableReading, load_wearable_fixture,
    wearable_deliveries, wearable_reading_at,
)

WEARABLE_SCENARIO = ("crew-wearables", "1")
WEARABLE_STEPS_S = (0, 20, 50, 60, 70, 71, 72, 90, 100, 120)
FIXTURE_CREW_ID = "SIM-02"


def record_wearables(db, run_id: str, through_s: int, after_s: int = -1) -> None:
    fixture = load_wearable_fixture()
    for sample in wearable_deliveries(
        fixture, run_id=run_id, crew_id=FIXTURE_CREW_ID, through_s=through_s, after_s=after_s,
    ):
        event = db.execute(
            """INSERT INTO events
               (run_id, event_seq, event_id, event_type, mission_s, visibility, payload_json)
               SELECT ?, COALESCE(MAX(event_seq), 0) + 1, ?, ?, ?, 'crew', ?
               FROM events WHERE run_id = ?
               ON CONFLICT(run_id, event_id) DO NOTHING""",
            (run_id, sample.event_id, EVENT_TYPE, sample.received_at_s, json.dumps(asdict(sample)), run_id),
        )
        if not event.rowcount:
            continue
        db.execute(
            """INSERT INTO health_observations
               (run_id, event_id, crew_id, source_id, metric, observed_at_s, received_at_s,
                numeric_value, unit, context_json, quality)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (run_id, sample.event_id, sample.crew_id, sample.source_id, sample.metric,
             sample.observed_at_s, sample.received_at_s, sample.value,
             sample.unit if sample.value is not None else None, json.dumps(sample.context), sample.quality),
        )


@dataclass(frozen=True)
class WearableChannel:
    source_id: str
    metric: str
    unit: str
    reading: WearableReading
    history: list[WearableObservation]


@dataclass(frozen=True)
class CrewWearables:
    run_id: str
    crew_id: str
    mission_s: int
    channels: dict[str, WearableChannel]


def read_wearables(db, run_id: str, crew_id: str, mission_s: int) -> CrewWearables:
    fixture = load_wearable_fixture()
    rows = db.execute(
        """SELECT e.payload_json FROM health_observations h
           JOIN events e ON e.run_id = h.run_id AND e.event_id = h.event_id
           WHERE h.run_id = ? AND h.crew_id = ? AND h.received_at_s <= ?
             AND e.event_type = ? AND e.visibility = 'crew'
           ORDER BY h.observed_at_s, h.received_at_s, h.event_id""",
        (run_id, crew_id, mission_s, EVENT_TYPE),
    )
    observations = [WearableObservation(**json.loads(row["payload_json"])) for row in rows]
    channels = {}
    for name, channel in fixture["channels"].items():
        history = [sample for sample in observations
                   if (sample.source_id, sample.metric) == (channel["source_id"], channel["metric"])]
        reading = wearable_reading_at(
            history, run_id=run_id, crew_id=crew_id, source_id=channel["source_id"],
            metric=channel["metric"], mission_s=mission_s, max_age_s=fixture["freshness_s"],
        )
        channels[name] = WearableChannel(**channel, reading=reading, history=history)
    return CrewWearables(run_id, crew_id, mission_s, channels)

"""SX-24D: persist typed synthetic Crew observations on the private journal lane."""

import json
from dataclasses import asdict
from hashlib import sha256
from sqlite3 import Connection
from typing import Literal

from pydantic import Field

from symbiosis_x.application.checkins import _synthetic_roster_ids
from symbiosis_x.application.runs import RunConflict, RunNotFound, load_active_run, next_event_seq
from symbiosis_x.contracts.events import Contract, Identifier
from symbiosis_x.contracts.health import HealthMeasurement
from symbiosis_x.crew.assessment import assess
from symbiosis_x.crew.profile import AstronautHealthProfile
from symbiosis_x.simulation.scenario import (
    HEALTH_STORY_MEASUREMENT_PREFIX, HEALTH_STORY_SCENARIO, load_health_story_manifest,
)
from symbiosis_x.storage.repository import Repository


class MeasurementNotFound(Exception):
    pass


class MeasurementConflict(Exception):
    pass


class MeasurementRejected(Exception):
    pass


class SaveMeasurementRequest(Contract):
    measurement_id: Identifier
    crew_id: Identifier
    synthetic: Literal[True]
    measurement: HealthMeasurement
    context: dict[str, str] = Field(default_factory=dict)


class MeasurementReceipt(Contract):
    measurement_id: Identifier
    run_id: Identifier
    crew_id: Identifier
    synthetic: Literal[True]
    measurement: HealthMeasurement
    context: dict[str, str]
    received_at_s: int


def _digest(command: SaveMeasurementRequest) -> str:
    return sha256(command.model_dump_json().encode("utf-8")).hexdigest()


def _stored_fields(command: SaveMeasurementRequest) -> tuple[float | None, str | None, str | None]:
    """Map valid scalar and structured readings into the existing health series."""
    measurement = command.measurement
    if measurement.quality == "unavailable":
        return None, None, None
    if hasattr(measurement, "value"):
        return float(measurement.value), measurement.unit, None
    return None, None, json.dumps(measurement.model_dump(mode="json"), sort_keys=True)


def save_measurement(
    repository: Repository, run_id: str, command: SaveMeasurementRequest,
) -> MeasurementReceipt:
    with repository.write() as db:
        if command.measurement_id.startswith(HEALTH_STORY_MEASUREMENT_PREFIX):
            run = db.execute(
                "SELECT scenario_id, scenario_version FROM runs WHERE run_id = ?", (run_id,),
            ).fetchone()
            if run is not None and tuple(run) == HEALTH_STORY_SCENARIO:
                raise MeasurementConflict("SCRIPTED_MEASUREMENT_ID_RESERVED")
        return record_measurement(db, run_id, command)


def record_measurement(
    db: Connection, run_id: str, command: SaveMeasurementRequest, *, received_at_s: int | None = None,
) -> MeasurementReceipt:
    """Write both private records inside the caller's transaction.

    A scenario crossing a sample's receipt time can preserve that timestamp.
    Manual submissions use the current run time.
    """
    if command.crew_id not in _synthetic_roster_ids():
        raise MeasurementRejected("CREW_NOT_ON_ROSTER")
    if command.measurement.quality not in {"valid", "suspect", "unavailable"}:
        raise MeasurementRejected("INVALID_READING_QUALITY")

    digest = _digest(command)
    row = db.execute(
        "SELECT event_type, payload_json FROM events WHERE run_id = ? AND event_id = ?",
        (run_id, command.measurement_id),
    ).fetchone()
    if row is not None:
        if row["event_type"] != "crew.health_measurement":
            raise MeasurementConflict("MEASUREMENT_ID_REUSED")
        stored = json.loads(row["payload_json"])
        if stored["request_digest"] != digest:
            raise MeasurementConflict("MEASUREMENT_ID_REUSED")
        return MeasurementReceipt.model_validate(stored["receipt"])

    try:
        run = load_active_run(db, run_id)
    except RunNotFound as error:
        raise MeasurementNotFound(str(error)) from error
    except RunConflict as error:
        raise MeasurementConflict(str(error)) from error

    if received_at_s is None:
        received_at_s = run["mission_s"]
    if not command.measurement.observed_at_s <= received_at_s <= run["mission_s"]:
        raise MeasurementRejected("FUTURE_READING_NOT_ACCEPTED")
    receipt = MeasurementReceipt(
        measurement_id=command.measurement_id,
        run_id=run_id, crew_id=command.crew_id,
        synthetic=True, measurement=command.measurement,
        context=command.context, received_at_s=received_at_s,
    )
    event_payload = json.dumps(
        {"request_digest": digest, "receipt": receipt.model_dump(mode="json")},
        separators=(",", ":"), sort_keys=True,
    )
    db.execute(
        """INSERT INTO events
           (run_id, event_seq, event_id, event_type, mission_s, visibility, payload_json)
           VALUES (?, ?, ?, 'crew.health_measurement', ?, 'crew', ?)""",
        (run_id, next_event_seq(db, run_id), command.measurement_id,
         received_at_s, event_payload),
    )
    value, unit, structured = _stored_fields(command)
    db.execute(
        """INSERT INTO health_observations
           (run_id, event_id, crew_id, source_id, metric, observed_at_s,
            received_at_s, numeric_value, unit, structured_value_json, context_json, quality)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            run_id, command.measurement_id, command.crew_id,
            command.measurement.source_id, command.measurement.metric,
            command.measurement.observed_at_s, received_at_s,
            value, unit, structured,
            json.dumps(command.context, sort_keys=True), command.measurement.quality,
        ),
    )
    return receipt


def record_health_story_readings(db: Connection, run_id: str, after_s: int, through_s: int) -> None:
    fixture = load_health_story_manifest()
    for row in fixture["readings"]:
        received = row["received_at_s"]
        if after_s < received <= through_s:
            command = SaveMeasurementRequest(
                measurement_id=row["measurement_id"], crew_id=fixture["subject_crew_id"],
                synthetic=True, context=fixture["reading_context"],
                measurement={
                    **fixture["reading_template"], "observed_at_s": row["observed_at_s"], "value": row["value"],
                },
            )
            record_measurement(db, run_id, command, received_at_s=received)


def read_measurement(
    repository: Repository, run_id: str, measurement_id: str,
) -> MeasurementReceipt:
    with repository.read() as db:
        row = db.execute(
            """SELECT payload_json FROM events
               WHERE run_id = ? AND event_id = ?
                 AND event_type = 'crew.health_measurement' AND visibility = 'crew'""",
            (run_id, measurement_id),
        ).fetchone()
    if row is None:
        raise MeasurementNotFound("MEASUREMENT_NOT_FOUND")
    return MeasurementReceipt.model_validate(json.loads(row["payload_json"])["receipt"])


def latest_crew_assessment(db, run_id: str, profile: AstronautHealthProfile) -> dict | None:
    """Assess the selected astronaut’s latest accepted private reading."""
    row = db.execute(
        """SELECT e.payload_json FROM events e
           JOIN health_observations h ON h.run_id = e.run_id AND h.event_id = e.event_id
           WHERE e.run_id = ? AND h.crew_id = ? AND e.visibility = 'crew'
             AND e.event_type = 'crew.health_measurement'
           ORDER BY h.observed_at_s DESC, h.received_at_s DESC, h.event_id DESC LIMIT 1""",
        (run_id, profile.crew_id),
    ).fetchone()
    if row is None:
        return None
    receipt = json.loads(row["payload_json"])["receipt"]
    return asdict(assess(receipt["measurement"], context=receipt["context"], profile=profile))

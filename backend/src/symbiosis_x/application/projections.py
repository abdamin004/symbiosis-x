"""Read role projections without moving the simulation clock."""

import json
from dataclasses import asdict
from sqlite3 import Connection, Row

from symbiosis_x.application.runs import RunNotFound
from symbiosis_x.crew.profile import profile_for_crew
from symbiosis_x.crew.followup import compute_followup
from symbiosis_x.crew.measurements import latest_crew_assessment
from symbiosis_x.crew.trends import TrendSample, evaluate_trend
from symbiosis_x.contracts.projections import (
    AcceptedCO2, CurrentCrewView, CurrentGroundView, DeliveredTelemetry, Delivery, GroundPacket,
    TraceRecord,
)
from symbiosis_x.workflows.relay import ground_case_statuses
from symbiosis_x.application.exercise_schedule import EXERCISE_RELAY_PREFIX, EXERCISE_SCENARIO, load_exercise_fixture
from symbiosis_x.crew.wearable_series import load_wearable_fixture
from symbiosis_x.application.wearables import FIXTURE_CREW_ID
from symbiosis_x.workflows.monitor import read_wearable_recheck

# Operational journal events that may appear in a role trace, and who recorded them.
# Everything else (crew-visibility events, observations, run control) never enters a trace.
TRACE_EVENTS = {
    "incident.opened": "monitor",
    "incident.fault_linked": "monitor",
    "ground.advisory_issued": "ground",
    "crew.advisory_received": "relay",
}


def read_run(db: Connection, run_id: str) -> Row:
    run = db.execute(
        """SELECT run_id, scenario_id, scenario_version, mission_s, decision_rev, status
           FROM runs WHERE run_id = ?""",
        (run_id,),
    ).fetchone()
    if run is None:
        raise RunNotFound("RUN_NOT_FOUND")
    return run


def latest_crew_trend(db: Connection, run_id: str, crew_id: str) -> dict | None:
    """Describe the comparable trend of the crew member's latest scalar metric (Crew-only)."""
    latest = db.execute(
        """SELECT h.metric FROM health_observations h
           JOIN events e ON e.run_id = h.run_id AND e.event_id = h.event_id
           WHERE h.run_id = ? AND h.crew_id = ? AND e.event_type = 'crew.health_measurement'
           ORDER BY h.observed_at_s DESC, h.received_at_s DESC, h.event_id DESC LIMIT 1""",
        (run_id, crew_id),
    ).fetchone()
    if latest is None:
        return None
    rows = db.execute(
        """SELECT h.event_id, h.metric, h.numeric_value, h.unit, h.observed_at_s, h.quality,
                  h.source_id, h.context_json
           FROM health_observations h
           JOIN events e ON e.run_id = h.run_id AND e.event_id = h.event_id
           WHERE h.run_id = ? AND h.crew_id = ? AND h.metric = ? AND h.unit IS NOT NULL
             AND e.event_type = 'crew.health_measurement'""",
        (run_id, crew_id, latest["metric"]),
    ).fetchall()
    if not rows:
        return None  # Structured metrics (for example blood pressure) have no scalar trend here.
    samples = [
        TrendSample(
            sample_id=row["event_id"], crew_id=crew_id, metric=row["metric"], value=row["numeric_value"],
            unit=row["unit"], observed_at_s=row["observed_at_s"], quality=row["quality"],
            source_id=row["source_id"], context=json.loads(row["context_json"]),
        )
        for row in rows
    ]
    return asdict(evaluate_trend(samples))


def read_crew(db: Connection, run_id: str, crew_id: str = "SIM-01") -> CurrentCrewView:
    run = read_run(db, run_id)
    profile = profile_for_crew(crew_id)
    if profile is None:
        raise LookupError("CREW_NOT_ON_ROSTER")
    co2 = db.execute(
        """SELECT value, unit, observed_at_s, source_id, event_id
           FROM telemetry_observations
           WHERE run_id = ? AND entity_id = 'cabin-01' AND metric = 'co2'
             AND unit = 'ppm' AND quality = 'valid' AND received_at_s <= ?
           ORDER BY observed_at_s DESC, received_at_s DESC, event_id DESC LIMIT 1""",
        (run_id, run["mission_s"]),
    ).fetchone()
    assessment = latest_crew_assessment(db, run_id, profile)
    return CurrentCrewView(
        **dict(run),
        co2=AcceptedCO2(**dict(co2)) if co2 else None,
        health_profile=profile,
        health_assessment=assessment,
        health_followup=compute_followup(db, run_id, crew_id, run["mission_s"], assessment),
        health_trend=latest_crew_trend(db, run_id, crew_id),
        trace=read_trace(db, run_id, run["mission_s"]),
    )


def _trace_record(event_type: str, mission_s: int, payload: dict, owners: dict[str, str]) -> TraceRecord:
    """Copy only allowlisted fields; raw tool input, evidence and basis details stay out."""
    if event_type == "incident.opened":
        owners[payload["incident_id"]] = payload["next_owner"]
        return TraceRecord(case_id=payload["incident_id"], mission_s=mission_s, actor="monitor",
                           step="incident_opened", result=payload["plan_status"],
                           next_owner=payload["next_owner"])
    if event_type == "incident.fault_linked":
        return TraceRecord(case_id=payload["incident_id"], mission_s=mission_s, actor="monitor",
                           step="fault_linked", result="linked",
                           next_owner=owners.get(payload["incident_id"]))
    case_id = f"advice-{payload['operation_id']}"
    if event_type == "ground.advisory_issued":
        return TraceRecord(case_id=case_id, mission_s=mission_s, actor="ground",
                           step="advice_queued", result=payload["status"], next_owner="crew")
    return TraceRecord(case_id=case_id, mission_s=mission_s, actor="relay", step="advice_received",
                       result=payload["disposition"], reason_code=payload["reason_code"],
                       next_owner="crew")


def read_trace(db: Connection, run_id: str, mission_s: int, *, onboard_until_s: int | None = None) -> list[TraceRecord]:
    """Return the run's operational trace up to mission_s, in journal order.

    Crew reads every operational milestone recorded so far. Ground passes
    ``onboard_until_s``, the observation time of the newest packet it has
    received: onboard milestones after that have not reached Ground yet and
    are left out, while Ground's own advice is visible from when it was issued.
    """
    rows = db.execute(
        f"""SELECT event_type, mission_s, payload_json FROM events
            WHERE run_id = ? AND visibility = 'operational' AND mission_s <= ?
              AND event_type IN ({", ".join("?" * len(TRACE_EVENTS))})
            ORDER BY event_seq""",
        (run_id, mission_s, *TRACE_EVENTS),
    ).fetchall()
    owners: dict[str, str] = {}
    trace = []
    for row in rows:
        record = _trace_record(row["event_type"], row["mission_s"], json.loads(row["payload_json"]), owners)
        onboard = TRACE_EVENTS[row["event_type"]] != "ground"
        if onboard and onboard_until_s is not None and row["mission_s"] > onboard_until_s:
            continue
        trace.append(record)
    return trace


def read_ground(db: Connection, run_id: str) -> CurrentGroundView:
    run = read_run(db, run_id)
    snapshot = db.execute(
        """SELECT s.snapshot_id, s.decision_rev, s.observed_at_s, s.payload_json, m.delivered_at_s
           FROM messages m JOIN snapshots s
                ON s.run_id = m.run_id AND s.snapshot_id = m.ground_snapshot_id
                AND s.audience = 'ground'
           WHERE m.run_id = ? AND m.direction = 'to_ground' AND m.delivered_at_s <= ?
             AND s.observed_at_s <= m.delivered_at_s
           ORDER BY s.observed_at_s DESC, s.decision_rev DESC, m.delivered_at_s DESC, m.message_id DESC
           LIMIT 1""",
        (run_id, run["mission_s"]),
    ).fetchone()
    packet = None
    if snapshot is not None:
        stored = GroundPacket.model_validate_json(snapshot["payload_json"])
        packet = DeliveredTelemetry(
            snapshot_id=snapshot["snapshot_id"],
            decision_rev=snapshot["decision_rev"],
            delivery=Delivery(
                observed_at_s=snapshot["observed_at_s"],
                received_at_s=snapshot["delivered_at_s"],
                age_s=run["mission_s"] - snapshot["observed_at_s"],
                link_status="delayed",
            ),
            co2=stored.co2,
            power_headroom=stored.power_headroom,
        )
    # Before the first delivery Ground has no onboard milestones at all.
    onboard_until_s = snapshot["observed_at_s"] if snapshot is not None else -1
    return CurrentGroundView(
        run_id=run["run_id"], scenario_id=run["scenario_id"],
        scenario_version=run["scenario_version"], mission_s=run["mission_s"], status=run["status"],
        packet=packet,
        trace=read_trace(db, run_id, run["mission_s"], onboard_until_s=onboard_until_s),
        health_cases=ground_case_statuses(db, run_id, run["mission_s"]),
    )



def read_wearable_debrief(db: Connection, run_id: str) -> dict:
    """Read the private timeline and the actual receipt of the final operational packet."""
    run = read_run(db, run_id)
    if (run["scenario_id"], run["scenario_version"]) != EXERCISE_SCENARIO:
        raise LookupError("DEBRIEF_NOT_FOUND")
    mission_s = run["mission_s"]
    task = read_wearable_recheck(db, run_id, FIXTURE_CREW_ID, mission_s, load_wearable_fixture())
    events = {}
    for row in db.execute(
        """SELECT event_type, mission_s, payload_json FROM events
           WHERE run_id = ? AND mission_s <= ? AND event_type IN (
               'crew.exercise_deferred', 'exercise.outcome_recorded')
           ORDER BY event_seq""",
        (run_id, mission_s),
    ):
        events[row["event_type"]] = (row["mission_s"], json.loads(row["payload_json"]))
    outcome_s = load_exercise_fixture()["outcome_at_s"]
    delivery = db.execute(
        """SELECT s.decision_rev, s.observed_at_s, m.deliver_at_s, m.delivered_at_s
           FROM messages m JOIN snapshots s ON s.run_id = m.run_id AND s.snapshot_id = m.ground_snapshot_id
           WHERE m.run_id = ? AND m.ground_snapshot_id = ? AND m.issued_at_s <= ?""",
        (run_id, f"{EXERCISE_RELAY_PREFIX}{outcome_s}", mission_s),
    ).fetchone()
    report = dict(delivery) if delivery is not None else None
    return {
        "run_id":run_id, "mission_s":mission_s, "synthetic":True,
        "recheck":task.model_dump() if task else None,
        "time_to_verified_s":task.completed_at_s-task.opened_at_s if task and task.completed_at_s is not None else None,
        "decision_at_s":events.get("crew.exercise_deferred", (None,))[0],
        "outcome":events.get("exercise.outcome_recorded", (None, None))[1],
        "ground_report":report,
        "ground_delivery_lag_s":report["delivered_at_s"]-report["observed_at_s"]
        if report and report["delivered_at_s"] is not None else None,
    }

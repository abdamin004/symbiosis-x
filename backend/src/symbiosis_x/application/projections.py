"""Read role projections without moving the simulation clock."""

import json
from sqlite3 import Connection, Row

from symbiosis_x.application.runs import RunNotFound
from symbiosis_x.crew.profile import load_profile
from symbiosis_x.crew.measurements import latest_crew_assessment
from symbiosis_x.contracts.projections import (
    AcceptedCO2, CurrentCrewView, CurrentGroundView, DeliveredTelemetry, Delivery, GroundPacket,
    TraceRecord,
)
from symbiosis_x.workflows.relay import ground_case_statuses

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
        """SELECT run_id, scenario_id, scenario_version, mission_s, decision_rev
           FROM runs WHERE run_id = ?""",
        (run_id,),
    ).fetchone()
    if run is None:
        raise RunNotFound("RUN_NOT_FOUND")
    return run


def read_crew(db: Connection, run_id: str) -> CurrentCrewView:
    run = read_run(db, run_id)
    co2 = db.execute(
        """SELECT value, unit, observed_at_s, source_id, event_id
           FROM telemetry_observations
           WHERE run_id = ? AND entity_id = 'cabin-01' AND metric = 'co2'
             AND unit = 'ppm' AND quality = 'valid' AND received_at_s <= ?
           ORDER BY observed_at_s DESC, received_at_s DESC, event_id DESC LIMIT 1""",
        (run_id, run["mission_s"]),
    ).fetchone()
    return CurrentCrewView(
        **dict(run),
        co2=AcceptedCO2(**dict(co2)) if co2 else None,
        health_profile=load_profile(),
        health_assessment=latest_crew_assessment(db, run_id),
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
        scenario_version=run["scenario_version"], mission_s=run["mission_s"], packet=packet,
        trace=read_trace(db, run_id, run["mission_s"], onboard_until_s=onboard_until_s),
        health_cases=ground_case_statuses(db, run_id, run["mission_s"]),
    )

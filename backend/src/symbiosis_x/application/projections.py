"""Read role projections without moving the simulation clock."""

from sqlite3 import Connection, Row

from symbiosis_x.application.runs import RunNotFound
from symbiosis_x.contracts.projections import (
    AcceptedCO2, CurrentCrewView, CurrentGroundView, DeliveredTelemetry, Delivery, GroundPacket,
)


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
    return CurrentCrewView(**dict(run), co2=AcceptedCO2(**dict(co2)) if co2 else None)


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
    return CurrentGroundView(
        run_id=run["run_id"], scenario_id=run["scenario_id"],
        scenario_version=run["scenario_version"], mission_s=run["mission_s"], packet=packet,
    )

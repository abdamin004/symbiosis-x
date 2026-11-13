"""Read role projections without moving the simulation clock."""

from sqlite3 import Connection, Row

from symbiosis_x.application.runs import RunNotFound
from symbiosis_x.contracts.projections import AcceptedCO2, CurrentCrewView


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

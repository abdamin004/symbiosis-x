"""Planner wrapper: evaluate the three options from a run's accepted evidence.

The wrapper only reads the journal. It gathers accepted cabin CO₂, the latest
scrubber and power faults and the run's decision revision, and passes them to
the SX-06 constraint evaluator. Evidence the run has not recorded stays None,
so the evaluator reports it as unknown rather than assuming a value. The
result is advisory; nothing here writes plant state.
"""

import json
from sqlite3 import Connection

from symbiosis_x.application.nominal import CABIN_VOLUME_M3, GENERATION_M3_H, NOMINAL_REMOVAL_M3_H
from symbiosis_x.twin.constraints import PlanEvaluation, PlanInputs, evaluate_candidates


def _latest_fault(db: Connection, run_id: str, event_type: str, mission_s: int) -> dict | None:
    row = db.execute(
        """SELECT payload_json FROM events
           WHERE run_id = ? AND event_type = ? AND mission_s <= ?
           ORDER BY mission_s DESC, event_seq DESC LIMIT 1""",
        (run_id, event_type, mission_s),
    ).fetchone()
    return json.loads(row["payload_json"]) if row else None


def plan_inputs_for_run(db: Connection, run_id: str) -> PlanInputs:
    run = db.execute("SELECT mission_s, decision_rev FROM runs WHERE run_id = ?", (run_id,)).fetchone()
    if run is None:
        raise LookupError("RUN_NOT_FOUND")
    mission_s = run["mission_s"]
    co2 = db.execute(
        """SELECT value FROM telemetry_observations
           WHERE run_id = ? AND entity_id = 'cabin-01' AND metric = 'co2' AND unit = 'ppm'
             AND quality = 'valid' AND received_at_s <= ?
           ORDER BY observed_at_s DESC, received_at_s DESC, event_id DESC LIMIT 1""",
        (run_id, mission_s),
    ).fetchone()
    scrubber = _latest_fault(db, run_id, "fault.scrubber_degraded", mission_s)
    power = _latest_fault(db, run_id, "fault.power_drop", mission_s)
    return PlanInputs(
        basis_snapshot_id=f"crew-v{run['decision_rev']}",
        decision_rev=run["decision_rev"],
        co2_ppm=co2["value"] if co2 else None,
        volume_m3=CABIN_VOLUME_M3,
        generation_m3_h=GENERATION_M3_H,
        removal_m3_h=scrubber["removal_m3_h"] if scrubber else NOMINAL_REMOVAL_M3_H,
        power_headroom_kw=power.get("power_headroom_kw") if power else None,
        feeder_connected=power.get("feeder_connected") if power else None,
        standby_removal_m3_h=None,
        activity_change_permitted=None,
        reduced_generation_m3_h=None,
    )


def evaluate_run(db: Connection, run_id: str) -> PlanEvaluation:
    return evaluate_candidates(plan_inputs_for_run(db, run_id))

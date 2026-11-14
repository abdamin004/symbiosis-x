"""Persist the authored exercise choice and compare modeled and observed cabin outcomes."""

import json
from dataclasses import asdict
from pathlib import Path

from symbiosis_x.contracts.projections import GroundCO2, GroundPacket, PowerHeadroom
from symbiosis_x.workflows.relay import queue_ground_snapshot
from symbiosis_x.simulation.spacecraft.atmosphere import advance_co2_ppm
from symbiosis_x.twin.constraints import evaluate_exercise_options

EXERCISE_SCENARIO = ("exercise-power-preview", "1")
FIXTURE_PATH = Path(__file__).resolve().parents[4] / "scenarios/variants/exercise-power-preview-v1.json"
DEFERRED = "crew.exercise_deferred"
EXERCISE_RELAY_PREFIX = "exercise-operational-"


def load_exercise_fixture() -> dict:
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def _event(db, run_id, event_type):
    return db.execute(
        """SELECT payload_json FROM events
           WHERE run_id = ? AND event_type = ? ORDER BY event_seq LIMIT 1""",
        (run_id, event_type),
    ).fetchone()


def _append(db, run_id, mission_s, event_type, payload):
    db.execute(
        """INSERT INTO events (run_id, event_seq, event_id, event_type, mission_s, visibility, payload_json)
           SELECT ?, COALESCE(MAX(event_seq), 0) + 1, ?, ?, ?, 'operational', ?
           FROM events WHERE run_id = ?""",
        (run_id, event_type, event_type, mission_s, json.dumps(payload, sort_keys=True), run_id),
    )


def _co2_between(fixture, initial, seconds, exercising):
    generation = fixture["exercise_generation_m3_h" if exercising else "rest_generation_m3_h"]
    return advance_co2_ppm(
        initial, duration_s=seconds, volume_m3=fixture["cabin_volume_m3"],
        generation_m3_h=generation, removal_m3_h=fixture["removal_m3_h"],
    )


def _observed_co2(fixture, mission_s, decision):
    start = fixture["exercise_at_s"]
    elapsed = mission_s-start
    kept_for = elapsed if decision is None else decision["decided_at_s"]-start
    before = _co2_between(fixture, fixture["co2_at_exercise_ppm"], kept_for, True)
    return _co2_between(fixture, before, elapsed-kept_for, False)


def record_exercise_checkpoint(db, run_id, mission_s, previous_s):
    fixture = load_exercise_fixture()
    if mission_s >= fixture["exercise_at_s"] > previous_s:
        _append(db, run_id, mission_s, "exercise.window_opened", {"exercise_load_kw":fixture["exercise_load_kw"]})
        db.execute("UPDATE runs SET decision_rev = decision_rev + 1 WHERE run_id = ?", (run_id,))
    if mission_s == fixture["power_drop_at_s"]:
        _append(db, run_id, mission_s, "exercise.power_reduced", {"headroom_kw":fixture["reduced_headroom_kw"]})
        db.execute("UPDATE runs SET decision_rev = decision_rev + 1 WHERE run_id = ?", (run_id,))
    if mission_s in (fixture["exercise_at_s"], fixture["outcome_at_s"]):
        row = _event(db, run_id, DEFERRED)
        decision = json.loads(row["payload_json"]) if row else None
        before_drop = mission_s < fixture["power_drop_at_s"]
        power = fixture["initial_headroom_kw" if before_drop else "reduced_headroom_kw"]
        outcome = {
            "observed_at_s": mission_s,
            "co2_ppm": _observed_co2(fixture, mission_s, decision),
            "headroom_kw": round(power - (0 if decision else fixture["exercise_load_kw"]), 3),
        }
        if mission_s == fixture["outcome_at_s"]:
            _append(db, run_id, mission_s, "exercise.outcome_recorded", outcome)
            db.execute("UPDATE runs SET decision_rev = decision_rev + 1 WHERE run_id = ?", (run_id,))
        revision = db.execute("SELECT decision_rev FROM runs WHERE run_id = ?", (run_id,)).fetchone()[0]
        queue_ground_snapshot(
            db, run_id, snapshot_id=f"{EXERCISE_RELAY_PREFIX}{mission_s}", decision_rev=revision,
            observed_at_s=mission_s, issued_at_s=mission_s, deliver_at_s=mission_s+fixture["relay_delay_s"],
            packet=GroundPacket(
                co2=GroundCO2(value=outcome["co2_ppm"], unit="ppm", observed_at_s=mission_s,
                              kind="delivered_observation"),
                power_headroom=PowerHeadroom(value=max(0,outcome["headroom_kw"]), unit="kW", observed_at_s=mission_s),
            ),
        )


def read_exercise_preview(db, run_id: str) -> dict:
    run = db.execute(
        "SELECT scenario_id, scenario_version, decision_rev, mission_s, status FROM runs WHERE run_id = ?", (run_id,),
    ).fetchone()
    if run is None or (run["scenario_id"], run["scenario_version"]) != EXERCISE_SCENARIO:
        raise LookupError("EXERCISE_NOT_FOUND")
    fixture = load_exercise_fixture()
    mission_s = run["mission_s"]
    duration = max(0, fixture["outcome_at_s"]-mission_s)
    power_row = _event(db, run_id, "exercise.power_reduced")
    decision_row = _event(db, run_id, DEFERRED)
    outcome_row = _event(db, run_id, "exercise.outcome_recorded")
    decision = json.loads(decision_row["payload_json"]) if decision_row else None
    headroom = json.loads(power_row["payload_json"])["headroom_kw"] if power_row else fixture["initial_headroom_kw"]
    options = ()
    if fixture["exercise_at_s"] <= mission_s < fixture["outcome_at_s"] and decision is None:
        options = evaluate_exercise_options(
            fixture, co2_ppm=_observed_co2(fixture, mission_s, None),
            duration_s=duration, headroom_kw=headroom,
        )
    return {
        "run_id":run_id, "mission_s":mission_s, "decision_rev":run["decision_rev"],
        "basis_snapshot_id":f"crew-v{run['decision_rev']}", "synthetic":True,
        "status":("deferred" if decision else "complete" if outcome_row else "scheduled"),
        "can_commit":bool(options) and run["status"] == "active",
        "horizon_s":duration, "outcome_at_s":fixture["outcome_at_s"],
        "co2_limit_ppm":fixture["co2_limit_ppm"], "minimum_headroom_kw":fixture["minimum_headroom_kw"],
        "options":[asdict(option) for option in options],
        "decision":decision, "outcome":json.loads(outcome_row["payload_json"]) if outcome_row else None,
    }


def record_deferral(db, run_id, mission_s, operation_id, option):
    _append(db, run_id, mission_s, DEFERRED, {
        "operation_id":operation_id, "decided_at_s":mission_s,
        "projected_co2_ppm":option["projected_co2_ppm"], "headroom_kw":option["headroom_kw"],
        "exercise_load_kw":0,
    })

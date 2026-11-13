"""SX-22E: compose golden faults, accepted samples, delivery and advice in one run writer."""

from json import dumps
from sqlite3 import Connection

from symbiosis_x.application.nominal import (
    CABIN_VOLUME_M3, GENERATION_M3_H, INITIAL_CO2_PPM,
    NOMINAL_REMOVAL_M3_H, SENSOR, MODEL_VERSION,
)
from symbiosis_x.contracts.commands import GroundAdvisoryRequest
from symbiosis_x.contracts.projections import GroundCO2, GroundPacket, PowerHeadroom
from symbiosis_x.simulation.scenario import GOLDEN_STEPS_S
from symbiosis_x.telemetry.adapters import normalize_incoming_co2
from symbiosis_x.simulation.spacecraft.atmosphere import advance_co2_ppm
from symbiosis_x.workflows.monitor import handle_fault
from symbiosis_x.workflows.relay import (
    deliver_due, queue_ground_advisory, queue_ground_snapshot, receive_due_advisories,
)

GOLDEN_OBSERVED_CO2_PPM = 2000.0
GOLDEN_HEADROOM_INITIAL_KW = 0.60
GOLDEN_HEADROOM_DEGRADED_KW = 0.20


def _packet(*, snapshot_s: int, power_kw: float, power_s: int, co2_ppm: float = GOLDEN_OBSERVED_CO2_PPM) -> GroundPacket:
    return GroundPacket(
        co2=GroundCO2(
            value=co2_ppm, unit="ppm",
            observed_at_s=snapshot_s, kind="delivered_observation",
        ),
        power_headroom=PowerHeadroom(
            value=power_kw, unit="kW", observed_at_s=power_s,
        ),
    )


def _fault(db: Connection, run_id: str, *, event_id: str, event_type: str,
           mission_s: int, payload: dict) -> None:
    db.execute(
        """INSERT INTO events (run_id, event_seq, event_id, event_type, mission_s, visibility, payload_json)
           SELECT ?, COALESCE(MAX(event_seq), 0) + 1, ?, ?, ?, 'operational', ?
           FROM events WHERE run_id = ?""",
        (run_id, event_id, event_type, mission_s, dumps(payload, sort_keys=True), run_id),
    )
    handle_fault(db, run_id, event_id)


def _observed_co2(mission_s: int) -> float:
    at_60 = advance_co2_ppm(
        INITIAL_CO2_PPM, duration_s=60, volume_m3=CABIN_VOLUME_M3,
        generation_m3_h=GENERATION_M3_H, removal_m3_h=NOMINAL_REMOVAL_M3_H,
    )
    if mission_s <= 60:
        return at_60
    return advance_co2_ppm(
        at_60, duration_s=mission_s - 60, volume_m3=CABIN_VOLUME_M3,
        generation_m3_h=GENERATION_M3_H, removal_m3_h=4,
    )


def _observe(db: Connection, run_id: str, mission_s: int, *, variant: dict | None = None) -> None:
    sample = SENSOR.sample(
        _observed_co2(mission_s), run_id=run_id,
        mission_s=mission_s, model_version=MODEL_VERSION,
    )
    if sample is None:
        raise ValueError("GOLDEN_SENSOR_MISSING")
    if variant is not None:
        incoming = next(
            (normalize_incoming_co2(item) for item in variant["incoming_observations"]
             if item["observed_at_s"] == mission_s), None,
        )
        if incoming is None:
            raise ValueError("ORGANIZER_SAMPLE_MISSING")
        sample["source_id"] = incoming["source_id"]
        sample["event_id"] = f"{incoming['source_id']}:{mission_s}"
        sample["received_at_s"] = incoming["received_at_s"]
        sample["payload"]["value"] = incoming["value"]
        sample["payload"]["unit"] = incoming["unit"]
        sample["payload"]["quality"] = incoming["quality"]
        sample["payload"]["provenance"] = "synthetic_test_fixture"
        sample["payload"]["original_unit"] = incoming["original_unit"]
    db.execute(
        """INSERT INTO events (run_id, event_seq, event_id, event_type, mission_s, visibility, payload_json)
           SELECT ?, COALESCE(MAX(event_seq), 0) + 1, ?, 'observation.recorded',
                  ?, 'operational', ? FROM events WHERE run_id = ?""",
        (run_id, sample["event_id"], mission_s, dumps(sample), run_id),
    )
    db.execute(
        """INSERT INTO telemetry_observations
           (run_id, event_id, entity_id, source_id, metric, observed_at_s, received_at_s,
            value, unit, quality, model_version)
           VALUES (:run_id, :event_id, :entity_id, :source_id, :metric, :observed_at_s,
                   :received_at_s, :value, :unit, :quality, :model_version)""",
        {**sample, **sample["payload"]},
    )


def seed_golden(db: Connection, run_id: str, *, variant: dict | None = None) -> None:
    """Create the initial Crew/Ground revision without changing the canonical fixture."""
    db.execute("UPDATE runs SET decision_rev = 101 WHERE run_id = ?", (run_id,))
    queue_ground_snapshot(
        db, run_id, snapshot_id="ground-v100", decision_rev=100,
        observed_at_s=-60, issued_at_s=0, deliver_at_s=0,
        packet=_packet(snapshot_s=-60, power_kw=(variant["power_headroom_kw"]["initial"] if variant else GOLDEN_HEADROOM_INITIAL_KW), power_s=-60),
    )
    deliver_due(db, run_id, 0)


def _beat(db: Connection, run_id: str, mission_s: int, *, variant: dict | None = None) -> None:
    db.execute("UPDATE runs SET mission_s = ? WHERE run_id = ?", (mission_s, run_id))
    if mission_s == 60:
        db.execute("UPDATE runs SET decision_rev = 102 WHERE run_id = ?", (run_id,))
        _observe(db, run_id, mission_s, variant=variant)
        _fault(
            db, run_id, event_id="evt-scrubber-degraded",
            event_type="fault.scrubber_degraded", mission_s=60,
            payload={"component_id": "scrubber-primary", "removal_m3_h": 4},
        )
        queue_ground_snapshot(
            db, run_id, snapshot_id="ground-v102", decision_rev=102,
            observed_at_s=60, issued_at_s=60, deliver_at_s=360,
            packet=_packet(snapshot_s=60, power_kw=(variant["power_headroom_kw"]["initial"] if variant else GOLDEN_HEADROOM_INITIAL_KW), power_s=60, co2_ppm=(next(item["value"] for item in variant["incoming_observations"] if item["observed_at_s"] == 60) if variant else GOLDEN_OBSERVED_CO2_PPM)),
        )
    elif mission_s == 480:
        run = db.execute(
            "SELECT run_id, mission_s, status FROM runs WHERE run_id = ?", (run_id,)
        ).fetchone()
        queue_ground_advisory(
            db, run, GroundAdvisoryRequest(
                operation_id="op-demo-013", basis_snapshot_id="ground-v102",
                candidate_id="start_standby",
            ),
        )
    elif mission_s == 600:
        db.execute("UPDATE runs SET decision_rev = 103 WHERE run_id = ?", (run_id,))
        _observe(db, run_id, mission_s, variant=variant)
        _fault(
            db, run_id, event_id="evt-power-drops",
            event_type="fault.power_drop", mission_s=600,
            payload={
                "component_id": "power-bus-01",
                "power_headroom_kw": GOLDEN_HEADROOM_DEGRADED_KW,
                "feeder_connected": True,
            },
        )
        queue_ground_snapshot(
            db, run_id, snapshot_id="ground-v103", decision_rev=103,
            observed_at_s=600, issued_at_s=600, deliver_at_s=900,
            packet=_packet(snapshot_s=600, power_kw=(variant["power_headroom_kw"]["degraded"] if variant else GOLDEN_HEADROOM_DEGRADED_KW), power_s=600, co2_ppm=(next(item["value"] for item in variant["incoming_observations"] if item["observed_at_s"] == 600) if variant else _observed_co2(600))),
        )
    elif mission_s in (780, 900):
        _observe(db, run_id, mission_s, variant=variant)

    # Same-time plant changes and accepted observations precede Relay/advice intake.
    deliver_due(db, run_id, mission_s)
    receive_due_advisories(db, run_id, mission_s)


def compose_golden_until(db: Connection, run_id: str, current_s: int, target_s: int, *, variant: dict | None = None) -> None:
    """Replay all intervening beats in mission-time order, never wall-clock order."""
    if target_s not in GOLDEN_STEPS_S or target_s <= current_s:
        raise ValueError("GOLDEN_STEP_NOT_REACHABLE")
    for beat_s in GOLDEN_STEPS_S:
        if current_s < beat_s <= target_s:
            _beat(db, run_id, beat_s, variant=variant)

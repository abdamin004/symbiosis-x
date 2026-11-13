"""Persist the first nominal pilot's simulated cabin observations."""

from json import dumps
from sqlite3 import Connection

from symbiosis_x.contracts.projections import GroundCO2, GroundPacket
from symbiosis_x.simulation.spacecraft.atmosphere import advance_co2_ppm
from symbiosis_x.telemetry.sampling import CabinCO2Sensor

MODEL_VERSION = "cabin-1"
# The nominal pilot's single-zone cabin, in the units the atmosphere model takes.
INITIAL_CO2_PPM = 2000
CABIN_VOLUME_M3 = 100
GENERATION_M3_H = 0.04
NOMINAL_REMOVAL_M3_H = 20
SENSOR = CabinCO2Sensor(
    source_id="sim.cabin.co2", component_id="co2-sensor-01", entity_id="cabin-01",
    metric="co2", unit="ppm", sample_period_s=60, input_kind="simulated",
    visibility="operational",
)


def record_nominal_co2(db: Connection, run_id: str, mission_s: int) -> None:
    value = advance_co2_ppm(
        INITIAL_CO2_PPM, duration_s=mission_s, volume_m3=CABIN_VOLUME_M3,
        generation_m3_h=GENERATION_M3_H, removal_m3_h=NOMINAL_REMOVAL_M3_H,
    )
    event = SENSOR.sample(value, run_id=run_id, mission_s=mission_s, model_version=MODEL_VERSION)
    if event is None:
        return
    db.execute(
        """INSERT INTO events
           (run_id, event_seq, event_id, event_type, mission_s, visibility, payload_json)
           SELECT :run_id, COALESCE(MAX(event_seq), 0) + 1, :event_id,
                  :event_type, :received_at_s, 'operational', :payload_json
           FROM events WHERE run_id = :run_id""",
        {**event, "payload_json": dumps(event)},
    )
    db.execute(
        """INSERT INTO telemetry_observations
           (run_id, event_id, entity_id, source_id, metric, observed_at_s,
            received_at_s, value, unit, quality, model_version)
           VALUES (:run_id, :event_id, :entity_id, :source_id, :metric, :observed_at_s,
                   :received_at_s, :value, :unit, :quality, :model_version)""",
        {**event, **event["payload"]},
    )


def deliver_nominal_ground(db: Connection, run_id: str, mission_s: int) -> None:
    """Deliver the launch sample at the first nominal checkpoint."""
    observation = db.execute(
        """SELECT value, unit, observed_at_s FROM telemetry_observations
           WHERE run_id = ? AND event_id = ? AND quality = 'valid'""",
        (run_id, f"{SENSOR.source_id}:0"),
    ).fetchone()
    if observation is None:
        return  # Older pilot runs may predate the launch sample writer.
    packet = GroundPacket(co2=GroundCO2(**dict(observation), kind="delivered_observation"))
    snapshot_id = "nominal-ground-launch"
    db.execute(
        """INSERT INTO snapshots (run_id, snapshot_id, audience, decision_rev, observed_at_s, payload_json)
           VALUES (?, ?, 'ground', 0, ?, ?)""",
        (run_id, snapshot_id, observation["observed_at_s"], packet.model_dump_json()),
    )
    db.execute(
        """INSERT INTO messages (run_id, message_id, direction, issued_at_s, deliver_at_s,
                                  delivered_at_s, ground_snapshot_id, payload_json)
           VALUES (?, 'nominal-launch-delivery', 'to_ground', 0, ?, ?, ?, '{}')""",
        (run_id, mission_s, mission_s, snapshot_id),
    )

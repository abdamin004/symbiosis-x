"""Persist the first nominal pilot's simulated cabin observations."""

from json import dumps
from sqlite3 import Connection

from symbiosis_x.simulation.spacecraft.atmosphere import advance_co2_ppm
from symbiosis_x.telemetry.sampling import CabinCO2Sensor

MODEL_VERSION = "cabin-1"
SENSOR = CabinCO2Sensor(
    source_id="sim.cabin.co2", component_id="co2-sensor-01", entity_id="cabin-01",
    metric="co2", unit="ppm", sample_period_s=60, input_kind="simulated",
    visibility="operational",
)


def record_nominal_co2(db: Connection, run_id: str, mission_s: int) -> None:
    value = advance_co2_ppm(
        2000, duration_s=mission_s, volume_m3=100, generation_m3_h=0.04, removal_m3_h=20,
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

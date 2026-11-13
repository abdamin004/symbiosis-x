"""SX-13: cabin pressure is the first extra signal, with units and a missing-data check."""

import json
import math
from pathlib import Path

import pytest

from symbiosis_x.simulation.spacecraft.atmosphere import (
    NOMINAL_CABIN_PRESSURE_KPA, co2_partial_pressure_kpa, sample_cabin_pressure,
)

ROOT = Path(__file__).resolve().parents[3]
CATALOG = json.loads((ROOT / "catalogs" / "sx01" / "sensors.json").read_text(encoding="utf-8"))


def test_new_signal_keeps_unit_and_quality():
    entry = next(s for s in CATALOG["sensors"] if s["metric"] == "pressure")
    assert (entry["source_id"], entry["entity_id"], entry["unit"]) == ("sim.cabin.pressure", "cabin-01", "kPa")

    nominal = sample_cabin_pressure(NOMINAL_CABIN_PRESSURE_KPA, mission_s=60)
    assert (nominal.value, nominal.unit, nominal.quality, nominal.reason_code) == (101.3, "kPa", "valid", None)
    assert (nominal.source_id, nominal.observed_at_s) == ("sim.cabin.pressure", 60)

    missing = sample_cabin_pressure(None, mission_s=120)
    assert (missing.value, missing.unit, missing.quality, missing.reason_code) == (
        None, "kPa", "unavailable", "PRESSURE_UNAVAILABLE")

    for bad in (-1.0, math.inf, math.nan):
        with pytest.raises(ValueError):
            sample_cabin_pressure(bad, mission_s=0)


def test_pressure_turns_co2_ppm_into_partial_pressure_or_unknown():
    assert co2_partial_pressure_kpa(2000.0, 101.3) == pytest.approx(0.2026)
    assert co2_partial_pressure_kpa(2000.0, None) is None
    assert co2_partial_pressure_kpa(None, 101.3) is None


def test_pressure_sensor_component_is_registered():
    components = json.loads((ROOT / "catalogs" / "sx01" / "components.json").read_text(encoding="utf-8"))
    entry = next(s for s in CATALOG["sensors"] if s["metric"] == "pressure")
    component = next(c for c in components["components"] if c["entity_id"] == entry["component_id"])
    assert (component["kind"], component["serves_zone"]) == ("sensor", entry["entity_id"])

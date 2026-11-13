"""Independent oracles for the nominal and degraded cabin."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))
from symbiosis_x.simulation.spacecraft.atmosphere import advance_co2_ppm


def test_golden_cabin_estimate():
    cabin = {"volume_m3": 100, "generation_m3_h": 0.04}
    at_fault = advance_co2_ppm(2000, duration_s=60, removal_m3_h=20, **cabin)
    assert at_fault == pytest.approx(2000)
    at_power_drop = advance_co2_ppm(at_fault, duration_s=540, removal_m3_h=4, **cabin)
    assert at_power_drop == pytest.approx(2047.86, abs=0.01)
    at_handoff = advance_co2_ppm(at_power_drop, duration_s=180, removal_m3_h=4, **cabin)
    assert at_handoff == pytest.approx(2063.74, abs=0.01)


def test_zero_removal_and_short_intervals():
    cabin = {"volume_m3": 100, "generation_m3_h": 0.04}
    assert advance_co2_ppm(2000, duration_s=0, removal_m3_h=4, **cabin) == 2000
    assert advance_co2_ppm(2000, duration_s=3600, removal_m3_h=0, **cabin) == 2400
    assert advance_co2_ppm(2000, duration_s=3600, removal_m3_h=1e-20, **cabin) == pytest.approx(2400)


@pytest.mark.parametrize("change", [
    {"volume_m3": 0}, {"generation_m3_h": -1}, {"removal_m3_h": float("nan")},
    {"duration_s": -1}, {"co2_ppm": float("inf")},
])
def test_invalid_cabin_input(change):
    inputs = {"co2_ppm": 2000, "volume_m3": 100, "generation_m3_h": 0.04,
              "duration_s": 60, "removal_m3_h": 4}
    with pytest.raises(ValueError):
        advance_co2_ppm(**(inputs | change))

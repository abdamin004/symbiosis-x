"""SX-18C: a seeded noisy sensor repeats its trace and changes only with the seed."""

import json
from pathlib import Path

from symbiosis_x.telemetry.sampling import CabinCO2Sensor, noisy_trace

ROOT = Path(__file__).resolve().parents[3]
VARIANT = json.loads((ROOT / "scenarios" / "variants" / "sensor-noise.json").read_text(encoding="utf-8"))
SENSOR = CabinCO2Sensor(**VARIANT["sensor"])
HISTORY = [(point["mission_s"], point["true_co2_ppm"]) for point in VARIANT["input_history"]]


def trace(seed, sensor=SENSOR):
    return noisy_trace(sensor, HISTORY, seed=seed, sigma_ppm=VARIANT["noise"]["sigma_ppm"],
                       run_id="run-noise", model_version=VARIANT["model_version"])


def values(events):
    return [event["payload"]["value"] for event in events]


def test_seed_repeats_sensor_trace():
    seed = VARIANT["seed"]
    first, second = trace(seed), trace(seed)
    assert first == second
    assert values(trace(seed + 1)) != values(first)
    assert [e["observed_at_s"] for e in trace(seed + 1)] == [e["observed_at_s"] for e in first]

    # Noise is visible but bounded; every sample keeps its unit, source and valid quality.
    truth = [value for _, value in HISTORY]
    assert values(first) != truth
    sigma = VARIANT["noise"]["sigma_ppm"]
    assert all(abs(noisy - true) <= 5 * sigma for noisy, true in zip(values(first), truth))
    assert {(e["payload"]["unit"], e["source_id"], e["payload"]["quality"]) for e in first} == {
        ("ppm", SENSOR.source_id, "valid")}


def test_stream_is_per_sensor_and_per_sample():
    seed = VARIANT["seed"]
    # Sampling a prefix gives the same values: each sample is independent of how many came before.
    prefix = noisy_trace(SENSOR, HISTORY[:2], seed=seed, sigma_ppm=VARIANT["noise"]["sigma_ppm"],
                         run_id="run-noise", model_version=VARIANT["model_version"])
    assert values(prefix) == values(trace(seed))[:2]
    other = CabinCO2Sensor(**{**VARIANT["sensor"], "source_id": "sim.cabin.co2.backup"})
    assert values(trace(seed, other)) != values(trace(seed))


def test_variant_is_versioned_synthetic_input_without_expected_output():
    assert (VARIANT["scenario_id"], VARIANT["scenario_version"], VARIANT["synthetic"]) == ("sensor-noise", "1", True)
    assert VARIANT["noise"]["unit"] == "ppm"
    assert "expected" not in VARIANT

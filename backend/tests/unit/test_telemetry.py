"""Verify the first sensor's catalog, observation envelope, and deck identity."""

import json
import re
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "backend" / "src"))
from symbiosis_x.telemetry.sampling import CabinCO2Sensor


@pytest.fixture
def sensor():
    path = ROOT / "catalogs/sx01/sensors.json"
    return CabinCO2Sensor(**json.loads(path.read_text())["sensors"][0])


def test_co2_sensor_resolves_cabin_id(sensor, tmp_path):
    output = tmp_path / "cabin.html"
    subprocess.run(
        [sys.executable, str(ROOT / "scripts/build_cabin_preview.py"), str(output)], check=True,
    )
    page = output.read_text()
    embedded = re.search(r'id="replay-data">(.*?)</script>', page).group(1)
    deck = json.loads(embedded)
    components = {item["entity_id"]: item for item in deck["components"]}
    observation = deck["replays"][""][-1]["co2_sample"]

    assert deck["sensor"]["source_id"] == observation["source_id"] == sensor.source_id
    assert deck["sensor"]["entity_id"] == observation["entity_id"] == "cabin-01"
    assert components[sensor.entity_id]["kind"] == "air_zone"
    assert components[sensor.component_id]["serves_zone"] == observation["entity_id"]
    assert observation["run_id"] == deck["ground"]["run_id"]
    assert observation["observed_at_s"] == observation["received_at_s"] == 780
    assert observation["payload"] == {
        "metric": "co2", "value": pytest.approx(2063.74, abs=0.01), "unit": "ppm", "quality": "valid",
    }


def test_sensor_samples_only_at_mission_intervals(sensor):
    run = {"run_id": "run-001", "model_version": "cabin-1"}
    assert sensor.sample(2000, mission_s=59, **run) is None
    first = sensor.sample(2000, mission_s=60, **run)
    assert first == sensor.sample(2000, mission_s=60, **run)
    assert first["event_id"] != sensor.sample(2000, mission_s=120, **run)["event_id"]
    assert first["event_type"] == "observation.recorded"
    assert first["model_version"] == "cabin-1"

    missing = sensor.sample(None, mission_s=120, **run)
    assert missing["payload"]["value"] is None
    assert missing["payload"]["quality"] == "unavailable"
    assert missing["payload"]["reason_code"] == "MODEL_VALUE_UNAVAILABLE"

    with pytest.raises(ValueError, match="nonnegative integer"):
        sensor.sample(2000, mission_s=-60, **run)
    with pytest.raises(ValueError, match="finite"):
        sensor.sample(float("nan"), mission_s=60, **run)

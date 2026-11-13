"""Tests for synthetic crew health measurement validation."""

import pytest
from pydantic import ValidationError

from symbiosis_x.contracts.health import validate_health_measurement


COMMON = {
    "observed_at_s": 120,
    "source_id": "synthetic.test",
    "quality": "valid",
}

VALID_MEASUREMENTS = [
    {
        **COMMON,
        "metric": "heart_rate",
        "value": 76,
        "unit": "bpm",
    },
    {
        **COMMON,
        "metric": "blood_pressure",
        "systolic": 118,
        "diastolic": 77,
        "unit": "mmHg",
    },
    {
        **COMMON,
        "metric": "glucose",
        "value": 96,
        "unit": "mg/dL",
        "method": "simulated fingerstick",
        "meal_context": "two hours after meal",
    },
    {
        **COMMON,
        "metric": "temperature",
        "value": 36.8,
        "unit": "°C",
        "method": "simulated oral reading",
        "site": "oral",
    },
    {
        **COMMON,
        "metric": "sleep",
        "duration_min": 420,
    },
    {
        **COMMON,
        "metric": "mood",
        "score": 4,
        "scale_id": "mood-1-to-5-v1",
        "unit": "score",
    },
    {
        **COMMON,
        "metric": "symptoms",
        "symptoms": ["fictional_headache"],
        "private_text": "Synthetic demo note",
    },
]


@pytest.mark.parametrize(
    "payload",
    VALID_MEASUREMENTS,
    ids=[
        "heart-rate",
        "blood-pressure",
        "glucose",
        "temperature",
        "sleep",
        "mood",
        "symptoms",
    ],
)
def test_seven_metric_fixtures(payload):
    parsed = validate_health_measurement(payload)

    assert parsed.metric == payload["metric"]
    assert parsed.observed_at_s == payload["observed_at_s"]
    assert parsed.source_id == payload["source_id"]
    assert parsed.quality == payload["quality"]
    assert parsed.model_dump(exclude_none=True) == payload


def test_incomplete_blood_pressure_is_rejected():
    payload = {
        **COMMON,
        "metric": "blood_pressure",
        "systolic": 118,
        "unit": "mmHg",
    }

    with pytest.raises(ValidationError):
        validate_health_measurement(payload)


def test_unsupported_unit_is_rejected():
    payload = {
        **COMMON,
        "metric": "heart_rate",
        "value": 76,
        "unit": "Hz",
    }

    with pytest.raises(ValidationError):
        validate_health_measurement(payload)
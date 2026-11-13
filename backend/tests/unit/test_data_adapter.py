"""Synthetic-only preflight tests; no organizer approval is implied."""
import pytest

from symbiosis_x.telemetry.adapters import normalize_incoming_co2


BASE = {
    "source_id": "synthetic.organizer.co2", "metric": "co2",
    "observed_at_s": 60, "received_at_s": 61,
    "value": 0.2, "unit": "percent", "quality": "valid",
}


def test_sample_normalizes_or_reports_quality():
    mapped = normalize_incoming_co2(BASE)
    assert mapped["value"] == pytest.approx(2000.0)
    assert mapped["unit"] == "ppm"
    assert mapped["original_unit"] == "percent"
    assert mapped["observed_at_s"] == 60
    assert mapped["received_at_s"] == 61
    assert normalize_incoming_co2({**BASE, "quality": "unavailable", "value": None})["value"] is None
    for bad in (
        {**BASE, "unit": "mysterious"},
        {**BASE, "observed_at_s": -1},
        {**BASE, "received_at_s": 59},
        {**BASE, "received_at_s": 60.5},
        {**BASE, "value": float("nan")},
        {**BASE, "quality": "unavailable", "value": 3},
    ):
        with pytest.raises(ValueError):
            normalize_incoming_co2(bad)

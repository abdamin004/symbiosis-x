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


def test_small_fixture_reports_every_row():
    import json
    from pathlib import Path

    from symbiosis_x.telemetry.adapters import normalize_sample

    fixture = Path(__file__).resolve().parents[1] / "fixtures" / "data" / "organizer-small.json"
    result = normalize_sample(json.loads(fixture.read_text()))
    assert (result["sample_id"], result["provenance"], result["approved"]) == (
        "organizer-small-v1", "synthetic_test_fixture", False)
    assert [(r["row"], r["value"], r["unit"], r["original_unit"], r["observed_at_s"], r["received_at_s"])
            for r in result["accepted"]] == [
        (0, 2010.0, "ppm", "ppm", 60, 60),
        (1, pytest.approx(2058.0), "ppm", "percent", 600, 605),
        (2, None, "ppm", "ppm", 660, 665),             # missing stays unknown
    ]
    assert [(r["row"], r["reason_code"]) for r in result["rejected"]] == [
        (3, "AMBIGUOUS_CO2_UNIT"), (4, "BAD_SAMPLE_TIME"), (5, "BAD_SAMPLE_TIME")]
    assert all(r["source_id"] == "synthetic.organizer.co2" for r in result["accepted"])
    with pytest.raises(ValueError, match="SAMPLE_ID_REQUIRED"):
        normalize_sample({"rows": []})

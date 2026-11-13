"""Tests for the sourced RadLab archive series parser."""

import json

import pytest

from symbiosis_x.crew.radiation import RadLabExportError, parse_radlab_csv


SOURCE = (
    "https://visualization.osdr.nasa.gov/radlab/api/"
    "?spacecraft=ISS&instrument_id=DosTel1"
    "&timestamp%3E=2022-04-01T00%3A00%3A00"
    "&timestamp%3C=2022-04-01T00%3A20%3A00"
    "&absorbed_dose_rate&dose_equivalent_rate&format=csv"
)
# Rows are copied from the validated April 1, 2022 ISS DosTel export. The
# dose-equivalent field is blank in the source; it is intentionally retained.
CSV = """timestamp,instrument_id,absorbed_dose_rate,dose_equivalent_rate,instrument,spacecraft
2022-04-01T00:00:00,DosTel1,1.99686266666667,,DosTel1,ISS
2022-04-01T00:00:10,DosTel1,1.99712,,DosTel1,ISS
2022-04-01T00:03:30,DosTel1,2.21904,,DosTel1,ISS
"""


def test_archive_keeps_detector_utc_and_unit():
    series = parse_radlab_csv(
        CSV,
        quantity="absorbed_dose_rate",
        source_url=SOURCE,
        expected_instrument_id="DosTel1",
    )

    assert series["instrument_id"] == "DosTel1"
    assert series["spacecraft"] == "ISS"
    assert series["quantity"] == "absorbed_dose_rate"
    assert series["unit"] == "µGy/hour"
    assert series["coverage_utc"] == {
        "start": "2022-04-01T00:00:00Z",
        "end": "2022-04-01T00:03:30Z",
    }
    assert series["time_basis"].endswith("interpreted as UTC")
    assert series["points"][0] == {
        "timestamp_utc": "2022-04-01T00:00:00Z",
        "value": 1.99686266666667,
    }
    assert series["source"]["export_url"] == SOURCE


def test_blank_measurements_are_kept_as_gaps_not_zeroes():
    series = parse_radlab_csv(
        CSV,
        quantity="dose_equivalent_rate",
        source_url=SOURCE,
        expected_instrument_id="DosTel1",
    )

    assert series["unit"] == "µSv/hour"
    assert series["missing_value_count"] == 3
    assert all(point["value"] is None for point in series["points"])


def test_csv_for_other_instrument_is_not_mixed_into_selected_series():
    csv_text = CSV + (
        "2022-04-01T00:04:00,DosTel2,3.0,,DosTel2,ISS\n"
    )
    series = parse_radlab_csv(
        csv_text,
        quantity="absorbed_dose_rate",
        source_url=SOURCE,
        expected_instrument_id="DosTel1",
    )

    assert series["instrument_id"] == "DosTel1"
    assert series["row_count"] == 3


def test_rejects_unknown_quantity_instead_of_guessing_its_unit():
    with pytest.raises(RadLabExportError, match="unsupported quantity"):
        parse_radlab_csv(CSV, quantity="dose", source_url=SOURCE)


def test_rejects_mixed_detectors_when_no_detector_is_selected():
    csv_text = CSV + (
        "2022-04-01T00:04:00,DosTel2,3.0,,DosTel2,ISS\n"
    )
    with pytest.raises(RadLabExportError, match="exactly one"):
        parse_radlab_csv(
            csv_text,
            quantity="absorbed_dose_rate",
            source_url=SOURCE,
        )


def test_series_json_is_serializable_without_nonstandard_nan_values():
    series = parse_radlab_csv(
        CSV, quantity="absorbed_dose_rate", source_url=SOURCE
    )

    parsed = json.loads(json.dumps(series, allow_nan=False))
    assert parsed["row_count"] == 3


def test_preserves_fractional_seconds_from_source_timestamp():
    csv_text = CSV.replace(
        "2022-04-01T00:00:00,",
        "2022-04-01T00:00:00.125,",
        1,
    )
    series = parse_radlab_csv(
        csv_text, quantity="absorbed_dose_rate", source_url=SOURCE
    )

    assert series["points"][0]["timestamp_utc"] == "2022-04-01T00:00:00.125000Z"

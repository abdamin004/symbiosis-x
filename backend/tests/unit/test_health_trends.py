"""SX-23E: count only recent, comparable synthetic health samples in a trend."""

import sys
from dataclasses import replace
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "backend" / "src"))

from symbiosis_x.crew.trends import TrendSample, evaluate_trend, load_trend_rules

RULES = load_trend_rules()


def heart_rate(sample_id, observed_at_s, value, *, activity="rest", quality="valid"):
    return TrendSample(
        sample_id=sample_id,
        crew_id="SIM-01",
        metric="heart_rate",
        value=value,
        unit="bpm",
        observed_at_s=observed_at_s,
        quality=quality,
        source_id="synthetic.sim-01-wrist-hr",
        context={"activity": activity},
    )


def test_only_comparable_samples_count():
    samples = [
        heart_rate("hr-4", 7800, 98),
        heart_rate("hr-2", 6600, 95),
        heart_rate("hr-exercise", 7200, 120, activity="exercise"),
        heart_rate("hr-old", 5000, 65),
        heart_rate("hr-missing", 9000, None, quality="unavailable"),
        heart_rate("hr-1", 6000, 74),
    ]

    trend = evaluate_trend(samples)

    assert trend.status == "review"
    assert trend.direction == "rising"
    assert trend.sample_count == RULES.minimum_samples == 3
    assert trend.window_s == RULES.window_s == 3600
    assert trend.evidence_ids == ("hr-1", "hr-2", "hr-4")
    assert (trend.start_observed_at_s, trend.end_observed_at_s) == (6000, 7800)
    assert (trend.start_value, trend.end_value, trend.change) == (74, 98, 24)
    assert trend.visibility == "onboard_private" and trend.synthetic is True


def test_incompatible_and_missing_samples_do_not_fill_a_thin_series():
    samples = [
        heart_rate("hr-1", 600, 74),
        heart_rate("hr-2", 660, 95),
        heart_rate("hr-exercise", 720, 120, activity="exercise"),
        heart_rate("hr-gap", 780, None, quality="unavailable"),
    ]

    trend = evaluate_trend(samples)

    assert trend.status == "insufficient_history"
    assert trend.direction == "unknown"
    assert trend.reason_code == "INSUFFICIENT_COMPARABLE_SAMPLES"
    assert trend.sample_count == 2
    assert trend.evidence_ids == ("hr-1", "hr-2")


def test_different_measurement_methods_do_not_mix():
    samples = [
        TrendSample("g-1", "SIM-01", "glucose", 95, "mg/dL", 100, "valid", "synthetic.lab",
                    {"method": "lab_plasma", "meal_context": "fasting"}),
        TrendSample("g-2", "SIM-01", "glucose", 98, "mg/dL", 200, "valid", "synthetic.lab",
                    {"method": "lab_plasma", "meal_context": "fasting"}),
        TrendSample("g-3", "SIM-01", "glucose", 110, "mg/dL", 300, "valid", "synthetic.meter",
                    {"method": "meter", "meal_context": "fasting"}),
    ]

    trend = evaluate_trend(samples)

    assert trend.status == "insufficient_history"
    assert trend.metric == "glucose"
    assert trend.sample_count == 1
    assert trend.evidence_ids == ("g-3",)


def test_window_and_observation_order_come_from_rules_fixture():
    samples = [
        heart_rate("hr-3", 10000, 90),
        heart_rate("hr-old", 5000, 70),
        heart_rate("hr-2", 9000, 85),
    ]

    trend = evaluate_trend(samples)

    assert trend.status == "insufficient_history"
    assert trend.sample_count == 2
    assert trend.evidence_ids == ("hr-2", "hr-3")
    assert (trend.start_observed_at_s, trend.end_observed_at_s) == (9000, 10000)


def test_missing_context_and_empty_series_are_unknown_history():
    missing_context = TrendSample(
        "hr-1", "SIM-01", "heart_rate", 76, "bpm", 60, "valid",
        "synthetic.sim-01-wrist-hr", {},
    )
    assert evaluate_trend([missing_context]).reason_code == "MISSING_COMPARISON_CONTEXT"
    assert evaluate_trend([]).reason_code == "NO_SAMPLES"


def test_real_measurements_are_not_admitted_to_the_synthetic_trend():
    with pytest.raises(ValueError, match="synthetic samples only"):
        evaluate_trend([replace(heart_rate("hr-real", 60, 80), synthetic=False)])


def test_daily_trend_uses_distinct_days_and_review_threshold():
    daily = [heart_rate(f"hr-{day}", day * 86400, value) for day, value in enumerate((72, 74, 77))]
    assert evaluate_trend(daily).reason_code == "DAILY_CHANGE_BELOW_THRESHOLD"
    assert evaluate_trend(daily).status == "steady"
    trend = evaluate_trend([*daily, heart_rate("hr-3", 3 * 86400, 80)])
    assert (trend.status, trend.direction, trend.reason_code, trend.sample_count, trend.window_s) == (
        "review", "rising", "DAILY_TREND", 4, 4 * 86400,
    )

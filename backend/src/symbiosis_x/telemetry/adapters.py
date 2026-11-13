"""Strict, provenance-preserving adapter for an opt-in synthetic CO2 sample.

The current test fixture is *not* an approved organizer data sample. This
adapter also rejects unknown units, invalid mission time and fake readings.
"""
from math import isfinite


def normalize_incoming_co2(sample: dict) -> dict:
    if not isinstance(sample, dict):
        raise ValueError("INVALID_SAMPLE")
    if sample.get("metric") != "co2":
        raise ValueError("UNSUPPORTED_METRIC")
    source = sample.get("source_id")
    if not isinstance(source, str) or not source.strip():
        raise ValueError("SOURCE_REQUIRED")
    observed = sample.get("observed_at_s")
    received = sample.get("received_at_s")
    if type(observed) is not int or type(received) is not int or observed < 0 or received < observed:
        raise ValueError("BAD_SAMPLE_TIME")
    quality = sample.get("quality")
    if quality not in ("valid", "unavailable"):
        raise ValueError("AMBIGUOUS_SAMPLE_QUALITY")
    unit = sample.get("unit")
    if unit not in ("ppm", "percent"):
        raise ValueError("AMBIGUOUS_CO2_UNIT")
    value = sample.get("value")
    if quality == "unavailable":
        if value is not None:
            raise ValueError("UNAVAILABLE_HAS_VALUE")
        normalized = None
    else:
        if type(value) not in (int, float) or not isfinite(value) or value < 0:
            raise ValueError("INVALID_CO2_VALUE")
        normalized = float(value) * (10000.0 if unit == "percent" else 1.0)
    return {
        "source_id": source,
        "metric": "co2",
        "value": normalized,
        "unit": "ppm",
        "observed_at_s": observed,
        "received_at_s": received,
        "quality": quality,
        "original_unit": unit,
    }

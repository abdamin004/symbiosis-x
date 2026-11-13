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


def normalize_sample(sample: dict) -> dict:
    """SX-12B: map every row of one sample, keeping its provenance and row order.

    Accepted rows go through ``normalize_incoming_co2``; a missing reading stays
    unknown (``value`` None). A row with an ambiguous unit or a bad time is
    rejected with its reason code instead of stopping the whole sample. The
    sample's approval flag is carried through unchanged, never assumed.
    """
    if not isinstance(sample, dict) or not isinstance(sample.get("rows"), list):
        raise ValueError("INVALID_SAMPLE")
    sample_id = sample.get("sample_id")
    if not isinstance(sample_id, str) or not sample_id.strip():
        raise ValueError("SAMPLE_ID_REQUIRED")
    accepted, rejected = [], []
    for index, row in enumerate(sample["rows"]):
        try:
            accepted.append({**normalize_incoming_co2(row), "sample_id": sample_id, "row": index})
        except ValueError as error:
            rejected.append({"sample_id": sample_id, "row": index, "reason_code": str(error)})
    return {
        "sample_id": sample_id,
        "provenance": sample.get("provenance"),
        "approved": sample.get("approved_organizer_data") is True,
        "accepted": accepted,
        "rejected": rejected,
    }

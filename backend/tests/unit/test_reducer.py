"""SX-17B: the accepted reading only moves forward in observation order."""

import pytest

from symbiosis_x.contracts.events import ObservationEvent
from symbiosis_x.twin.reducer import SignalState, reading_at, reduce


def sample(observed_at_s, value=2000.0, *, seq=None, received_at_s=None, quality="valid", source="sim.cabin.co2"):
    payload = {"metric": "co2", "value": value, "unit": "ppm", "quality": quality}
    if quality == "unavailable":
        payload |= {"value": None, "reason_code": "MODEL_VALUE_UNAVAILABLE"}
    return ObservationEvent.model_validate({
        "schema_version": 1, "run_id": "run-1", "event_id": f"{source}:{observed_at_s}:{seq}",
        "event_type": "observation.recorded", "source_id": source, "entity_id": "cabin-01",
        "observed_at_s": observed_at_s, "received_at_s": received_at_s or observed_at_s,
        "model_version": "cabin-1", "event_seq": seq, "payload": payload,
    })


def test_stale_sample_cannot_replace_accepted_value():
    state, decision = reduce(SignalState(), sample(120, 2010.0, seq=4))
    assert decision.outcome == "accepted"

    # An older observation that arrives later is rejected and the accepted value stays.
    late = sample(60, 1990.0, seq=5, received_at_s=180)
    state, decision = reduce(state, late)
    assert (decision.outcome, decision.reason_code) == ("rejected", "STALE_SAMPLE")
    assert (state.accepted.value, state.accepted.observed_at_s) == (2010.0, 120)

    # Same observation time but earlier stable event order is also out of order.
    state, decision = reduce(state, sample(120, 1980.0, seq=3))
    assert (decision.outcome, decision.reason_code) == ("rejected", "OUT_OF_ORDER")
    # The same event replayed is a duplicate, not a new reading.
    state, decision = reduce(state, sample(120, 2010.0, seq=4))
    assert (decision.outcome, decision.reason_code) == ("rejected", "DUPLICATE_SAMPLE")
    assert (state.accepted.value, state.accepted.observed_at_s, state.accepted.event_seq) == (2010.0, 120, 4)

    view = reading_at(state, mission_s=300)
    assert (view.status, view.value, view.unit, view.observed_at_s, view.age_s) == ("accepted", 2010.0, "ppm", 120, 180)


def test_invalid_evidence_is_exposed_without_replacing_the_last_good_value():
    state, _ = reduce(SignalState(), sample(60, 2000.0, seq=1))
    state, decision = reduce(state, sample(120, seq=2, quality="unavailable"))
    assert (decision.outcome, decision.reason_code) == ("rejected", "SAMPLE_UNAVAILABLE")
    state, decision = reduce(state, sample(180, 9999.0, seq=3, quality="suspect"))
    assert (decision.outcome, decision.reason_code) == ("rejected", "SAMPLE_SUSPECT")

    view = reading_at(state, mission_s=180)
    assert (view.status, view.value, view.observed_at_s, view.age_s) == ("held", 2000.0, 60, 120)
    assert (view.evidence_quality, view.evidence_reason, view.evidence_observed_at_s) == (
        "suspect", "SAMPLE_SUSPECT", 180)

    # A newer valid sample clears the held state.
    state, decision = reduce(state, sample(240, 2005.0, seq=4))
    assert decision.outcome == "accepted"
    assert reading_at(state, mission_s=240).status == "accepted"


def test_missing_and_aged_readings_are_explicit():
    assert reading_at(SignalState(), mission_s=0).status == "missing"
    state, _ = reduce(SignalState(), sample(0, seq=1))
    assert reading_at(state, mission_s=120, max_age_s=120).status == "accepted"
    assert reading_at(state, mission_s=121, max_age_s=120).status == "stale"


def test_a_signal_never_mixes_sources():
    state, _ = reduce(SignalState(), sample(0, seq=1))
    with pytest.raises(ValueError, match="SIGNAL_MISMATCH"):
        reduce(state, sample(60, seq=2, source="other.sensor"))

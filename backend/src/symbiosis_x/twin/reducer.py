"""Accept sensor samples in observation order and keep the last good value.

One SignalState tracks one signal (source, entity, metric). Samples are
ordered by observation time, then stable event order (``event_seq``, falling
back to the event ID). Only a valid sample that is newer than the accepted one
replaces it. Unavailable or suspect evidence is kept beside the accepted value
so a console can show that the reading is held, without hiding the last good
value or inventing a new one. The reducer is pure; wiring it to a run is a
separate step.
"""

from dataclasses import dataclass, replace
from typing import Literal

from symbiosis_x.contracts.events import ObservationEvent

Outcome = Literal["accepted", "rejected"]
RejectReason = Literal[
    "STALE_SAMPLE", "OUT_OF_ORDER", "DUPLICATE_SAMPLE", "SAMPLE_UNAVAILABLE", "SAMPLE_SUSPECT",
]
ReadingStatus = Literal["accepted", "held", "stale", "missing"]


@dataclass(frozen=True)
class Sample:
    source_id: str
    entity_id: str
    metric: str
    event_id: str
    event_seq: int | None
    observed_at_s: int
    received_at_s: int
    value: float | None
    unit: str
    quality: str
    reason_code: RejectReason | None = None

    @property
    def order(self) -> tuple[int, int, str]:
        return (self.observed_at_s, self.event_seq if self.event_seq is not None else -1, self.event_id)

    @classmethod
    def from_event(cls, event: ObservationEvent) -> "Sample":
        return cls(
            source_id=event.source_id, entity_id=event.entity_id, metric=event.payload.metric,
            event_id=event.event_id, event_seq=event.event_seq, observed_at_s=event.observed_at_s,
            received_at_s=event.received_at_s, value=event.payload.value, unit=event.payload.unit,
            quality=event.payload.quality,
        )


@dataclass(frozen=True)
class SignalState:
    accepted: Sample | None = None
    """The latest valid sample in observation order."""
    evidence: Sample | None = None
    """The newest invalid sample seen after ``accepted``, if any."""


@dataclass(frozen=True)
class Decision:
    outcome: Outcome
    reason_code: RejectReason | None
    event_id: str


@dataclass(frozen=True)
class ReadingView:
    status: ReadingStatus
    value: float | None
    unit: str | None
    observed_at_s: int | None
    age_s: int | None
    evidence_quality: str | None
    evidence_reason: RejectReason | None
    evidence_observed_at_s: int | None


def _signal(sample: Sample) -> tuple[str, str, str]:
    return sample.source_id, sample.entity_id, sample.metric


def reduce(state: SignalState, event: ObservationEvent) -> tuple[SignalState, Decision]:
    """Apply one observation and say whether it became the accepted reading."""
    sample = Sample.from_event(event)
    known = state.accepted or state.evidence
    if known is not None and _signal(known) != _signal(sample):
        raise ValueError("SIGNAL_MISMATCH")

    accepted = state.accepted
    if accepted is not None and sample.order <= accepted.order:
        if sample.event_id == accepted.event_id:
            reason: RejectReason = "DUPLICATE_SAMPLE"
        elif sample.observed_at_s < accepted.observed_at_s:
            reason = "STALE_SAMPLE"
        else:
            reason = "OUT_OF_ORDER"
        return state, Decision("rejected", reason, sample.event_id)

    if sample.quality != "valid":
        reason = "SAMPLE_UNAVAILABLE" if sample.quality == "unavailable" else "SAMPLE_SUSPECT"
        flagged = replace(sample, reason_code=reason)
        newest = state.evidence is None or flagged.order > state.evidence.order
        return (replace(state, evidence=flagged) if newest else state), Decision("rejected", reason, sample.event_id)

    # A newer valid sample supersedes the accepted value and any older invalid evidence.
    evidence = state.evidence if state.evidence and state.evidence.order > sample.order else None
    return SignalState(accepted=sample, evidence=evidence), Decision("accepted", None, sample.event_id)


def reading_at(state: SignalState, mission_s: int, *, max_age_s: int | None = None) -> ReadingView:
    """Show the accepted value with its age, and whether newer evidence is holding it."""
    accepted, evidence = state.accepted, state.evidence
    evidence_fields = dict(
        evidence_quality=evidence.quality if evidence else None,
        evidence_reason=evidence.reason_code if evidence else None,
        evidence_observed_at_s=evidence.observed_at_s if evidence else None,
    )
    if accepted is None:
        return ReadingView(status="missing", value=None, unit=None, observed_at_s=None, age_s=None,
                           **evidence_fields)
    age = mission_s - accepted.observed_at_s
    if evidence is not None:
        status: ReadingStatus = "held"
    elif max_age_s is not None and age > max_age_s:
        status = "stale"
    else:
        status = "accepted"
    return ReadingView(status=status, value=accepted.value, unit=accepted.unit,
                       observed_at_s=accepted.observed_at_s, age_s=age, **evidence_fields)

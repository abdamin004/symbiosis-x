"""Private crew wellbeing: check-ins and the personal baseline alert.

A check-in holds a fictional note, its mission timestamp and the crew reference
authorized to read it. It lives in a private lane beside the operational basis,
so recording one never touches the decision revision or any plant input.

The baseline alert applies one explainable synthetic deviation rule to resting
heart-rate samples and reports the signal, reason, quality and last good sample.
"""

from dataclasses import dataclass, field, replace
from math import isfinite
from typing import Literal

from symbiosis_x.crew.activity import CrewActivityState

Visibility = Literal["onboard_private"]
Provenance = Literal["synthetic_fixture"]


@dataclass(frozen=True)
class PrivateCheckIn:
    check_in_id: str
    crew_id: str
    mission_s: int
    # Kept out of repr so the private text never lands in logs or shared traces.
    note: str = field(repr=False)
    authorized_crew_ids: tuple[str, ...] = ()
    visibility: Visibility = "onboard_private"
    provenance: Provenance = "synthetic_fixture"
    synthetic: bool = True


@dataclass(frozen=True)
class PrivateLane:
    crew_roster: frozenset[str]
    records: tuple[PrivateCheckIn, ...] = ()


@dataclass(frozen=True)
class OperationalBasis:
    """The state that operational decisions and the plant read."""

    decision_rev: int
    mission_s: int
    activity: tuple[CrewActivityState, ...] = ()


@dataclass(frozen=True)
class OnboardState:
    operational: OperationalBasis
    private: PrivateLane


def record_check_in(state: OnboardState, check_in: PrivateCheckIn) -> OnboardState:
    """Return the state with the check-in stored in the private lane only."""
    lane = state.private
    if not check_in.synthetic or check_in.provenance != "synthetic_fixture":
        raise ValueError("check-ins accept synthetic fixture records only")
    if check_in.visibility != "onboard_private":
        raise ValueError("check-ins stay in the onboard private lane")
    if not check_in.check_in_id or not check_in.note.strip():
        raise ValueError("check-in requires an ID and a note")
    if type(check_in.mission_s) is not int or check_in.mission_s < 0:
        raise ValueError("check-in requires nonnegative integer mission seconds")
    if check_in.crew_id not in lane.crew_roster:
        raise ValueError("check-in crew member is not on the onboard roster")
    readers = check_in.authorized_crew_ids or (check_in.crew_id,)
    if check_in.crew_id not in readers:
        raise ValueError("the crew member must be able to read their own check-in")
    if not set(readers) <= lane.crew_roster:
        raise ValueError("authorized readers must be onboard crew")
    check_in = replace(check_in, authorized_crew_ids=tuple(readers))

    for prior in lane.records:
        if prior.check_in_id == check_in.check_in_id:
            if prior != check_in:
                raise ValueError("check-in ID already used with different values")
            return state

    # The operational basis is carried over as the same object, unchanged.
    return replace(state, private=replace(lane, records=(*lane.records, check_in)))


def read_check_ins(state: OnboardState, reader_crew_id: str) -> tuple[PrivateCheckIn, ...]:
    """Return the check-ins this onboard crew member is authorized to read."""
    if reader_crew_id not in state.private.crew_roster:
        raise PermissionError("only onboard crew can read private check-ins")
    return tuple(
        record for record in state.private.records if reader_crew_id in record.authorized_crew_ids
    )


# --- Personal baseline alert (SX-04C) ---------------------------------------

SampleQuality = Literal["valid", "suspect", "unavailable"]
SampleActivity = Literal["rest", "exercise", "recovery"]
Signal = Literal["alert", "within_baseline", "unknown"]
BaselineReason = Literal[
    "RESTING_HR_ABOVE_BASELINE",
    "WITHIN_BASELINE",
    "NOT_ENOUGH_CONSECUTIVE_SAMPLES",
    "LATEST_SAMPLE_MISSING",
    "LATEST_SAMPLE_NOT_VALID",
    "LATEST_SAMPLE_NOT_AT_REST",
    "LATEST_SAMPLE_STALE",
    "NO_SAMPLES",
]


@dataclass(frozen=True)
class HeartRateSample:
    sample_id: str
    crew_id: str
    mission_s: int
    value_bpm: float | None
    quality: SampleQuality
    activity: SampleActivity
    source_id: str
    unit: str = "bpm"
    synthetic: bool = True


@dataclass(frozen=True)
class BaselineRule:
    """A proposed synthetic demo rule, not a clinical threshold."""

    rule_id: str
    baseline_bpm: float
    delta_bpm: float
    consecutive: int
    max_gap_s: int
    freshness_s: int
    metric: str = "heart_rate"
    unit: str = "bpm"

    @property
    def threshold_bpm(self) -> float:
        return self.baseline_bpm + self.delta_bpm


@dataclass(frozen=True)
class BaselineAlert:
    crew_id: str
    rule_id: str
    signal: Signal
    reason_code: BaselineReason
    reason: str
    quality: SampleQuality | None
    baseline_bpm: float
    threshold_bpm: float
    last_good_sample: HeartRateSample | None
    evidence_ids: tuple[str, ...] = ()
    unit: str = "bpm"
    visibility: Visibility = "onboard_private"


def resting_hr_rule(baseline_bpm: float) -> BaselineRule:
    """Three consecutive valid resting samples at least 20 bpm above baseline."""
    return BaselineRule(
        rule_id="hr-rest-3x-plus-20-v1", baseline_bpm=baseline_bpm, delta_bpm=20,
        consecutive=3, max_gap_s=120, freshness_s=180,
    )


# Documented synthetic SIM-01 replay at one-minute cadence: a resting reading
# near the 72 bpm baseline at 10:00, three resting readings at least 20 bpm above
# it from 11:00 to 13:00, then a missing reading at 14:00 (840 s).
SIM01_BASELINE_REPLAY = (
    HeartRateSample("hr-sim01-0600", "SIM-01", 600, 74.0, "valid", "rest", "synthetic.sim-01-wrist-hr"),
    HeartRateSample("hr-sim01-0660", "SIM-01", 660, 95.0, "valid", "rest", "synthetic.sim-01-wrist-hr"),
    HeartRateSample("hr-sim01-0720", "SIM-01", 720, 97.0, "valid", "rest", "synthetic.sim-01-wrist-hr"),
    HeartRateSample("hr-sim01-0780", "SIM-01", 780, 98.0, "valid", "rest", "synthetic.sim-01-wrist-hr"),
    HeartRateSample("hr-sim01-0840", "SIM-01", 840, None, "unavailable", "rest", "synthetic.sim-01-wrist-hr"),
)


def _check_sample(sample: HeartRateSample, crew_id: str) -> None:
    if not sample.synthetic:
        raise ValueError("baseline alerts accept synthetic samples only")
    if sample.crew_id != crew_id:
        raise ValueError("samples must belong to the evaluated crew member")
    if sample.unit != "bpm":
        raise ValueError("heart-rate samples must be in bpm")
    if type(sample.mission_s) is not int or sample.mission_s < 0:
        raise ValueError("samples require nonnegative integer mission seconds")
    if sample.quality == "valid" and (
        sample.value_bpm is None or not isfinite(sample.value_bpm) or sample.value_bpm < 0
    ):
        raise ValueError("a valid sample needs a finite, nonnegative value")


def evaluate_baseline(
    samples: tuple[HeartRateSample, ...] | list[HeartRateSample],
    rule: BaselineRule,
    *,
    crew_id: str,
    now_s: int,
) -> BaselineAlert:
    """Apply the rule to the samples up to ``now_s`` and explain the outcome.

    Only valid resting samples count. A gap longer than ``max_gap_s`` or any
    sample that is not a valid resting reading resets the run of consecutive
    out-of-band samples. If the latest evidence is missing, not valid, not at
    rest or stale, the signal is unknown; it never falls back to an old alert.
    """
    for sample in samples:
        _check_sample(sample, crew_id)
    ordered = sorted((s for s in samples if s.mission_s <= now_s), key=lambda s: s.mission_s)

    def result(signal, code, reason, quality, last_good, evidence=()):
        return BaselineAlert(
            crew_id=crew_id, rule_id=rule.rule_id, signal=signal, reason_code=code,
            reason=reason, quality=quality, baseline_bpm=rule.baseline_bpm,
            threshold_bpm=rule.threshold_bpm, last_good_sample=last_good,
            evidence_ids=tuple(evidence),
        )

    good = [s for s in ordered if s.quality == "valid"]
    last_good = good[-1] if good else None
    if not ordered:
        return result("unknown", "NO_SAMPLES", "No heart-rate samples have been recorded.", None, None)

    latest = ordered[-1]
    if latest.quality == "unavailable":
        return result("unknown", "LATEST_SAMPLE_MISSING",
                      f"The latest reading at {latest.mission_s} s is missing.", latest.quality, last_good)
    if latest.quality != "valid":
        return result("unknown", "LATEST_SAMPLE_NOT_VALID",
                      f"The latest reading at {latest.mission_s} s is {latest.quality}.", latest.quality, last_good)
    if latest.activity != "rest":
        return result("unknown", "LATEST_SAMPLE_NOT_AT_REST",
                      f"The latest reading was taken during {latest.activity}, so it is not compared "
                      "with the resting baseline.", latest.quality, last_good)
    if now_s - latest.mission_s > rule.freshness_s:
        return result("unknown", "LATEST_SAMPLE_STALE",
                      f"The latest reading is {now_s - latest.mission_s} s old.", latest.quality, last_good)

    streak: list[HeartRateSample] = []
    previous: HeartRateSample | None = None
    for sample in ordered:
        counts = sample.quality == "valid" and sample.activity == "rest"
        gap_ok = previous is not None and sample.mission_s - previous.mission_s <= rule.max_gap_s
        if counts and sample.value_bpm >= rule.threshold_bpm:
            streak = [*streak, sample] if streak and gap_ok else [sample]
        else:
            streak = []
        previous = sample

    if len(streak) >= rule.consecutive:
        window = streak[-rule.consecutive:]
        values = ", ".join(f"{s.value_bpm:g}" for s in window)
        return result(
            "alert", "RESTING_HR_ABOVE_BASELINE",
            f"{rule.consecutive} consecutive resting readings ({values} bpm) are at least "
            f"{rule.delta_bpm:g} bpm above the {rule.baseline_bpm:g} bpm personal baseline. "
            "Synthetic demo rule for onboard review, not a diagnosis.",
            latest.quality, last_good, (s.sample_id for s in window),
        )
    if streak:
        return result(
            "within_baseline", "NOT_ENOUGH_CONSECUTIVE_SAMPLES",
            f"{len(streak)} of {rule.consecutive} required consecutive resting readings are at or "
            f"above {rule.threshold_bpm:g} bpm.", latest.quality, last_good, (s.sample_id for s in streak),
        )
    return result(
        "within_baseline", "WITHIN_BASELINE",
        f"The latest resting reading ({latest.value_bpm:g} bpm) is below the {rule.threshold_bpm:g} bpm "
        "review threshold.", latest.quality, last_good, (latest.sample_id,),
    )

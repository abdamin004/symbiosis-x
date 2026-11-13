"""SX-04B/SX-04C: private check-ins and the personal baseline alert."""

import json
import sys
from dataclasses import replace
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "backend" / "src"))
from symbiosis_x.crew.activity import CrewActivityState, generation_m3_h
from symbiosis_x.crew.profile import load_profile
from symbiosis_x.crew.wellbeing import (
    SIM01_BASELINE_REPLAY,
    HeartRateSample,
    OnboardState,
    OperationalBasis,
    PrivateCheckIn,
    PrivateLane,
    evaluate_baseline,
    read_check_ins,
    record_check_in,
    resting_hr_rule,
)

MARKER = "SX01_PRIVATE_CREW_MARKER"


def golden_state():
    roster = json.loads((ROOT / "catalogs/crew/synthetic-roster.json").read_text())
    assert roster["synthetic"] is True
    activity = tuple(
        CrewActivityState(member["crew_id"], member["zone_id"], member["initial_mode"])
        for member in roster["crew"]
    )
    rates = {member["crew_id"]: member["co2_generation_m3_h"] for member in roster["crew"]}
    operational = OperationalBasis(decision_rev=103, mission_s=780, activity=activity)
    private = PrivateLane(crew_roster=frozenset(rates))
    return OnboardState(operational=operational, private=private), rates


def total_generation(state, rates):
    return sum(generation_m3_h(member, rates[member.crew_id]) for member in state.operational.activity)


def test_private_record_does_not_change_operation_revision():
    state, rates = golden_state()
    basis_before = state.operational
    generation_before = total_generation(state, rates)
    check_in = PrivateCheckIn(
        check_in_id="checkin-sim01-01", crew_id="SIM-01", mission_s=780,
        note=f"{MARKER}: mild headache after the scrubber drill (fictional)",
    )

    recorded = record_check_in(state, check_in)

    notes = read_check_ins(recorded, "SIM-01")
    assert [note.note for note in notes] == [check_in.note]
    assert notes[0].mission_s == 780
    assert notes[0].authorized_crew_ids == ("SIM-01",)
    assert notes[0].visibility == "onboard_private" and notes[0].synthetic is True
    assert recorded.operational is basis_before
    assert recorded.operational == basis_before
    assert recorded.operational.decision_rev == 103
    assert total_generation(recorded, rates) == pytest.approx(generation_before) == pytest.approx(0.04)
    assert MARKER not in repr(recorded.operational)
    assert MARKER not in repr(recorded)
    assert state.private.records == ()


def test_only_authorized_crew_read_the_check_in():
    state, _ = golden_state()
    check_in = PrivateCheckIn("checkin-sim01-01", "SIM-01", 780, f"{MARKER} (fictional)")
    recorded = record_check_in(state, check_in)

    assert read_check_ins(recorded, "SIM-02") == ()
    with pytest.raises(PermissionError):
        read_check_ins(recorded, "GROUND")

    shared = record_check_in(state, replace(check_in, authorized_crew_ids=("SIM-01", "SIM-03")))
    assert [note.crew_id for note in read_check_ins(shared, "SIM-03")] == ["SIM-01"]


def test_check_in_validation_and_idempotency():
    state, _ = golden_state()
    check_in = PrivateCheckIn("checkin-sim01-01", "SIM-01", 780, f"{MARKER} (fictional)")
    recorded = record_check_in(state, check_in)

    assert record_check_in(recorded, check_in) is recorded
    with pytest.raises(ValueError, match="already used"):
        record_check_in(recorded, replace(check_in, note="different"))
    with pytest.raises(ValueError, match="synthetic"):
        record_check_in(state, replace(check_in, synthetic=False))
    with pytest.raises(ValueError, match="roster"):
        record_check_in(state, replace(check_in, crew_id="SIM-99"))
    with pytest.raises(ValueError, match="own check-in"):
        record_check_in(state, replace(check_in, authorized_crew_ids=("SIM-02",)))
    with pytest.raises(ValueError, match="onboard crew"):
        record_check_in(state, replace(check_in, authorized_crew_ids=("SIM-01", "GROUND")))
    with pytest.raises(ValueError, match="mission seconds"):
        record_check_in(state, replace(check_in, mission_s=-1))
    with pytest.raises(ValueError, match="note"):
        record_check_in(state, replace(check_in, note="  "))


def sim01_rule():
    baseline = load_profile().baselines[0]
    assert (baseline.metric, baseline.unit, baseline.value) == ("heart_rate", "bpm", 72)
    return resting_hr_rule(baseline.value)


def test_baseline_alert_and_unknown():
    rule = sim01_rule()
    valid = SIM01_BASELINE_REPLAY[:-1]
    missing = SIM01_BASELINE_REPLAY[-1]
    assert all(s.synthetic and s.quality == "valid" for s in valid)
    assert missing.quality == "unavailable" and missing.value_bpm is None

    alert = evaluate_baseline(valid, rule, crew_id="SIM-01", now_s=780)
    assert alert.signal == "alert"
    assert alert.reason_code == "RESTING_HR_ABOVE_BASELINE"
    assert "95, 97, 98 bpm" in alert.reason and "72 bpm personal baseline" in alert.reason
    assert alert.quality == "valid"
    assert alert.threshold_bpm == 92
    assert alert.evidence_ids == ("hr-sim01-0660", "hr-sim01-0720", "hr-sim01-0780")
    assert alert.last_good_sample.sample_id == "hr-sim01-0780"
    assert alert.visibility == "onboard_private"

    unknown = evaluate_baseline(SIM01_BASELINE_REPLAY, rule, crew_id="SIM-01", now_s=840)
    assert unknown.signal == "unknown"
    assert unknown.reason_code == "LATEST_SAMPLE_MISSING"
    assert unknown.quality == "unavailable"
    assert unknown.last_good_sample == valid[-1]
    assert unknown.last_good_sample.value_bpm == 98
    assert unknown.evidence_ids == ()


def test_baseline_rule_counts_only_consecutive_fresh_resting_samples():
    rule = sim01_rule()
    replay = SIM01_BASELINE_REPLAY[:-1]

    two = evaluate_baseline(replay[:3], rule, crew_id="SIM-01", now_s=720)
    assert (two.signal, two.reason_code) == ("within_baseline", "NOT_ENOUGH_CONSECUTIVE_SAMPLES")
    calm = evaluate_baseline(replay[:1], rule, crew_id="SIM-01", now_s=600)
    assert (calm.signal, calm.reason_code) == ("within_baseline", "WITHIN_BASELINE")
    assert evaluate_baseline(replay, rule, crew_id="SIM-01", now_s=780 + 181).reason_code == "LATEST_SAMPLE_STALE"
    assert evaluate_baseline((), rule, crew_id="SIM-01", now_s=0).reason_code == "NO_SAMPLES"
    # Samples after now_s are not yet known.
    assert evaluate_baseline(replay, rule, crew_id="SIM-01", now_s=720).signal == "within_baseline"

    gap = (*replay[:3], replace(replay[3], sample_id="late", mission_s=900))
    assert evaluate_baseline(gap, rule, crew_id="SIM-01", now_s=900).signal == "within_baseline"
    exercise = (replay[0], replace(replay[1], activity="exercise"), *replay[2:])
    assert evaluate_baseline(exercise, rule, crew_id="SIM-01", now_s=780).signal == "within_baseline"
    latest_exercise = (*replay[:3], replace(replay[3], activity="exercise"))
    assert evaluate_baseline(latest_exercise, rule, crew_id="SIM-01", now_s=780).reason_code == (
        "LATEST_SAMPLE_NOT_AT_REST")
    suspect = (*replay[:3], replace(replay[3], quality="suspect"))
    result = evaluate_baseline(suspect, rule, crew_id="SIM-01", now_s=780)
    assert (result.signal, result.reason_code) == ("unknown", "LATEST_SAMPLE_NOT_VALID")
    assert result.last_good_sample.sample_id == "hr-sim01-0720"


def test_baseline_rejects_foreign_or_non_synthetic_samples():
    rule = sim01_rule()
    sample = SIM01_BASELINE_REPLAY[0]
    for bad, message in (
        (replace(sample, crew_id="SIM-02"), "crew member"),
        (replace(sample, synthetic=False), "synthetic"),
        (replace(sample, unit="bps"), "bpm"),
        (replace(sample, value_bpm=None), "finite"),
        (replace(sample, value_bpm=float("nan")), "finite"),
        (replace(sample, mission_s=-1), "mission seconds"),
    ):
        with pytest.raises(ValueError, match=message):
            evaluate_baseline((bad,), rule, crew_id="SIM-01", now_s=600)
    assert isinstance(sample, HeartRateSample)

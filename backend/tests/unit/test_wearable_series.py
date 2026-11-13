"""KAN-134: deterministic private wearable replay without a running service."""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "backend" / "src"))

from symbiosis_x.crew.wearable_series import (
    BACK_POD_SOURCE,
    WRISTBAND_SOURCE,
    load_wearable_fixture,
    recheck_observation,
    wearable_deliveries,
    wearable_reading_at,
)

RUN = {"run_id": "wearable-unit-run", "crew_id": "SIM-01"}
EXPECTED = json.loads((ROOT / "scenarios/expected/crew-wearables-v1.json").read_text(encoding="utf-8"))


def wrist_at(fixture, deliveries, mission_s):
    return wearable_reading_at(
        deliveries, **RUN, source_id=WRISTBAND_SOURCE, metric="heart_rate",
        mission_s=mission_s, max_age_s=fixture["freshness_s"],
    )


def sample_id(sample):
    return sample.event_id.rsplit(":", 1)[1]


def test_dropout_and_late_sample_preserve_last_accepted_wearable_reading():
    fixture = load_wearable_fixture()
    deliveries = wearable_deliveries(fixture, **RUN, through_s=100)
    assert [sample_id(sample) for sample in deliveries] == EXPECTED["delivery_order"]
    first, gap, restored, duplicate, late, motion, suspect = deliveries
    assert restored == duplicate
    assert len({sample.event_id for sample in deliveries}) == EXPECTED["unique_stream_count"]
    assert gap.value is None and gap.quality == "unavailable"
    assert gap.context["reason_code"] == "DEVICE_DISCONNECTED"
    assert late.quality == "valid" and late.observed_at_s < restored.observed_at_s < late.received_at_s
    assert (first.source_id, first.metric, first.unit) == (WRISTBAND_SOURCE, "heart_rate", "bpm")
    assert (motion.source_id, motion.metric, motion.unit) == (BACK_POD_SOURCE, "motion_speed", "m/s")
    assert (motion.quality, motion.context["activity"]) == ("valid", "exercise")
    assert suspect.quality == "suspect"
    assert suspect.context["reason_code"] == "MOTION_ARTIFACT"
    assert suspect.context["motion_event_id"] == motion.event_id
    assert suspect.context["activity"] == "exercise"

    for expected in EXPECTED["wrist_checkpoints"]:
        reading = wrist_at(fixture, deliveries, expected["mission_s"])
        assert reading.accepted is not None
        assert (reading.status, reading.accepted.value, reading.accepted.observed_at_s, reading.age_s) == (
            expected["status"], expected["value"], expected["observed_at_s"], expected["age_s"],
        )
        assert (sample_id(reading.evidence) if reading.evidence else None) == expected["evidence"]


def test_seeded_wearable_series_is_repeatable():
    first, second = load_wearable_fixture(), load_wearable_fixture()
    assert first["seed"] == second["seed"] == EXPECTED["seed"]
    whole = wearable_deliveries(first, **RUN, through_s=100)
    stepped = (
        wearable_deliveries(second, **RUN, through_s=10)
        + wearable_deliveries(second, **RUN, after_s=10, through_s=59)
        + wearable_deliveries(second, **RUN, after_s=59, through_s=100)
    )
    assert whole == stepped
    assert not any(sample_id(sample) == "wrist-delayed" for sample in wearable_deliveries(first, **RUN, through_s=59))
    assert [sample_id(sample) for sample in wearable_deliveries(first, **RUN, after_s=59, through_s=60)] == ["wrist-delayed"]
    assert all(
        sample.synthetic and sample.visibility == "crew"
        and (sample.run_id, sample.crew_id) == (RUN["run_id"], RUN["crew_id"])
        for sample in whole
    )

    for mission_s, status in ((70, "missing"), (71, "accepted")):
        motion = wearable_reading_at(
            whole, **RUN, source_id=BACK_POD_SOURCE, metric="motion_speed",
            mission_s=mission_s, max_age_s=first["freshness_s"],
        )
        assert motion.status == status
    assert motion.accepted is not None and motion.age_s == 1
    assert wearable_reading_at(
        whole, run_id=RUN["run_id"], crew_id="SIM-02", source_id=WRISTBAND_SOURCE,
        metric="heart_rate", mission_s=100, max_age_s=first["freshness_s"],
    ).status == "missing"


def test_repeat_is_separate_and_links_to_suspect_evidence():
    fixture = load_wearable_fixture()
    expected = EXPECTED["recheck"]
    mission_s = expected["mission_s"]
    automatic = wearable_deliveries(fixture, **RUN, through_s=mission_s)
    flagged = wrist_at(fixture, automatic, mission_s).evidence
    repeat = recheck_observation(fixture, **RUN)
    assert repeat not in automatic
    assert flagged is not None
    assert sample_id(flagged) == expected["repeat_of_sample_id"]
    assert sample_id(repeat) == expected["sample_id"]
    assert repeat.visibility == "crew" and repeat.synthetic
    assert repeat.context["sample_role"] == "recheck_repeat"
    assert repeat.context["repeat_of_event_id"] == flagged.event_id
    assert repeat.context["activity"] == flagged.context["activity"]
    assert (repeat.source_id, repeat.metric, repeat.unit) == (flagged.source_id, flagged.metric, flagged.unit)
    with_repeat = (*automatic, repeat)
    assert wrist_at(fixture, with_repeat, mission_s - 1).evidence == flagged
    resolved = wrist_at(fixture, with_repeat, mission_s)
    assert resolved.accepted == repeat and resolved.evidence is None
    assert (resolved.status, repeat.value, resolved.age_s) == (expected["status"], expected["value"], expected["age_s"])

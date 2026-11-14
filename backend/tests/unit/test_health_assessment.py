"""SX-23D: personal baseline and sourced reference are assessed independently."""

import json
import sys
from pathlib import Path
from urllib.parse import urlparse

import pytest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "backend" / "src"))
from symbiosis_x.crew.assessment import assess, load_rules
from symbiosis_x.crew.wellbeing import SIM01_BASELINE_REPLAY

RULES = load_rules()
VERSION = "health-reference-rules-v1"


def seeded_resting_hr(**change):
    sample = next(s for s in SIM01_BASELINE_REPLAY if s.sample_id == "hr-sim01-0660")
    payload = {"metric": "heart_rate", "value": sample.value_bpm, "unit": "bpm",
               "observed_at_s": sample.mission_s, "source_id": sample.source_id, "quality": sample.quality}
    return payload | change


def test_baseline_and_reference_are_separate():
    # Out of baseline: the seeded 95 bpm resting reading leaves the personal range
    # but stays inside the Earth-based adult reference. Neither result overrides the other.
    result = assess(seeded_resting_hr(), context={"activity": "rest"})
    personal, reference = result.personal, result.reference
    assert personal.status == "outside_personal_range"
    assert personal.reason_code == "ABOVE_PERSONAL_RANGE"
    assert (personal.range_low, personal.range_high, personal.unit) == (57, 87, "bpm")
    assert "95 bpm is above the personal range 57–87 bpm" in personal.reason
    assert "72 bpm resting baseline (+23 bpm)" in personal.reason
    assert personal.rule_id == "personal-hr-rest-v1" and personal.rules_version == VERSION
    assert personal.earth_based is False

    assert reference.status == "within_reference"
    assert (reference.range_low, reference.range_high) == (60, 100)
    assert reference.earth_based is True and "Earth-based" in reference.label
    assert reference.rule_id == "ref-hr-adult-rest-v1" and reference.rules_version == VERSION
    assert reference.source["url"].startswith("https://medlineplus.gov/")
    assert result.evidence == {
        "source_id": "synthetic.sim-01-wrist-hr", "observed_at_s": 660, "quality": "valid",
        "context": {"activity": "rest"}, "value": 95.0, "unit": "bpm",
    }
    assert result.crew_id == "SIM-01" and result.visibility == "onboard_private"
    assert not hasattr(result, "overall")

    # Applicable reference: a fasting lab plasma glucose is compared with the sourced cutoffs.
    glucose = {"metric": "glucose", "value": 110, "unit": "mg/dL", "observed_at_s": 900,
               "source_id": "synthetic.lab", "quality": "valid",
               "method": "lab_plasma", "meal_context": "fasting"}
    lab = assess(glucose)
    assert lab.reference.status == "outside_reference"
    assert lab.reference.category == "prediabetes_range"
    assert lab.reference.earth_based is True
    assert lab.personal.status == "baseline_unavailable"

    # Missing context never produces a normal assessment, on either side.
    missing = assess(seeded_resting_hr(value=72))
    for side in (missing.personal, missing.reference):
        assert side.status == "unknown" and side.reason_code == "MISSING_CONTEXT"
        assert "activity" in side.reason
    no_posture = assess({"metric": "blood_pressure", "systolic": 112, "diastolic": 72, "unit": "mmHg",
                         "observed_at_s": 900, "source_id": "synthetic.cuff", "quality": "valid"},
                        context={"method": "automatic_upper_arm_cuff"})
    assert no_posture.reference.status == "unknown"
    assert no_posture.reference.reason_code == "MISSING_CONTEXT"

    # Rejected quality is never compared.
    rejected = assess(seeded_resting_hr(quality="suspect"), context={"activity": "rest"})
    for side in (rejected.personal, rejected.reference):
        assert side.status == "unknown" and side.reason_code == "QUALITY_REJECTED"
    assert rejected.evidence["quality"] == "suspect"


def test_lab_glucose_cutoffs_are_not_applied_to_a_handheld_reading():
    reading = {"metric": "glucose", "value": 140, "unit": "mg/dL", "observed_at_s": 900,
               "source_id": "synthetic.meter", "quality": "valid",
               "method": "meter", "meal_context": "fasting"}
    result = assess(reading)
    assert result.reference.status == "reference_unavailable"
    assert result.reference.reason_code == "LAB_CUTOFF_NOT_FOR_HANDHELD"
    assert result.reference.category is None

    after_meal = assess(reading | {"method": "lab_plasma", "meal_context": "two_hours_after_meal"})
    assert after_meal.reference.status == "reference_unavailable"
    assert after_meal.reference.reason_code == "CONTEXT_NOT_SUPPORTED"
    assert assess(reading | {"method": "lab_plasma", "value": 92}).reference.status == "within_reference"
    assert assess(reading | {"method": "lab_plasma", "value": 126}).reference.category == "diabetes_range"


def test_context_mismatch_and_other_references():
    exercise = assess(seeded_resting_hr(), context={"activity": "exercise"})
    assert exercise.personal.status == "unknown"
    assert exercise.reference.status == "reference_unavailable"

    cuff = {"metric": "blood_pressure", "unit": "mmHg", "observed_at_s": 900,
            "source_id": "synthetic.cuff", "quality": "valid"}
    seated = {"method": "automatic_upper_arm_cuff", "posture": "seated_rested"}
    for systolic, diastolic, category, status in (
        (112, 72, "normal", "within_reference"), (124, 76, "elevated", "outside_reference"),
        (132, 78, "stage_1_hypertension", "outside_reference"),
        (118, 92, "stage_2_hypertension", "outside_reference"),
        (185, 100, "severe_hypertension", "outside_reference"),
    ):
        result = assess(cuff | {"systolic": systolic, "diastolic": diastolic}, context=seated)
        assert (result.reference.category, result.reference.status) == (category, status)
    wrist = assess(cuff | {"systolic": 112, "diastolic": 72}, context=seated | {"method": "wrist_cuff"})
    assert wrist.reference.status == "reference_unavailable"

    temperature = {"metric": "temperature", "unit": "°C", "observed_at_s": 900, "source_id": "synthetic.thermo",
                   "quality": "valid", "method": "digital_thermometer"}
    assert assess(temperature | {"value": 36.8, "site": "oral"}).reference.status == "within_reference"
    fever = assess(temperature | {"value": 38.4, "site": "oral"}).reference
    assert (fever.status, fever.category) == ("outside_reference", "above_fever_threshold")
    armpit = assess(temperature | {"value": 36.8, "site": "armpit"}).reference
    assert armpit.status == "reference_unavailable"


@pytest.mark.parametrize("payload", [
    {"metric": "sleep", "duration_min": 300},
    {"metric": "mood", "score": 2, "scale_id": "mood-1-to-5-v1", "unit": "score"},
    {"metric": "symptoms", "symptoms": ["headache"], "private_text": "SX01_PRIVATE_CREW_MARKER"},
])
def test_sleep_mood_and_symptoms_stay_contextual(payload):
    result = assess(payload | {"observed_at_s": 900, "source_id": "synthetic.self-report", "quality": "valid"})
    assert result.personal.status == result.reference.status == "contextual"
    assert result.reference.earth_based is False
    assert "SX01_PRIVATE_CREW_MARKER" not in json.dumps(result.evidence)


def test_reference_rules_catalog_is_sourced_and_versioned():
    assert RULES["rules_version"] == VERSION
    metrics = {m["id"] for m in json.loads((ROOT / "catalogs/crew/health-metrics.json").read_text())["metrics"]}
    covered = {r["metric"] for r in RULES["reference_rules"]} | {c["metric"] for c in RULES["contextual_metrics"]}
    assert covered == metrics | {"sleep_quality"}
    for rule in RULES["reference_rules"]:
        assert rule["earth_based"] is True and rule["requires_context"]
        assert urlparse(rule["source"]["url"]).scheme == "https"
        assert rule["source"]["version"]

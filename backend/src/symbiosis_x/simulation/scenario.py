"""Versioned golden cabin scenario registry with explicit, synthetic timeline."""

import json
from pathlib import Path

GOLDEN_SCENARIO = ("sx01-golden", "1")
GOLDEN_STEPS_S = (0, 60, 360, 480, 600, 780, 900)
DEFAULT_MANIFEST_PATH = (
    Path(__file__).resolve().parents[4] / "scenarios" / "sx01-golden-v1.json"
)


def load_golden_manifest(path: str | Path | None = None) -> dict:
    """Read the frozen golden scenario and reject malformed/foreign fixtures."""
    filename = Path(path) if path is not None else DEFAULT_MANIFEST_PATH
    source = json.loads(filename.read_text(encoding="utf-8"))
    if (source.get("scenario_id"), source.get("scenario_version")) != GOLDEN_SCENARIO:
        raise ValueError("GOLDEN_SCENARIO_MISMATCH")
    if source.get("synthetic") is not True or source.get("noise") != "off":
        raise ValueError("GOLDEN_MUST_BE_DETERMINISTIC")
    if source.get("seed") != 4242 or source.get("policy_version") != "demo-1":
        raise ValueError("GOLDEN_FIXTURE_MISMATCH")
    if source.get("end_s") != GOLDEN_STEPS_S[-1]:
        raise ValueError("GOLDEN_TIMELINE_MISMATCH")
    return source


ORGANIZER_SCENARIO = ("organizer-replay", "1")
ORGANIZER_MANIFEST_PATH = (
    Path(__file__).resolve().parents[4] / "scenarios" / "variants" / "organizer-replay.json"
)


def load_organizer_manifest(path: str | Path | None = None) -> dict:
    """Pin a synthetic-only incoming-data variant; never claim organizer approval."""
    from symbiosis_x.telemetry.adapters import normalize_incoming_co2

    source = json.loads(
        (Path(path) if path is not None else ORGANIZER_MANIFEST_PATH).read_text(encoding="utf-8")
    )
    if (source.get("scenario_id"), source.get("scenario_version")) != ORGANIZER_SCENARIO:
        raise ValueError("ORGANIZER_SCENARIO_MISMATCH")
    if source.get("synthetic") is not True or source.get("approved_organizer_data") is not False:
        raise ValueError("SYNTHETIC_TEST_DATA_ONLY")
    if (source.get("provenance"), source.get("seed"), source.get("noise")) != (
        "synthetic_test_fixture", 4242, "off"
    ):
        raise ValueError("ORGANIZER_FIXTURE_MISMATCH")
    if source.get("model_version") != "cabin-1" or source.get("policy_version") != "demo-1":
        raise ValueError("ORGANIZER_MODEL_MISMATCH")
    if source.get("start_s") != 0 or source.get("end_s") != GOLDEN_STEPS_S[-1]:
        raise ValueError("ORGANIZER_TIMELINE_MISMATCH")
    normalized = [
        normalize_incoming_co2(sample) for sample in source.get("incoming_observations", [])
    ]
    if [sample["observed_at_s"] for sample in normalized] != [60, 600, 780, 900]:
        raise ValueError("ORGANIZER_SAMPLE_TIMES_MISMATCH")
    if any(sample["quality"] != "valid" for sample in normalized):
        raise ValueError("ORGANIZER_TEST_REQUIRES_VALID_SAMPLES")
    power = source.get("power_headroom_kw", {})
    for field in ("initial", "degraded"):
        value = power.get(field)
        if type(value) not in (int, float) or not 0 <= value <= 1:
            raise ValueError("INVALID_SYNTHETIC_HEADROOM")
    return source


HEALTH_STORY_SCENARIO = ("health-story", "1")
HEALTH_STORY_MEASUREMENT_PREFIX = "health-story-v1:"
HEALTH_STORY_PATH = DEFAULT_MANIFEST_PATH.parent / "variants" / "health-story-v1.json"


def load_health_story_manifest() -> dict:
    """Read the versioned, Crew-private training fixture."""
    fixture = json.loads(HEALTH_STORY_PATH.read_text(encoding="utf-8"))
    if (
        (fixture.get("scenario_id"), fixture.get("scenario_version")) != HEALTH_STORY_SCENARIO
        or fixture.get("schema_version") != 1
        or fixture.get("seed") != 4242
        or fixture.get("synthetic") is not True
        or fixture.get("visibility") != "crew"
        or fixture.get("training_scope") != "simulated_training_only"
    ):
        raise ValueError("HEALTH_STORY_FIXTURE_MISMATCH")
    previous = -1
    ids = set()
    for sample in fixture["readings"]:
        observed, received = sample["observed_at_s"], sample["received_at_s"]
        sample_id = sample["measurement_id"]
        if (
            type(observed) is not int or type(received) is not int
            or not 0 <= observed <= received or received <= previous
            or not sample_id.startswith(HEALTH_STORY_MEASUREMENT_PREFIX) or sample_id in ids
        ):
            raise ValueError("HEALTH_STORY_READING_MISMATCH")
        ids.add(sample_id)
        previous = received
    if not fixture["readings"] or fixture["readings"][0]["received_at_s"] != 0:
        raise ValueError("HEALTH_STORY_BASELINE_REQUIRED")
    return fixture

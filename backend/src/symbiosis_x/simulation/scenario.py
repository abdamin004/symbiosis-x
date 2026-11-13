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

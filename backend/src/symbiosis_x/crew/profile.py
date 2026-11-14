"""Load and validate fictional Crew health profiles."""

import json
from datetime import date
from pathlib import Path
from typing import Literal

from pydantic import Field, model_validator

from symbiosis_x.contracts.events import Contract, Identifier, NonnegativeNumber


class HistoryEntry(Contract):
    date: date
    category: Literal["medical_history", "allergy_note", "preflight_followup"]
    note: Identifier
    fictional: Literal[True]


class HealthHistory(Contract):
    status: Literal["unknown", "recorded"]
    entries: list[HistoryEntry] = Field(default_factory=list)

    @model_validator(mode="after")
    def history_matches_status(self):
        if bool(self.entries) != (self.status == "recorded"):
            raise ValueError("recorded history requires entries and unknown history has none")
        return self


class PersonalBaseline(Contract):
    metric: Literal["heart_rate", "blood_pressure", "glucose", "temperature",
                    "sleep", "sleep_quality", "mood", "symptoms"]
    value: NonnegativeNumber
    unit: Literal["bpm", "mmHg", "mg/dL", "°C", "min", "score", "count"]
    context: Identifier
    source_id: Identifier
    diastolic: NonnegativeNumber | None = None

    @model_validator(mode="after")
    def units_and_shape(self):
        units = {"heart_rate": "bpm", "blood_pressure": "mmHg", "glucose": "mg/dL",
                 "temperature": "°C", "sleep": "min", "sleep_quality": "score",
                 "mood": "score", "symptoms": "count"}
        if self.unit != units[self.metric] or (self.diastolic is not None) != (self.metric == "blood_pressure"):
            raise ValueError("baseline unit or shape does not match its metric")
        if self.diastolic is not None and not 0 < self.diastolic < self.value:
            raise ValueError("blood pressure baseline requires systolic above diastolic")
        return self


class AstronautHealthProfile(Contract):
    schema_version: Literal[1]
    profile_id: Identifier
    crew_id: Identifier
    display_name: Identifier
    simulated: Literal[True]
    history: HealthHistory
    baselines: list[PersonalBaseline] = Field(default_factory=list)


DEFAULT_PROFILE_PATH = (
    Path(__file__).resolve().parents[4]
    / "catalogs"
    / "crew"
    / "sim-01-health.json"
)


def load_profile(path: str | Path | None = None) -> AstronautHealthProfile:
    """Read the JSON fixture and return a validated profile."""
    profile_path = Path(path) if path is not None else DEFAULT_PROFILE_PATH
    return AstronautHealthProfile.model_validate_json(profile_path.read_text(encoding="utf-8"))


def profile_for_crew(crew_id: str) -> AstronautHealthProfile | None:
    if crew_id == "SIM-01":
        return load_profile()
    catalog = DEFAULT_PROFILE_PATH.parent
    roster = json.loads((catalog / "synthetic-roster.json").read_text(encoding="utf-8"))["crew"]
    member = next((row for row in roster if row["crew_id"] == crew_id), None)
    if member is None:
        return None
    profiles = json.loads((catalog / "selected-crew-health.json").read_text(encoding="utf-8"))
    payload = profiles.get(crew_id, {})
    return AstronautHealthProfile.model_validate_json(json.dumps({
        "schema_version": 1, "profile_id": f"{crew_id.lower()}-health-v1", "crew_id": crew_id,
        "display_name": member["display_name"], "simulated": True,
        "history": payload.get("history", {"status": "unknown"}), "baselines": payload.get("baselines", []),
    }))

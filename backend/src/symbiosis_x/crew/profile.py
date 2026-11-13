"""Load and validate fictional Crew health profiles."""

import json
from pathlib import Path
from typing import Literal

from pydantic import Field, model_validator

from symbiosis_x.contracts.events import Contract, Identifier, NonnegativeNumber


class HealthHistory(Contract):
    status: Literal["unknown"]
    entries: list[dict] = Field(default_factory=list)

    @model_validator(mode="after")
    def unknown_history_has_no_entries(self):
        if self.entries:
            raise ValueError("unknown history cannot contain entries")
        return self


class PersonalBaseline(Contract):
    metric: Literal["heart_rate"]
    value: NonnegativeNumber
    unit: Literal["bpm"]
    context: Identifier
    source_id: Identifier


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
    payload = json.loads(profile_path.read_text(encoding="utf-8"))
    return AstronautHealthProfile.model_validate(payload)


def profile_for_crew(crew_id: str) -> AstronautHealthProfile | None:
    if crew_id == "SIM-01":
        return load_profile()
    catalog = DEFAULT_PROFILE_PATH.parent
    roster = json.loads((catalog / "synthetic-roster.json").read_text(encoding="utf-8"))["crew"]
    member = next((row for row in roster if row["crew_id"] == crew_id), None)
    if member is None:
        return None
    profiles = json.loads((catalog / "selected-crew-health.json").read_text(encoding="utf-8"))
    return AstronautHealthProfile(
        schema_version=1, profile_id=f"{crew_id.lower()}-health-v1", crew_id=crew_id,
        display_name=member["display_name"], simulated=True, history=HealthHistory(status="unknown"),
        baselines=[PersonalBaseline.model_validate(baseline) for baseline in profiles.get(crew_id, [])],
    )

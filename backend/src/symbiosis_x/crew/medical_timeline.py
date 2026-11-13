"""Private authored Medical training histories on the synthetic run clock."""

from pathlib import Path
from typing import Literal

from symbiosis_x.contracts.events import Contract, Identifier, NonnegativeInt

FIXTURE_PATH = Path(__file__).resolve().parents[4] / "scenarios/variants/medical-timeline-v1.json"


class HistoryNote(Contract):
    kind: Literal["medical_history", "allergy_note"]
    note: str


class TimelineEntry(Contract):
    at_s: NonnegativeInt
    kind: Literal["symptom", "observation", "review", "recheck"]
    quality: Literal["reported", "observed", "unknown", "uncertain", "conflicting"]
    note: str


class MedicalCase(Contract):
    id: Literal["inflammation", "sensitivity", "illness"]
    crew_id: Identifier
    label: str
    history: list[HistoryNote]
    events: list[TimelineEntry]


class GeneticsNote(Contract):
    crew_id: Identifier
    inherited_trait: str
    expression_observation: str


class MedicalTimeline(Contract):
    schema_version: Literal[1]
    source_id: Literal["synthetic.medical-timeline-v1"]
    cases: list[MedicalCase]
    genetics_note: GeneticsNote | None = None


def read_medical_timeline(crew_id: str, mission_s: int) -> MedicalTimeline:
    timeline = MedicalTimeline.model_validate_json(FIXTURE_PATH.read_text(encoding="utf-8"))
    timeline.cases = [case for case in timeline.cases if case.crew_id == crew_id]
    if timeline.genetics_note and timeline.genetics_note.crew_id != crew_id:
        timeline.genetics_note = None
    for case in timeline.cases:
        case.events = [event for event in case.events if event.at_s <= mission_s]
    return timeline

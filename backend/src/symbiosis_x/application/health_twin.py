"""Crew-only health story assembled from the existing onboard projections."""

from sqlite3 import Connection
from typing import Literal

from symbiosis_x.application.projections import read_crew
from symbiosis_x.contracts.events import Contract, Identifier, NonnegativeInt
from symbiosis_x.contracts.projections import RunView
from symbiosis_x.crew.emergency import EmergencyCase
from symbiosis_x.crew.gravity_context import GravityContext, project_gravity_context
from symbiosis_x.crew.medical_timeline import MedicalTimeline, read_medical_timeline
from symbiosis_x.simulation.scenario import HEALTH_STORY_SCENARIO, load_health_story_manifest
from symbiosis_x.workflows.relay import read_case_delivery

StoryState = Literal["unobserved", "clear", "insufficient", "review", "emergency"]


class CaseDelivery(Contract):
    status: Literal["not_shared", "queued", "delivered"]
    issued_at_s: NonnegativeInt | None = None
    deliver_at_s: NonnegativeInt | None = None
    delivered_at_s: NonnegativeInt | None = None
    remaining_s: NonnegativeInt | None = None


class CrewHealthTwin(RunView):
    role: Literal["crew"] = "crew"
    synthetic: Literal[True] = True
    crew_id: Identifier
    story_state: StoryState
    health_assessment: dict | None
    health_trend: dict | None
    health_followup: dict | None
    emergency: EmergencyCase | None
    ground_delivery: CaseDelivery | None
    gravity_context: GravityContext | None
    medical_timeline: MedicalTimeline | None


def _story_state(assessment: dict | None, trend: dict | None, emergency: EmergencyCase | None) -> StoryState:
    if emergency is not None:
        return "emergency"
    if assessment is None:
        return "unobserved"
    comparison = assessment["personal"]
    if comparison["status"] == "within_personal_range":
        return "clear"
    if (
        comparison["status"] == "outside_personal_range" and trend
        and trend["metric"] == assessment["metric"] and trend["status"] != "insufficient_history"
    ):
        return "review"
    return "insufficient"


def read_health_twin(db: Connection, run_id: str, crew_id: str) -> CrewHealthTwin:
    crew = read_crew(db, run_id, crew_id)
    emergency = delivery = None
    case = (crew.health_followup or {}).get("emergency")
    if case:
        row = db.execute(
            "SELECT case_json FROM emergency_cases WHERE run_id = ? AND case_id = ? AND visibility = 'crew'",
            (run_id, case["case_id"]),
        ).fetchone()
        emergency = EmergencyCase.model_validate_json(row["case_json"])
        share = read_case_delivery(db, run_id, emergency.case_id)
        if share is None:
            delivery = CaseDelivery(status="not_shared")
        else:
            delivered = share["delivered_at_s"]
            delivery = CaseDelivery(
                status="queued" if delivered is None else "delivered",
                **dict(share),
                remaining_s=max(0, share["deliver_at_s"] - crew.mission_s),
            )

    gravity = medical_timeline = None
    if (crew.scenario_id, crew.scenario_version) == HEALTH_STORY_SCENARIO:
        gravity = project_gravity_context(load_health_story_manifest(), crew_id, crew.mission_s)
        medical_timeline = read_medical_timeline(crew_id, crew.mission_s)

    return CrewHealthTwin(
        run_id=run_id, scenario_id=crew.scenario_id, scenario_version=crew.scenario_version,
        mission_s=crew.mission_s, status=crew.status, crew_id=crew_id,
        story_state=_story_state(crew.health_assessment, crew.health_trend, emergency),
        health_assessment=crew.health_assessment, health_trend=crew.health_trend,
        health_followup=crew.health_followup, emergency=emergency, ground_delivery=delivery,
        gravity_context=gravity,
        medical_timeline=medical_timeline,
    )

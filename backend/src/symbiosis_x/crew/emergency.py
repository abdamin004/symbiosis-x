"""Route scripted onboard emergency drills to a local responder.

Two scripted drills exist: chest pain, reported directly by the affected crew
member, and collapse, reported by a bystander with a responsiveness field. An
authorized Crew request opens one case per drill per run, assigns the scripted
local responder, surfaces source-backed training guidance and raises a local alert. Escalation never
depends on vital readings or the Ground relay: opening a case reads no relay
messages and writes nothing for Ground, so it works during a blackout. Unknown
responsiveness stays visible and never blocks the alert. Training scope only.
"""

import json
from functools import lru_cache
from hashlib import sha256
from pathlib import Path
from sqlite3 import Connection
from typing import Literal

from pydantic import Field, StrictBool

from symbiosis_x.application.runs import RunConflict, RunNotFound, load_active_run, next_event_seq
from symbiosis_x.contracts.events import Contract, Identifier
from symbiosis_x.storage.repository import Repository

DRILLS_PATH = (
    Path(__file__).resolve().parents[4] / "scenarios" / "variants" / "health-emergency-drills.json"
)
ROSTER_PATH = Path(__file__).resolve().parents[4] / "catalogs" / "crew" / "synthetic-roster.json"

Kind = Literal["chest_pain", "collapse"]
Responsiveness = Literal["responsive", "unresponsive", "unknown"]


class EmergencyNotFound(Exception):
    """The run, drill or case does not exist; the message is a reason code."""


class EmergencyConflict(Exception):
    """The request conflicts with stored state; the message is a reason code."""


class EmergencyRejected(Exception):
    """The request is invalid for this drill; the message is a reason code."""


class OpenEmergencyRequest(Contract):
    operation_id: Identifier
    drill_id: Identifier
    reported_by: Identifier
    synthetic: StrictBool
    responsiveness: Responsiveness | None = None
    breathing: Literal["normal", "abnormal", "unknown"] | None = None
    pain_ongoing: Literal["yes", "no", "unknown"] | None = None


class AcknowledgeEmergencyRequest(Contract):
    acknowledged_by: Identifier


class GuidanceQuestion(Contract):
    id: Literal["responsive", "breathing", "pain_ongoing"]
    label: str


class GuidanceSource(Contract):
    title: str
    url: str
    version: str
    accessed_on: str


class Procedure(Contract):
    kind: Literal["approved_reference", "training_placeholder", "training_guidance"]
    ref: Identifier
    label: str
    questions: list[GuidanceQuestion] = Field(default_factory=list)
    guidance: dict[str, list[str]] = Field(default_factory=dict)
    sources: list[GuidanceSource] = Field(default_factory=list)


class Escalation(Contract):
    level: Literal["local_alert"]
    raised_at_s: int = Field(ge=0)
    depends_on_vitals: Literal[False]
    depends_on_relay: Literal[False]


class VitalsStatus(Contract):
    heart_rate: Literal["available", "unavailable"]
    last_valid_observed_at_s: int | None = None


class Acknowledgment(Contract):
    acknowledged_by: Identifier
    acknowledged_at_s: int = Field(ge=0)


class EmergencyCase(Contract):
    case_id: Identifier
    run_id: Identifier
    drill_id: Identifier
    kind: Kind
    status: Literal["open", "acknowledged"]
    opened_at_s: int = Field(ge=0)
    owner: Identifier
    subject_crew_id: Identifier
    reported_by: Identifier
    report_kind: Literal["direct_symptom_report", "bystander_report"]
    report: str
    responsiveness: Responsiveness | None
    assessment: dict[str, Literal["yes", "no", "unknown"]] | None = None
    procedure: Procedure
    escalation: Escalation
    vitals: VitalsStatus
    ground_link: Literal["not_required"]
    acknowledgment: Acknowledgment | None = None
    synthetic: Literal[True]
    visibility: Literal["crew"]


@lru_cache(maxsize=1)
def load_drills(path: str | None = None) -> dict[str, dict]:
    script = json.loads(Path(path or DRILLS_PATH).read_text(encoding="utf-8"))
    if script.get("synthetic") is not True or script.get("training_scope") != "simulated_training_only":
        raise RuntimeError("emergency drills must be synthetic training fixtures")
    escalation = script["escalation"]
    if escalation["depends_on_vitals"] or escalation["depends_on_relay"]:
        raise RuntimeError("drill escalation must not depend on vitals or the relay")
    return {drill["drill_id"]: drill for drill in script["drills"]}


@lru_cache(maxsize=1)
def _roster_ids() -> frozenset[str]:
    roster = json.loads(ROSTER_PATH.read_text(encoding="utf-8"))
    if roster.get("synthetic") is not True:
        raise RuntimeError("crew roster must be synthetic")
    return frozenset(member["crew_id"] for member in roster["crew"])


def _digest(command: OpenEmergencyRequest) -> str:
    # Preserve the digest of previously stored requests and their retries.
    return sha256(command.model_dump_json(exclude={"breathing", "pain_ongoing"}
        if command.breathing is None and command.pain_ongoing is None else None).encode()).hexdigest()


def _vitals(db: Connection, run_id: str, crew_id: str) -> VitalsStatus:
    """Report whether a valid heart rate exists; the result never gates escalation."""
    row = db.execute(
        """SELECT MAX(observed_at_s) FROM health_observations
           WHERE run_id = ? AND crew_id = ? AND metric = 'heart_rate' AND quality = 'valid'""",
        (run_id, crew_id),
    ).fetchone()
    observed = row[0] if row else None
    return VitalsStatus(heart_rate="available" if observed is not None else "unavailable",
                        last_valid_observed_at_s=observed)


def _journal(db: Connection, run_id: str, event_id: str, event_type: str, mission_s: int, payload) -> None:
    db.execute(
        """INSERT INTO events (run_id, event_seq, event_id, event_type, mission_s, visibility, payload_json)
           VALUES (?, ?, ?, ?, ?, 'crew', ?)""",
        (run_id, next_event_seq(db, run_id), event_id, event_type, mission_s,
         json.dumps(payload, separators=(",", ":"), sort_keys=True)),
    )


def open_emergency(
    repository: Repository, run_id: str, command: OpenEmergencyRequest,
) -> tuple[EmergencyCase, bool]:
    """Open the drill's local case once. Returns the case and whether it was created."""
    if command.synthetic is not True:
        raise EmergencyRejected("SYNTHETIC_DRILL_REQUIRED")
    drill = load_drills().get(command.drill_id)
    if drill is None:
        raise EmergencyNotFound("DRILL_NOT_FOUND")
    if command.reported_by not in _roster_ids():
        raise EmergencyRejected("REPORTER_NOT_ON_ROSTER")
    if command.reported_by != drill["reported_by"]:
        raise EmergencyRejected("REPORTER_NOT_IN_DRILL_SCRIPT")
    if drill["kind"] == "chest_pain" and command.responsiveness is not None and command.breathing is None:
        raise EmergencyRejected("RESPONSIVENESS_NOT_USED_FOR_CHEST_PAIN")
    if drill["kind"] == "collapse" and command.pain_ongoing is not None:
        raise EmergencyRejected("PAIN_QUESTION_NOT_USED_FOR_COLLAPSE")

    digest = _digest(command)
    with repository.write() as db:
        try:
            run = load_active_run(db, run_id)
        except RunNotFound as error:
            raise EmergencyNotFound(str(error)) from error
        except RunConflict as error:
            raise EmergencyConflict(str(error)) from error

        prior = db.execute(
            """SELECT operation_id, request_digest, case_json FROM emergency_cases
               WHERE run_id = ? AND (operation_id = ? OR drill_id = ?)""",
            (run_id, command.operation_id, command.drill_id),
        ).fetchall()
        for row in prior:
            if row["operation_id"] == command.operation_id and row["request_digest"] != digest:
                raise EmergencyConflict("OPERATION_ID_REUSED")
        if prior:
            # Opens once: a repeat or a second trigger for the same drill returns the open case.
            return EmergencyCase.model_validate_json(prior[0]["case_json"]), False

        case_id = f"case-{command.drill_id}"
        event_id = f"emergency:{case_id}:opened"
        if db.execute("SELECT 1 FROM events WHERE run_id = ? AND event_id = ?",
                      (run_id, event_id)).fetchone():
            raise EmergencyConflict("EVENT_ID_REUSED")

        opened_at_s = run["mission_s"]
        collapse = drill["kind"] == "collapse"
        assessment = None
        if command.breathing is not None:
            assessment = {
                "responsive": {"responsive": "yes", "unresponsive": "no"}.get(command.responsiveness, "unknown"),
                "breathing": {"normal": "yes", "abnormal": "no"}.get(command.breathing, "unknown"),
            }
            if not collapse:
                assessment["pain_ongoing"] = command.pain_ongoing or "unknown"
        case = EmergencyCase(
            case_id=case_id, run_id=run_id, drill_id=drill["drill_id"], kind=drill["kind"],
            status="open", opened_at_s=opened_at_s, owner=drill["responder_crew_id"],
            subject_crew_id=drill["subject_crew_id"], reported_by=command.reported_by,
            report_kind=drill["report_kind"],
            report=drill["bystander_report"] if collapse else drill["symptom_report"],
            responsiveness=(command.responsiveness or drill["default_responsiveness"]) if collapse else None,
            assessment=assessment,
            procedure=Procedure.model_validate(drill["procedure"]),
            escalation=Escalation(level="local_alert", raised_at_s=opened_at_s,
                                  depends_on_vitals=False, depends_on_relay=False),
            vitals=_vitals(db, run_id, drill["subject_crew_id"]),
            ground_link="not_required", synthetic=True, visibility="crew",
        )
        _journal(db, run_id, event_id, "crew.emergency_opened", opened_at_s,
                 {"case_id": case_id, "drill_id": case.drill_id, "operation_id": command.operation_id})
        db.execute(
            """INSERT INTO emergency_cases
               (run_id, case_id, drill_id, kind, operation_id, request_digest, event_id, opened_at_s,
                subject_crew_id, reported_by, report_kind, responsiveness, responder_crew_id, case_json)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (run_id, case_id, case.drill_id, case.kind, command.operation_id, digest, event_id,
             opened_at_s, case.subject_crew_id, case.reported_by, case.report_kind,
             case.responsiveness, case.owner, case.model_dump_json()),
        )
    return case, True


def acknowledge_emergency(
    repository: Repository, run_id: str, case_id: str, command: AcknowledgeEmergencyRequest,
) -> EmergencyCase:
    """Record the assigned responder's acknowledgment once."""
    with repository.write() as db:
        row = db.execute(
            "SELECT case_json FROM emergency_cases WHERE run_id = ? AND case_id = ?", (run_id, case_id),
        ).fetchone()
        if row is None:
            raise EmergencyNotFound("CASE_NOT_FOUND")
        case = EmergencyCase.model_validate_json(row["case_json"])
        if command.acknowledged_by != case.owner:
            raise EmergencyRejected("NOT_ASSIGNED_RESPONDER")
        if case.acknowledgment is not None:
            return case
        try:
            run = load_active_run(db, run_id)
        except RunConflict as error:
            raise EmergencyConflict(str(error)) from error

        acknowledged = case.model_copy(update={
            "status": "acknowledged",
            "acknowledgment": Acknowledgment(acknowledged_by=command.acknowledged_by,
                                             acknowledged_at_s=run["mission_s"]),
        })
        _journal(db, run_id, f"emergency:{case_id}:acknowledged", "crew.emergency_acknowledged",
                 run["mission_s"], {"case_id": case_id, "acknowledged_by": command.acknowledged_by})
        db.execute(
            """UPDATE emergency_cases SET acknowledged_at_s = ?, acknowledged_by = ?, case_json = ?
               WHERE run_id = ? AND case_id = ?""",
            (run["mission_s"], command.acknowledged_by, acknowledged.model_dump_json(), run_id, case_id),
        )
    return acknowledged


def read_emergency(repository: Repository, run_id: str, case_id: str) -> EmergencyCase:
    with repository.read() as db:
        row = db.execute(
            "SELECT case_json FROM emergency_cases WHERE run_id = ? AND case_id = ?", (run_id, case_id),
        ).fetchone()
    if row is None:
        raise EmergencyNotFound("CASE_NOT_FOUND")
    return EmergencyCase.model_validate_json(row["case_json"])

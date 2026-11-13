"""Monitor: turn an accepted fault event into one operational incident.

Monitor asks the allowlisted ``request_plan_evaluation`` tool for permission,
then opens at most one incident per fault type and component in a run. The
first fault event opens the case and asks the planner to evaluate the three
options; later events for the same fault are linked to that case. The case
names its next owner, plan result and explanation. Fault handling is operational and advisory. The separate wearable rule reads
only private Crew evidence and issues no plant command.
"""

import json
from hashlib import sha256
from sqlite3 import Connection
from typing import Literal

from pydantic import BaseModel, ConfigDict

from symbiosis_x.crew.wearable_series import EVENT_TYPE, WearableObservation, WRISTBAND_SOURCE
from symbiosis_x.twin.constraints import PlanEvaluation
from symbiosis_x.workflows.planner import evaluate_run
from symbiosis_x.workflows.runner import ToolCall, dispatch
from symbiosis_x.workflows.tools import default_registry

NextOwner = Literal["crew", "commander"]


class MonitorDenied(Exception):
    """Monitor will not open an incident for this event; the message is a reason code."""


class CandidateSummary(BaseModel):
    model_config = ConfigDict(frozen=True)

    candidate_id: str
    result: str
    reason_code: str | None
    peak_co2_ppm: float | None


class IncidentCase(BaseModel):
    model_config = ConfigDict(frozen=True)

    incident_id: str
    run_id: str
    trigger_key: str
    component_id: str
    opened_by_event_id: str
    opened_at_s: int
    linked_event_ids: tuple[str, ...]
    next_owner: NextOwner
    plan_status: str
    basis_snapshot_id: str
    basis_decision_rev: int
    candidates: tuple[CandidateSummary, ...]
    explanation: str


def _next_owner(plan: PlanEvaluation) -> NextOwner:
    # Missing evidence goes back to the crew to gather it; a complete evaluation needs the commander.
    return "crew" if plan.status == "INSUFFICIENT_EVIDENCE" else "commander"


def _explain(plan: PlanEvaluation) -> str:
    parts = []
    for c in plan.candidates:
        detail = c.result if c.reason_code is None else f"{c.result} ({c.reason_code})"
        if c.peak_co2_ppm is not None:
            detail += f", peak {c.peak_co2_ppm:.0f} ppm over {plan.horizon_s // 3600} h"
        parts.append(f"{c.candidate_id}: {detail}")
    return f"{plan.status} at v{plan.decision_rev}. " + "; ".join(parts) + "."


def _linked_event_ids(db: Connection, run_id: str, incident_id: str) -> tuple[str, ...]:
    rows = db.execute(
        """SELECT json_extract(payload_json, '$.fault_event_id') FROM events
           WHERE run_id = ? AND event_type IN ('incident.opened', 'incident.fault_linked')
             AND json_extract(payload_json, '$.incident_id') = ?
           ORDER BY event_seq""",
        (run_id, incident_id),
    ).fetchall()
    return tuple(row[0] for row in rows)


def _journal(db: Connection, run_id: str, event_type: str, event_id: str, mission_s: int, payload: dict) -> None:
    db.execute(
        """INSERT INTO events (run_id, event_seq, event_id, event_type, mission_s, visibility, payload_json)
           SELECT ?, COALESCE(MAX(event_seq), 0) + 1, ?, ?, ?, 'operational', ?
           FROM events WHERE run_id = ?""",
        (run_id, event_id, event_type, mission_s, json.dumps(payload), run_id),
    )


def handle_fault(db: Connection, run_id: str, event_id: str) -> IncidentCase:
    """Open or extend the incident for one accepted fault event, inside the caller's write."""
    fault = db.execute(
        "SELECT event_type, mission_s, payload_json FROM events WHERE run_id = ? AND event_id = ?",
        (run_id, event_id),
    ).fetchone()
    if fault is None:
        raise MonitorDenied("EVENT_NOT_FOUND")
    component_id = json.loads(fault["payload_json"]).get("component_id") or ""
    result = dispatch(default_registry(), ToolCall(
        agent="monitor", tool="request_plan_evaluation", trigger_key=fault["event_type"],
        trigger_event_id=event_id, mission_s=fault["mission_s"], args={"component_id": component_id},
    ))
    if result.status != "accepted":
        raise MonitorDenied(result.reason_code)

    key = f"{fault['event_type']}:{component_id}"
    opened = db.execute(
        """SELECT receipt_json FROM operations
           WHERE run_id = ? AND operation_scope = 'incident' AND operation_id = ?""",
        (run_id, key),
    ).fetchone()
    if opened is None:
        plan = evaluate_run(db, run_id)
        case = IncidentCase(
            incident_id="inc-" + sha256(f"{run_id}:{key}".encode()).hexdigest()[:12],
            run_id=run_id, trigger_key=fault["event_type"], component_id=component_id,
            opened_by_event_id=event_id, opened_at_s=fault["mission_s"], linked_event_ids=(event_id,),
            next_owner=_next_owner(plan), plan_status=plan.status,
            basis_snapshot_id=plan.basis_snapshot_id, basis_decision_rev=plan.decision_rev,
            candidates=tuple(CandidateSummary(candidate_id=c.candidate_id, result=c.result,
                                              reason_code=c.reason_code, peak_co2_ppm=c.peak_co2_ppm)
                             for c in plan.candidates),
            explanation=_explain(plan),
        )
        receipt = case.model_dump_json()
        db.execute(
            """INSERT INTO operations (run_id, operation_scope, operation_id, request_digest, receipt_json)
               VALUES (?, 'incident', ?, ?, ?)""",
            (run_id, key, sha256(key.encode()).hexdigest(), receipt),
        )
        _journal(db, run_id, "incident.opened", f"incident:{case.incident_id}", fault["mission_s"],
                 {"incident_id": case.incident_id, "fault_event_id": event_id,
                  "next_owner": case.next_owner, "plan_status": case.plan_status})
        return case

    case = IncidentCase.model_validate_json(opened["receipt_json"])
    linked = _linked_event_ids(db, run_id, case.incident_id)
    if event_id not in linked:
        _journal(db, run_id, "incident.fault_linked", f"incident:{case.incident_id}:{event_id}",
                 fault["mission_s"], {"incident_id": case.incident_id, "fault_event_id": event_id})
        linked = (*linked, event_id)
    return case.model_copy(update={"linked_event_ids": linked})


class WearableRecheck(BaseModel):
    model_config = ConfigDict(frozen=True)

    task_id: str
    trigger_event_id: str
    opened_at_s: int
    expires_at_s: int
    repeat_available_at_s: int
    status: Literal["offered", "held", "assigned", "verified"]
    reason_code: Literal["OBSERVER_UNAVAILABLE", "EXPIRED"] | None = None
    available_observers: tuple[str, ...] = ()
    observer_id: str | None = None
    assigned_at_s: int | None = None
    completed_at_s: int | None = None
    evidence_ids: tuple[str, ...]
    synthetic: Literal[True] = True


def read_wearable_recheck(
    db: Connection, run_id: str, crew_id: str, mission_s: int, fixture: dict,
) -> WearableRecheck | None:
    """Offer one Crew recheck for the first delivered exercise motion artifact."""
    row = db.execute(
        """SELECT e.payload_json FROM health_observations h
           JOIN events e ON e.run_id = h.run_id AND e.event_id = h.event_id
           WHERE h.run_id = ? AND h.crew_id = ? AND h.source_id = ?
             AND h.received_at_s <= ? AND h.quality = 'suspect'
             AND json_extract(h.context_json, '$.reason_code') = 'MOTION_ARTIFACT'
             AND json_extract(h.context_json, '$.activity') = 'exercise'
             AND e.event_type = ? AND e.visibility = 'crew'
           ORDER BY h.received_at_s, e.event_seq LIMIT 1""",
        (run_id, crew_id, WRISTBAND_SOURCE, mission_s, EVENT_TYPE),
    ).fetchone()
    if row is None:
        return None

    trigger = WearableObservation(**json.loads(row["payload_json"]))
    task_id = "wearable-recheck-" + sha256(f"{run_id}:{trigger.event_id}".encode()).hexdigest()[:24]
    history = db.execute(
        """SELECT payload_json FROM events
           WHERE run_id = ? AND visibility = 'crew' AND mission_s <= ?
             AND event_id IN (?, ?)
           ORDER BY event_seq DESC LIMIT 1""",
        (run_id, mission_s, task_id + ":assigned", task_id + ":verified"),
    ).fetchone()
    expires_at_s = fixture["recheck"]["expires_at_s"]
    available = tuple(
        observer for observer, free_at_s in fixture["recheck"]["observers"].items()
        if observer != crew_id and free_at_s <= mission_s < expires_at_s
    )
    task = (
        WearableRecheck.model_validate_json(history["payload_json"])
        if history else WearableRecheck(
            task_id=task_id, trigger_event_id=trigger.event_id, opened_at_s=trigger.received_at_s,
            expires_at_s=expires_at_s, repeat_available_at_s=fixture["recheck_repeat"]["received_at_s"],
            status="offered", evidence_ids=(trigger.event_id,),
        )
    )
    if task.status == "verified":
        return task
    if mission_s >= expires_at_s:
        return task.model_copy(update={"status": "held", "reason_code": "EXPIRED", "available_observers": ()})
    if task.status == "assigned":
        return task
    if not available:
        return task.model_copy(update={"status": "held", "reason_code": "OBSERVER_UNAVAILABLE"})
    return task.model_copy(update={"available_observers": available})

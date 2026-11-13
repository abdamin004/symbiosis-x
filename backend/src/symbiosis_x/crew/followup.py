"""SX-24C: personal reminders and follow-up for one crew member.

A reminder is due one schedule interval after the last accepted (valid)
reading of that metric, or after the start of the run when none exists yet.
Its action comes from the latest assessment: a reading outside the personal
range asks for review with the designated onboard role, an unknown result
asks for a repeat measurement, and otherwise the check is routine. Crew can
acknowledge a reminder through its own route; the acknowledgment belongs to
that due instance only, so the next due time is a new reminder.

An open emergency case for the same crew member takes precedence: routine
reminders are deferred and never gate the emergency, which opens at once
without waiting for a repeat reading. Everything here is Crew-private and
synthetic, with a compressed demo cadence that is not a clinical schedule.
"""

from __future__ import annotations

import json
from sqlite3 import Connection
from typing import Literal

from symbiosis_x.application.runs import RunConflict, RunNotFound, load_active_run, next_event_seq
from symbiosis_x.contracts.events import Contract, Identifier
from symbiosis_x.storage.repository import Repository

SCHEDULE_VERSION = "personal-monitoring-v1"
DUE_SOON_S = 60
DESIGNATED_ROLE = {"role": "crew_medical_officer", "crew_id": "SIM-02"}

# Synthetic personal monitoring schedules. The cadence is compressed so a demo
# run crosses due times within minutes; it is not a clinical schedule.
SCHEDULES: dict[str, tuple[dict, ...]] = {
    "SIM-01": (
        {"metric": "heart_rate", "label": "Resting heart rate", "every_s": 300, "context": {"activity": "rest"}},
        {"metric": "blood_pressure", "label": "Blood pressure", "every_s": 300,
         "context": {"method": "automatic_upper_arm_cuff", "posture": "seated_rested"}},
    ),
}

Status = Literal["scheduled", "due", "overdue", "acknowledged"]
Action = Literal["routine_check", "repeat_measurement", "review_with_designated_role"]


class FollowupNotFound(Exception):
    """The run or reminder does not exist; the message is a reason code."""


class FollowupRejected(Exception):
    """The acknowledgment is not allowed; the message is a reason code."""


class AcknowledgeReminderRequest(Contract):
    crew_id: Identifier
    acknowledged_by: Identifier


def reminder_id(crew_id: str, metric: str, due_at_s: int) -> str:
    return f"rem-{crew_id}-{metric}-{due_at_s}"


def _last_accepted(db: Connection, run_id: str, crew_id: str, metric: str) -> int | None:
    row = db.execute(
        """SELECT MAX(h.observed_at_s) FROM health_observations h
           JOIN events e ON e.run_id = h.run_id AND e.event_id = h.event_id
           WHERE h.run_id = ? AND h.crew_id = ? AND h.metric = ? AND h.quality = 'valid'
             AND e.event_type = 'crew.health_measurement'""",
        (run_id, crew_id, metric),
    ).fetchone()
    return row[0] if row else None


def _acknowledgments(db: Connection, run_id: str) -> dict[str, dict]:
    rows = db.execute(
        """SELECT payload_json FROM events
           WHERE run_id = ? AND event_type = 'crew.reminder_acknowledged' AND visibility = 'crew'""",
        (run_id,),
    ).fetchall()
    return {payload["reminder_id"]: payload for payload in (json.loads(row["payload_json"]) for row in rows)}


def _emergency(db: Connection, run_id: str, crew_id: str) -> dict | None:
    row = db.execute(
        """SELECT case_id, kind, opened_at_s FROM emergency_cases
           WHERE run_id = ? AND subject_crew_id = ? ORDER BY opened_at_s, case_id LIMIT 1""",
        (run_id, crew_id),
    ).fetchone()
    return dict(row) if row else None


def _action(item: dict, assessment: dict | None) -> tuple[Action, str]:
    metric = item["metric"]
    if not assessment or assessment.get("metric") != metric:
        return "routine_check", f"Take the scheduled {item['label'].lower()} reading."
    personal = assessment.get("personal") or {}
    status = personal.get("status")
    if status == "outside_personal_range":
        return ("review_with_designated_role",
                f"The latest reading is outside the personal range ({personal.get('reason_code')}). "
                f"Repeat the measurement and review it with the {DESIGNATED_ROLE['role'].replace('_', ' ')} "
                f"({DESIGNATED_ROLE['crew_id']}).")
    if status in ("unknown", "baseline_unavailable") and personal.get("reason_code") in (
            "MISSING_CONTEXT", "QUALITY_REJECTED", "UNIT_MISMATCH"):
        return ("repeat_measurement",
                f"The latest reading could not be assessed ({personal.get('reason_code')}). "
                "Repeat it with the scheduled context.")
    return "routine_check", f"Take the scheduled {item['label'].lower()} reading."


def compute_followup(db: Connection, run_id: str, crew_id: str, mission_s: int,
                     assessment: dict | None) -> dict | None:
    """Return the Crew-private reminders for this crew member at mission_s."""
    schedule = SCHEDULES.get(crew_id)
    if not schedule:
        return None
    acknowledged = _acknowledgments(db, run_id)
    emergency = _emergency(db, run_id, crew_id)
    reminders = []
    for item in schedule:
        last = _last_accepted(db, run_id, crew_id, item["metric"])
        due_at_s = (last if last is not None else 0) + item["every_s"]
        rid = reminder_id(crew_id, item["metric"], due_at_s)
        action, reason = _action(item, assessment)
        ack = acknowledged.get(rid)
        if ack:
            status: Status = "acknowledged"
        elif mission_s > due_at_s:
            status = "overdue"
        elif mission_s >= due_at_s - DUE_SOON_S:
            status = "due"
        else:
            status = "scheduled"
        reminders.append({
            "reminder_id": rid, "metric": item["metric"], "label": item["label"],
            "every_s": item["every_s"], "last_accepted_at_s": last, "due_at_s": due_at_s,
            "overdue_by_s": max(mission_s - due_at_s, 0) if status == "overdue" else 0,
            "status": status, "action": action, "reason": reason, "context": item["context"],
            "acknowledged_at_s": ack["acknowledged_at_s"] if ack else None,
            "acknowledged_by": ack["acknowledged_by"] if ack else None,
            "deferred_by_emergency": emergency is not None and status != "acknowledged",
        })
    return {
        "schedule_version": SCHEDULE_VERSION,
        "crew_id": crew_id,
        "mission_s": mission_s,
        "designated_role": DESIGNATED_ROLE,
        "precedence": "emergency" if emergency else "routine",
        "emergency": emergency,
        "reminders": reminders,
        "synthetic": True,
        "visibility": "crew",
    }



def _assessment_tools():
    # Imported lazily: the projection imports this module, and measurements imports runs.
    from symbiosis_x.crew.measurements import latest_crew_assessment
    from symbiosis_x.crew.profile import profile_for_crew
    return latest_crew_assessment, profile_for_crew


def acknowledge_reminder(repository: Repository, run_id: str, rid: str,
                         command: AcknowledgeReminderRequest) -> dict:
    """Record one acknowledgment for the current due instance of a reminder."""
    latest_crew_assessment, profile_for_crew = _assessment_tools()
    if command.acknowledged_by not in (command.crew_id, DESIGNATED_ROLE["crew_id"]):
        raise FollowupRejected("ACKNOWLEDGER_NOT_ALLOWED")
    with repository.write() as db:
        try:
            run = load_active_run(db, run_id)
        except RunNotFound as error:
            raise FollowupNotFound(str(error)) from error
        except RunConflict as error:
            raise FollowupRejected(str(error)) from error
        profile = profile_for_crew(command.crew_id)
        if profile is None:
            raise FollowupRejected("CREW_NOT_ON_ROSTER")
        assessment = latest_crew_assessment(db, run_id, profile)
        current = compute_followup(db, run_id, command.crew_id, run["mission_s"], assessment)
        if current is None or rid not in {r["reminder_id"] for r in current["reminders"]}:
            raise FollowupNotFound("REMINDER_NOT_CURRENT")
        event_id = f"reminder-ack:{rid}"
        if db.execute("SELECT 1 FROM events WHERE run_id = ? AND event_id = ?", (run_id, event_id)).fetchone():
            return next(r for r in current["reminders"] if r["reminder_id"] == rid)
        payload = {"reminder_id": rid, "crew_id": command.crew_id,
                   "acknowledged_by": command.acknowledged_by, "acknowledged_at_s": run["mission_s"]}
        db.execute(
            """INSERT INTO events (run_id, event_seq, event_id, event_type, mission_s, visibility, payload_json)
               VALUES (?, ?, ?, 'crew.reminder_acknowledged', ?, 'crew', ?)""",
            (run_id, next_event_seq(db, run_id), event_id, run["mission_s"],
             json.dumps(payload, separators=(",", ":"), sort_keys=True)),
        )
        updated = compute_followup(db, run_id, command.crew_id, run["mission_s"], assessment)
    return next(r for r in updated["reminders"] if r["reminder_id"] == rid)

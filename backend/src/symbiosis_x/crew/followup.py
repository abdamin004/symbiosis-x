"""Private, deterministic health follow-up reminders for the synthetic Crew demo."""

import hashlib
import json
from sqlite3 import Connection

from symbiosis_x.application.runs import RunConflict, RunNotFound, load_active_run, next_event_seq
from symbiosis_x.contracts.projections import HealthReminder, ReminderAcknowledgment
from symbiosis_x.crew.assessment import assess
from symbiosis_x.crew.profile import load_profile
from symbiosis_x.crew.trends import TrendSample, evaluate_trend
from symbiosis_x.storage.repository import Repository


class ReminderNotFound(Exception):
    """The run or Crew reminder does not exist."""


class ReminderConflict(Exception):
    """The reminder cannot be acknowledged in the current run state."""


class ReminderRejected(Exception):
    """The request does not identify an acknowledgeable reminder."""


# Short intervals make the fictional, minute-stepped demo observable. These
# person-specific cadences are product-demo rules, not clinical recommendations.
PERSONAL_MONITORING_SCHEDULE: dict[str, dict[str, int]] = {
    "SIM-01": {
        "heart_rate": 60,
    }
}


def _reminder_id(run_id: str, metric: str, measurement_id: str, due_at_s: int) -> str:
    material = f"{run_id}\0{metric}\0{measurement_id}\0{due_at_s}".encode("utf-8")
    return "reminder-" + hashlib.sha256(material).hexdigest()[:40]


def _ack_event_id(reminder_id: str) -> str:
    return "reminder-ack-" + hashlib.sha256(reminder_id.encode("utf-8")).hexdigest()[:40]


def emergency_precedence(db: Connection, run_id: str) -> bool:
    """Return whether an open local emergency case outranks routine follow-up."""
    return db.execute(
        "SELECT 1 FROM emergency_cases WHERE run_id = ? AND acknowledged_at_s IS NULL LIMIT 1",
        (run_id,),
    ).fetchone() is not None


def read_health_reminders(db: Connection, run_id: str, mission_s: int) -> list[HealthReminder]:
    """Build reminders from each metric's latest valid, accepted Crew reading."""
    crew_id = load_profile().crew_id
    schedule = PERSONAL_MONITORING_SCHEDULE.get(crew_id, {})
    acknowledgments = db.execute(
        """SELECT payload_json FROM events
           WHERE run_id = ? AND event_type = 'crew.health_reminder_acknowledged'
             AND visibility = 'crew' ORDER BY event_seq DESC LIMIT 20""",
        (run_id,),
    ).fetchall()
    reminders: dict[str, HealthReminder] = {}
    for row in acknowledgments:
        stored = json.loads(row["payload_json"]).get("reminder")
        if stored:
            item = HealthReminder.model_validate(stored)
            reminders[item.reminder_id] = item

    latest: dict[str, object] = {}
    samples: dict[str, list[TrendSample]] = {metric: [] for metric in schedule}
    rows = db.execute(
        """SELECT h.metric, h.event_id, h.received_at_s, e.payload_json
           FROM health_observations h JOIN events e
             ON e.run_id = h.run_id AND e.event_id = h.event_id AND e.visibility = 'crew'
           WHERE h.run_id = ? AND h.crew_id = ? AND h.quality = 'valid'
           ORDER BY h.received_at_s DESC, h.event_id DESC""",
        (run_id, crew_id),
    ).fetchall()
    for row in rows:
        metric = row["metric"]
        if metric not in schedule:
            continue
        receipt = json.loads(row["payload_json"])["receipt"]
        measurement = receipt["measurement"]
        if metric not in latest:
            latest[metric] = (row, receipt)
        value = measurement.get("value")
        unit = measurement.get("unit")
        if metric == "mood":
            value, unit = measurement.get("score"), measurement.get("unit", "score")
        if value is None or unit is None:
            continue
        context = dict(receipt["context"])
        for key in ("method", "meal_context", "site", "scale_id"):
            if measurement.get(key) is not None:
                context[key] = measurement[key]
        samples[metric].append(TrendSample(
            sample_id=row["event_id"], crew_id=crew_id, metric=metric,
            value=float(value), unit=unit, observed_at_s=measurement["observed_at_s"],
            quality=measurement["quality"], source_id=measurement["source_id"], context=context,
        ))

    for metric, (row, receipt) in latest.items():
        interval_s = schedule[metric]
        last_accepted_at_s = receipt["received_at_s"]
        elapsed = max(0, mission_s - last_accepted_at_s)
        intervals_elapsed = elapsed // interval_s
        due_at_s = last_accepted_at_s + max(1, intervals_elapsed) * interval_s
        reminder_id = _reminder_id(run_id, metric, row["event_id"], due_at_s)
        if reminder_id in reminders:
            continue

        assessment = assess(receipt["measurement"], context=receipt["context"])
        ordered_samples = sorted(
            samples[metric], key=lambda item: (item.observed_at_s, item.sample_id),
        )
        fresh_sequence: list[TrendSample] = []
        for sample in ordered_samples:
            if fresh_sequence and sample.observed_at_s - fresh_sequence[-1].observed_at_s > interval_s:
                fresh_sequence = []
            fresh_sequence.append(sample)
        trend = evaluate_trend(fresh_sequence)
        review = (
            trend.sample_count >= trend.minimum_samples
            and assessment.personal.status == "outside_personal_range"
        )
        if review:
            action_text = (
                "The latest comparable reading is outside the personal range after a fresh sequence. "
                f"Review this assessment with the authorized onboard reviewer. {trend.reason}"
            )
        elif trend.status == "insufficient_history":
            action_text = "Take a comparable measurement to complete the personal review series."
        else:
            action_text = "Repeat a comparable measurement when appropriate per the personal schedule."
        reminder = HealthReminder(
            reminder_id=reminder_id,
            metric=metric,
            status="overdue" if mission_s >= due_at_s else "scheduled",
            due_at_s=due_at_s,
            last_accepted_at_s=last_accepted_at_s,
            interval_s=interval_s,
            assessment_id=row["event_id"],
            trend_status=trend.status,
            trend_reason=trend.reason,
            evidence_ids=list(trend.evidence_ids),
            action="review_assessment" if review else "repeat_measurement",
            action_text=action_text,
            designated_role="authorized onboard reviewer" if review else None,
        )
        reminders[reminder_id] = reminder

    return sorted(reminders.values(), key=lambda item: (item.due_at_s, item.metric, item.reminder_id))


def acknowledge_reminder(
    repository: Repository, run_id: str, reminder_id: str,
) -> HealthReminder:
    """Persist a Crew acknowledgment once; an open emergency blocks this routine action."""
    with repository.write() as db:
        try:
            run = load_active_run(db, run_id)
        except RunNotFound as error:
            raise ReminderNotFound(str(error)) from error
        except RunConflict as error:
            raise ReminderConflict(str(error)) from error

        stored = db.execute(
            """SELECT payload_json FROM events WHERE run_id = ? AND event_id = ?
               AND event_type = 'crew.health_reminder_acknowledged' AND visibility = 'crew'""",
            (run_id, _ack_event_id(reminder_id)),
        ).fetchone()
        if stored:
            return HealthReminder.model_validate(json.loads(stored["payload_json"])["reminder"])
        if emergency_precedence(db, run_id):
            raise ReminderConflict("EMERGENCY_HAS_PRECEDENCE")

        reminder = next(
            (item for item in read_health_reminders(db, run_id, run["mission_s"])
             if item.reminder_id == reminder_id),
            None,
        )
        if reminder is None:
            raise ReminderNotFound("REMINDER_NOT_FOUND")
        if reminder.status != "overdue":
            raise ReminderRejected("REMINDER_NOT_DUE")

        acknowledged = reminder.model_copy(update={
            "status": "acknowledged",
            "acknowledgment": ReminderAcknowledgment(
                acknowledged_by=load_profile().crew_id,
                acknowledged_at_s=run["mission_s"],
            ),
        })
        db.execute(
            """INSERT INTO events (run_id, event_seq, event_id, event_type, mission_s,
                                   visibility, payload_json)
               VALUES (?, ?, ?, 'crew.health_reminder_acknowledged', ?, 'crew', ?)""",
            (run_id, next_event_seq(db, run_id), _ack_event_id(reminder_id), run["mission_s"],
             json.dumps({"reminder": acknowledged.model_dump(mode="json")},
                        separators=(",", ":"), sort_keys=True)),
        )
    return acknowledged

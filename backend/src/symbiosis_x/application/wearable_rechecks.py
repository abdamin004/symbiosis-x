"""Apply authorized Crew actions to the scripted wearable recheck."""

from dataclasses import replace
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from symbiosis_x.application.runs import load_active_run, next_event_seq
from symbiosis_x.application.wearables import WEARABLE_SCENARIO, record_wearable
from symbiosis_x.crew.wearable_series import load_wearable_fixture, recheck_observation
from symbiosis_x.storage.repository import Repository
from symbiosis_x.workflows.monitor import WearableRecheck, read_wearable_recheck


class RecheckCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: Literal["assign", "record"]
    observer_id: str = Field(min_length=1, max_length=32)


class RecheckNotFound(Exception):
    pass


class RecheckConflict(Exception):
    pass


def apply_recheck(
    repository: Repository, run_id: str, crew_id: str, task_id: str, command: RecheckCommand,
) -> WearableRecheck:
    """Record one assignment and one independently observed repeat in the same run."""
    with repository.write() as db:
        run = load_active_run(db, run_id)
        if (run["scenario_id"], run["scenario_version"]) != WEARABLE_SCENARIO:
            raise RecheckNotFound("RECHECK_NOT_FOUND")
        mission_s = run["mission_s"]
        fixture = load_wearable_fixture()
        task = read_wearable_recheck(db, run_id, crew_id, mission_s, fixture)
        if task is None or task.task_id != task_id:
            raise RecheckNotFound("RECHECK_NOT_FOUND")

        observer = command.observer_id
        if task.status == "verified":
            if task.observer_id == observer:
                return task
            raise RecheckConflict("WRONG_OBSERVER")
        if task.status == "held":
            raise RecheckConflict(task.reason_code)
        if command.action == "assign":
            if task.status == "assigned":
                if task.observer_id == observer:
                    return task
                raise RecheckConflict("ALREADY_ASSIGNED")
            if observer not in task.available_observers:
                raise RecheckConflict("OBSERVER_UNAVAILABLE")
            updated = task.model_copy(update={
                "status": "assigned", "observer_id": observer, "assigned_at_s": mission_s,
                "available_observers": (),
            })
        else:
            if task.status != "assigned":
                raise RecheckConflict("RECHECK_NOT_ASSIGNED")
            if task.observer_id != observer:
                raise RecheckConflict("WRONG_OBSERVER")
            repeat = recheck_observation(fixture, run_id=run_id, crew_id=crew_id)
            if (
                repeat.received_at_s > mission_s or repeat.quality != "valid"
                or repeat.context.get("repeat_of_event_id") != task.trigger_event_id
            ):
                raise RecheckConflict("REPEAT_EVIDENCE_UNAVAILABLE")
            # The authored offset is the earliest repeat. Stamp the observation at the
            # actual Crew action so an assignment at that offset cannot produce a backdated result.
            repeat = replace(
                repeat, observed_at_s=mission_s, received_at_s=mission_s,
                context={**repeat.context, "observer_id": observer, "provenance": "synthetic_crewmate_recheck"},
            )
            record_wearable(db, repeat)
            updated = task.model_copy(update={
                "status": "verified", "completed_at_s": mission_s,
                "evidence_ids": (*task.evidence_ids, repeat.event_id),
            })

        db.execute(
            """INSERT INTO events
               (run_id, event_seq, event_id, event_type, mission_s, visibility, payload_json)
               VALUES (?, ?, ?, ?, ?, 'crew', ?)""",
            (run_id, next_event_seq(db, run_id), f"{task_id}:{updated.status}",
             f"crew.wearable_recheck.{updated.status}", mission_s, updated.model_dump_json()),
        )
        return updated

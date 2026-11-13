"""Durable run commands for the nominal first slice."""
import json
from hashlib import sha256
from uuid import uuid4

from symbiosis_x.application.nominal import deliver_nominal_ground, record_nominal_co2
from symbiosis_x.contracts.commands import (
    AdvanceReceipt, AdvanceRunRequest, RunReceipt, StartRunRequest,
)
from symbiosis_x.storage.repository import Repository

NOMINAL_SCENARIO = ("nominal", "1")
LOCAL_FACILITATOR = "local-facilitator"


class RunNotFound(Exception):
    pass


class RunConflict(Exception):
    pass


def request_digest(command: StartRunRequest | AdvanceRunRequest) -> str:
    return sha256(command.model_dump_json().encode()).hexdigest()


def start_run(repository: Repository, command: StartRunRequest) -> RunReceipt:
    digest = request_digest(command)
    with repository.write() as db:
        prior = db.execute(
            """SELECT run_id, start_request_digest FROM runs
               WHERE start_actor_id = ? AND start_id = ?""",
            (LOCAL_FACILITATOR, command.start_id),
        ).fetchone()
        if prior is not None:
            if prior["start_request_digest"] != digest:
                raise RunConflict("START_ID_REUSED")
            run_id = prior["run_id"]
        else:
            if (command.scenario_id, command.scenario_version) != NOMINAL_SCENARIO:
                raise RunNotFound("SCENARIO_NOT_FOUND")
            run_id = uuid4().hex
            db.execute(
                """INSERT INTO runs
                   (run_id, scenario_id, scenario_version, seed, schema_version,
                    model_version, policy_version, start_actor_id, start_id, start_request_digest)
                   VALUES (?, ?, ?, ?, 1, 'cabin-1', 'demo-1', ?, ?, ?)""",
                (run_id, command.scenario_id, command.scenario_version, command.seed,
                 LOCAL_FACILITATOR, command.start_id, digest),
            )
            db.execute(
                """INSERT INTO events
                   (run_id, event_seq, event_id, event_type, mission_s, visibility, payload_json)
                   VALUES (?, 1, 'run-started', 'run.started', 0, 'operational', ?)""",
                (run_id, command.model_dump_json()),
            )
            record_nominal_co2(db, run_id, 0)

    return RunReceipt(
        run_id=run_id, scenario_id=command.scenario_id,
        scenario_version=command.scenario_version, seed=command.seed, mission_s=0, step=0,
    )


NOMINAL_STEPS_S = (0, 60)


def advance_run(repository: Repository, run_id: str, command: AdvanceRunRequest) -> AdvanceReceipt:
    digest = request_digest(command)
    with repository.write() as db:
        run = db.execute("SELECT * FROM runs WHERE run_id = ?", (run_id,)).fetchone()
        if run is None:
            raise RunNotFound("RUN_NOT_FOUND")
        prior = db.execute(
            """SELECT request_digest, receipt_json FROM operations
               WHERE run_id = ? AND operation_scope = 'advance' AND operation_id = ?""",
            (run_id, command.advance_id),
        ).fetchone()
        if prior is not None:
            if prior["request_digest"] != digest:
                raise RunConflict("ADVANCE_ID_REUSED")
            return AdvanceReceipt.model_validate_json(prior["receipt_json"])
        if run["status"] != "active":
            raise RunConflict("RUN_CLOSED")
        if (run["scenario_id"], run["scenario_version"]) != NOMINAL_SCENARIO:
            raise RunConflict("SCENARIO_NOT_ADVANCEABLE")
        if command.expected_step >= len(NOMINAL_STEPS_S) or (
            NOMINAL_STEPS_S[command.expected_step] != run["mission_s"]
        ):
            raise RunConflict("STALE_STEP")
        next_step = command.expected_step + 1
        if next_step == len(NOMINAL_STEPS_S):
            raise RunConflict("NO_NEXT_STEP")

        receipt = AdvanceReceipt(
            run_id=run_id, scenario_id=run["scenario_id"],
            scenario_version=run["scenario_version"], seed=run["seed"],
            step=next_step, mission_s=NOMINAL_STEPS_S[next_step], advance_id=command.advance_id,
        )
        db.execute("UPDATE runs SET mission_s = ? WHERE run_id = ?", (receipt.mission_s, run_id))
        db.execute(
            """INSERT INTO events
               (run_id, event_seq, event_id, event_type, mission_s, visibility, payload_json)
               SELECT ?, COALESCE(MAX(event_seq), 0) + 1, ?, 'run.advanced', ?, 'operational', ?
               FROM events WHERE run_id = ?""",
            (run_id, f"advance:{command.advance_id}", receipt.mission_s, receipt.model_dump_json(), run_id),
        )
        db.execute(
            """INSERT INTO operations (run_id, operation_scope, operation_id, request_digest, receipt_json)
               VALUES (?, 'advance', ?, ?, ?)""",
            (run_id, command.advance_id, digest, receipt.model_dump_json()),
        )
        record_nominal_co2(db, run_id, receipt.mission_s)
        deliver_nominal_ground(db, run_id, receipt.mission_s)
    return receipt

def reset_run(repository: Repository, run_id: str) -> RunReceipt:
    """Close the current run and atomically create a fresh run."""
    with repository.write() as db:
        old_run = db.execute(
            "SELECT * FROM runs WHERE run_id = ?",
            (run_id,),
        ).fetchone()

        if old_run is None:
            raise RunNotFound("RUN_NOT_FOUND")

        if old_run["status"] != "active":
            raise RunConflict("RUN_CLOSED")

        new_run_id = uuid4().hex

        # Close the old run without deleting its audit history.
        db.execute(
            """UPDATE runs
               SET status = 'closed'
               WHERE run_id = ? AND status = 'active'""",
            (run_id,),
        )

        old_event_seq = db.execute(
            """SELECT COALESCE(MAX(event_seq), 0) + 1
               FROM events WHERE run_id = ?""",
            (run_id,),
        ).fetchone()[0]

        db.execute(
            """INSERT INTO events
               (run_id, event_seq, event_id, event_type,
                mission_s, visibility, payload_json)
               VALUES (?, ?, ?, 'run.closed', ?, 'operational', ?)""",
            (
                run_id,
                old_event_seq,
                f"reset:{new_run_id}:closed",
                old_run["mission_s"],
                json.dumps({"reset_to_run_id": new_run_id}),
            ),
        )

        # Create the replacement run using the original configuration.
        db.execute(
            """INSERT INTO runs
               (run_id, scenario_id, scenario_version, seed,
                schema_version, model_version, policy_version,
                mission_s, decision_rev, status, reset_from_run_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 'active', ?)""",
            (
                new_run_id,
                old_run["scenario_id"],
                old_run["scenario_version"],
                old_run["seed"],
                old_run["schema_version"],
                old_run["model_version"],
                old_run["policy_version"],
                run_id,
            ),
        )

        receipt = RunReceipt(
            run_id=new_run_id,
            scenario_id=old_run["scenario_id"],
            scenario_version=old_run["scenario_version"],
            seed=old_run["seed"],
            mission_s=0,
            step=0,
        )

        db.execute(
            """INSERT INTO events
               (run_id, event_seq, event_id, event_type,
                mission_s, visibility, payload_json)
               VALUES (?, 1, 'run-started', 'run.started',
                       0, 'operational', ?)""",
            (new_run_id, receipt.model_dump_json()),
        )
                        
        if (old_run["scenario_id"], old_run["scenario_version"]) == NOMINAL_SCENARIO:
            record_nominal_co2(db, new_run_id, 0)

    return receipt

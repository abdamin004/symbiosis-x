"""Durable run commands for the nominal first slice."""

from hashlib import sha256
from uuid import uuid4

from symbiosis_x.contracts.commands import RunReceipt, StartRunRequest
from symbiosis_x.storage.repository import Repository

NOMINAL_SCENARIO = ("nominal", "1")
LOCAL_FACILITATOR = "local-facilitator"


class RunNotFound(Exception):
    pass


class RunConflict(Exception):
    pass


def start_run(repository: Repository, command: StartRunRequest) -> RunReceipt:
    digest = sha256(command.model_dump_json().encode()).hexdigest()
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

    return RunReceipt(
        run_id=run_id, scenario_id=command.scenario_id,
        scenario_version=command.scenario_version, seed=command.seed, mission_s=0, step=0,
    )

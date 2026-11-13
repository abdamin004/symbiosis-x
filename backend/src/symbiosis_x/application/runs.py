"""Durable run commands for the nominal first slice."""

from hashlib import sha256
from uuid import uuid4

from symbiosis_x.application.nominal import deliver_nominal_ground, record_nominal_co2
from symbiosis_x.contracts.commands import (
    AdvanceReceipt, AdvanceRunRequest, DriverPauseRequest, DriverPauseReceipt, EndReceipt, EndRunRequest, ResetReceipt, ResetRunRequest, RunReceipt, StartRunRequest,
)
from symbiosis_x.simulation.scenario import (GOLDEN_SCENARIO, GOLDEN_STEPS_S, ORGANIZER_SCENARIO,
    load_golden_manifest, load_organizer_manifest)
from symbiosis_x.workflows.dispatcher import seed_golden, compose_golden_until
from symbiosis_x.storage.repository import Repository
from symbiosis_x.workflows.relay import deliver_due, receive_due_advisories

NOMINAL_SCENARIO = ("nominal", "1")
LOCAL_FACILITATOR = "local-facilitator"


class RunNotFound(Exception):
    pass


class RunConflict(Exception):
    pass


def load_active_run(db, run_id: str):
    """Return the run row for a writer, or raise when it is missing or closed."""
    run = db.execute("SELECT * FROM runs WHERE run_id = ?", (run_id,)).fetchone()
    if run is None:
        raise RunNotFound("RUN_NOT_FOUND")
    if run["status"] != "active":
        raise RunConflict("RUN_CLOSED")
    return run


def next_event_seq(db, run_id: str) -> int:
    return db.execute(
        "SELECT COALESCE(MAX(event_seq), 0) + 1 FROM events WHERE run_id = ?", (run_id,)
    ).fetchone()[0]


def request_digest(command: StartRunRequest | AdvanceRunRequest | ResetRunRequest | EndRunRequest) -> str:
    return sha256(command.model_dump_json().encode()).hexdigest()


def start_run(repository: Repository, command: StartRunRequest, golden_manifest_path=None) -> RunReceipt:
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
            scenario = (command.scenario_id, command.scenario_version)
            if scenario == GOLDEN_SCENARIO:
                manifest = load_golden_manifest(golden_manifest_path)
                if command.seed != manifest["seed"]:
                    raise RunConflict("GOLDEN_SEED_MISMATCH")
            elif scenario == ORGANIZER_SCENARIO:
                manifest = load_organizer_manifest()
                if command.seed != manifest["seed"]:
                    raise RunConflict("ORGANIZER_SEED_MISMATCH")
            elif scenario != NOMINAL_SCENARIO:
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
            _record_start(db, run_id, command.model_dump_json())

    return RunReceipt(
        run_id=run_id, scenario_id=command.scenario_id,
        scenario_version=command.scenario_version, seed=command.seed, mission_s=0, step=0,
    )


def _record_start(db, run_id: str, payload_json: str) -> None:
    db.execute(
        """INSERT INTO events
           (run_id, event_seq, event_id, event_type, mission_s, visibility, payload_json)
           VALUES (?, 1, 'run-started', 'run.started', 0, 'operational', ?)""",
        (run_id, payload_json),
    )
    record_nominal_co2(db, run_id, 0)
    scenario = db.execute(
        "SELECT scenario_id, scenario_version FROM runs WHERE run_id = ?", (run_id,)
    ).fetchone()
    if (scenario["scenario_id"], scenario["scenario_version"]) == GOLDEN_SCENARIO:
        seed_golden(db, run_id)
    elif (scenario["scenario_id"], scenario["scenario_version"]) == ORGANIZER_SCENARIO:
        seed_golden(db, run_id, variant=load_organizer_manifest())


def reset_run(repository: Repository, run_id: str, command: ResetRunRequest) -> ResetReceipt:
    """Close a run and start its replacement in one write so neither change lands alone."""
    digest = request_digest(command)
    with repository.write() as db:
        run = db.execute("SELECT * FROM runs WHERE run_id = ?", (run_id,)).fetchone()
        if run is None:
            raise RunNotFound("RUN_NOT_FOUND")
        prior = db.execute(
            """SELECT request_digest, receipt_json FROM operations
               WHERE run_id = ? AND operation_scope = 'reset' AND operation_id = ?""",
            (run_id, command.reset_id),
        ).fetchone()
        if prior is not None:
            if prior["request_digest"] != digest:
                raise RunConflict("RESET_ID_REUSED")
            return ResetReceipt.model_validate_json(prior["receipt_json"])
        if run["status"] != "active":
            raise RunConflict("RUN_CLOSED")

        receipt = ResetReceipt(
            run_id=uuid4().hex, scenario_id=run["scenario_id"],
            scenario_version=run["scenario_version"], seed=run["seed"], mission_s=0, step=0,
            reset_id=command.reset_id, reset_from_run_id=run_id,
        )
        db.execute("UPDATE runs SET status = 'closed' WHERE run_id = ?", (run_id,))
        db.execute(
            """INSERT INTO events
               (run_id, event_seq, event_id, event_type, mission_s, visibility, payload_json)
               SELECT ?, COALESCE(MAX(event_seq), 0) + 1, ?, 'run.closed', ?, 'operational', ?
               FROM events WHERE run_id = ?""",
            (run_id, f"reset:{command.reset_id}", run["mission_s"], receipt.model_dump_json(), run_id),
        )
        db.execute(
            """INSERT INTO runs
               (run_id, scenario_id, scenario_version, seed, schema_version,
                model_version, policy_version, reset_from_run_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (receipt.run_id, run["scenario_id"], run["scenario_version"], run["seed"],
             run["schema_version"], run["model_version"], run["policy_version"], run_id),
        )
        _record_start(db, receipt.run_id, receipt.model_dump_json())
        db.execute(
            """INSERT INTO operations (run_id, operation_scope, operation_id, request_digest, receipt_json)
               VALUES (?, 'reset', ?, ?, ?)""",
            (run_id, command.reset_id, digest, receipt.model_dump_json()),
        )
    return receipt



def _step_of(run) -> int:
    """The facilitator step cursor for a run's current mission time."""
    scenario = (run["scenario_id"], run["scenario_version"])
    steps = GOLDEN_STEPS_S if scenario in (GOLDEN_SCENARIO, ORGANIZER_SCENARIO) else NOMINAL_STEPS_S
    return steps.index(run["mission_s"]) if run["mission_s"] in steps else 0


def end_run(repository: Repository, run_id: str, command: EndRunRequest) -> EndReceipt:
    """End a mission: close the run at its current mission time without starting another.

    The run stays readable by both roles. Advancing, resetting and every other
    write then fail with RUN_CLOSED. Retrying the same end_id returns the
    original receipt.
    """
    digest = request_digest(command)
    with repository.write() as db:
        run = db.execute("SELECT * FROM runs WHERE run_id = ?", (run_id,)).fetchone()
        if run is None:
            raise RunNotFound("RUN_NOT_FOUND")
        prior = db.execute(
            """SELECT request_digest, receipt_json FROM operations
               WHERE run_id = ? AND operation_scope = 'end' AND operation_id = ?""",
            (run_id, command.end_id),
        ).fetchone()
        if prior is not None:
            if prior["request_digest"] != digest:
                raise RunConflict("END_ID_REUSED")
            return EndReceipt.model_validate_json(prior["receipt_json"])
        if run["status"] != "active":
            raise RunConflict("RUN_CLOSED")

        receipt = EndReceipt(
            run_id=run_id, scenario_id=run["scenario_id"], scenario_version=run["scenario_version"],
            seed=run["seed"], mission_s=run["mission_s"], step=_step_of(run),
            end_id=command.end_id, status="closed",
        )
        db.execute("UPDATE runs SET status = 'closed' WHERE run_id = ?", (run_id,))
        db.execute(
            """INSERT INTO events
               (run_id, event_seq, event_id, event_type, mission_s, visibility, payload_json)
               VALUES (?, ?, ?, 'run.ended', ?, 'operational', ?)""",
            (run_id, next_event_seq(db, run_id), f"end:{command.end_id}", run["mission_s"],
             receipt.model_dump_json()),
        )
        db.execute(
            """INSERT INTO operations (run_id, operation_scope, operation_id, request_digest, receipt_json)
               VALUES (?, 'end', ?, ?, ?)""",
            (run_id, command.end_id, digest, receipt.model_dump_json()),
        )
    return receipt


NOMINAL_STEPS_S = (0, 60)


def advance_run(repository: Repository, run_id: str, command: AdvanceRunRequest, *, driver: bool = False) -> AdvanceReceipt:
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
        if driver:
            paused = db.execute(
                "SELECT paused FROM run_driver_state WHERE run_id = ?", (run_id,)
            ).fetchone()
            if paused is not None and paused["paused"]:
                raise RunConflict("DRIVER_PAUSED")
        if (run["scenario_id"], run["scenario_version"]) in (GOLDEN_SCENARIO, ORGANIZER_SCENARIO):
            return _advance_golden(db, run_id, run, command)
        if (run["scenario_id"], run["scenario_version"]) != NOMINAL_SCENARIO:
            raise RunConflict("SCENARIO_NOT_ADVANCEABLE")
        if command.target_mission_s is not None:
            raise RunConflict("TARGET_ONLY_FOR_GOLDEN")
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
        deliver_due(db, run_id, receipt.mission_s)
        receive_due_advisories(db, run_id, receipt.mission_s)
    return receipt


def _advance_golden(db, run_id: str, run, command: AdvanceRunRequest) -> AdvanceReceipt:
    """Compose all due scenario beats within the existing advance transaction."""
    current_s = run["mission_s"]
    if current_s not in GOLDEN_STEPS_S:
        raise RunConflict("STALE_STEP")
    step = GOLDEN_STEPS_S.index(current_s)
    if command.expected_step != step:
        raise RunConflict("STALE_STEP")
    next_step = step + 1
    if next_step >= len(GOLDEN_STEPS_S):
        raise RunConflict("NO_NEXT_STEP")
    target = command.target_mission_s
    if target is None:
        target = GOLDEN_STEPS_S[next_step]
    if target not in GOLDEN_STEPS_S or target <= current_s:
        raise RunConflict("GOLDEN_STEP_NOT_REACHABLE")

    variant = load_organizer_manifest() if (run['scenario_id'], run['scenario_version']) == ORGANIZER_SCENARIO else None
    compose_golden_until(db, run_id, current_s, target, variant=variant)
    receipt = AdvanceReceipt(
        run_id=run_id, scenario_id=run["scenario_id"],
        scenario_version=run["scenario_version"], seed=run["seed"],
        mission_s=target, step=GOLDEN_STEPS_S.index(target),
        advance_id=command.advance_id,
    )
    db.execute(
        """INSERT INTO events
           (run_id, event_seq, event_id, event_type, mission_s, visibility, payload_json)
           SELECT ?, COALESCE(MAX(event_seq), 0) + 1, ?, 'run.advanced', ?,
                  'operational', ? FROM events WHERE run_id = ?""",
        (run_id, f"advance:{command.advance_id}", target, receipt.model_dump_json(), run_id),
    )
    db.execute(
        """INSERT INTO operations (run_id, operation_scope, operation_id, request_digest, receipt_json)
           VALUES (?, 'advance', ?, ?, ?)""",
        (run_id, command.advance_id, request_digest(command), receipt.model_dump_json()),
    )
    return receipt


def pause_driver(
    repository: Repository, run_id: str, command: DriverPauseRequest,
) -> DriverPauseReceipt:
    """Pause/resume optional driver ticks without moving mission time."""
    with repository.write() as db:
        run = load_active_run(db, run_id)
        stored = db.execute(
            "SELECT paused FROM run_driver_state WHERE run_id = ?", (run_id,)
        ).fetchone()
        old_paused = bool(stored["paused"]) if stored else False
        if old_paused != command.paused:
            db.execute(
                """INSERT INTO run_driver_state (run_id, paused) VALUES (?, ?)
                   ON CONFLICT(run_id) DO UPDATE SET paused = excluded.paused""",
                (run_id, int(command.paused)),
            )
            db.execute(
                """INSERT INTO events
                   (run_id, event_seq, event_id, event_type, mission_s, visibility, payload_json)
                   VALUES (?, ?, ?, ?, ?, 'operational', ?)""",
                (run_id, next_event_seq(db, run_id), f"driver:{uuid4().hex}",
                 "run.driver_paused" if command.paused else "run.driver_resumed",
                 run["mission_s"], '{"paused":' + str(command.paused).lower() + '}'),
            )
        return DriverPauseReceipt(
            run_id=run_id, paused=command.paused, mission_s=run["mission_s"],
        )

"""SX-06B: one transaction is the authority for Crew command decisions.

The writer records either an immutable rejected receipt (zero effects) or one
accepted plant intent and its new decision revision. It never trusts a client
assertion of feasibility, a claimed role, or an expired evidence basis.
"""

from hashlib import sha256
import json

from symbiosis_x.application.exercise_schedule import read_exercise_preview, record_deferral
from symbiosis_x.contracts.commands import ActionRequest, CrewActionReceipt
from symbiosis_x.storage.repository import Repository
from symbiosis_x.workflows.planner import evaluate_run


class CommandNotFound(Exception):
    pass


class CommandConflict(Exception):
    pass


def _digest(command: ActionRequest) -> str:
    return sha256(command.model_dump_json().encode("utf-8")).hexdigest()


def _save_receipt(db, run_id: str, command: ActionRequest, digest: str,
                  receipt: CrewActionReceipt) -> CrewActionReceipt:
    db.execute(
        """INSERT INTO operations (run_id, operation_scope, operation_id, request_digest, receipt_json)
           VALUES (?, 'crew_action', ?, ?, ?)""",
        (run_id, command.operation_id, digest, receipt.model_dump_json()),
    )
    return receipt


def commit_command(repository: Repository, run_id: str,
                   command: ActionRequest) -> CrewActionReceipt:
    """Atomically decide, journal and receipt one approved candidate.

    The caller must have already passed the Crew role check. The writer performs
    all run, basis, revision, policy, expiry and feasibility checks again inside
    its exclusive transaction to avoid a check/commit race.
    """
    digest = _digest(command)
    with repository.write() as db:
        run = db.execute(
            "SELECT status, decision_rev, mission_s, policy_version FROM runs WHERE run_id = ?",
            (run_id,),
        ).fetchone()
        if run is None:
            raise CommandNotFound("RUN_NOT_FOUND")

        previous = db.execute(
            """SELECT request_digest, receipt_json FROM operations
               WHERE run_id = ? AND operation_scope = 'crew_action' AND operation_id = ?""",
            (run_id, command.operation_id),
        ).fetchone()
        if previous is not None:
            if previous["request_digest"] != digest:
                raise CommandConflict("OPERATION_ID_REUSED")
            return CrewActionReceipt.model_validate_json(previous["receipt_json"])

        if run["status"] != "active":
            raise CommandConflict("RUN_CLOSED")

        current_rev = run["decision_rev"]
        reject_reason = None
        if command.basis_decision_rev != current_rev:
            reject_reason = "STALE_DECISION_REV"
        elif command.policy_version != run["policy_version"]:
            reject_reason = "POLICY_VERSION_MISMATCH"
        elif command.basis_snapshot_id is not None and command.basis_snapshot_id != f"crew-v{current_rev}":
            reject_reason = "BASIS_SNAPSHOT_MISMATCH"
        elif command.expires_at_s is not None and run["mission_s"] >= command.expires_at_s:
            reject_reason = "ACTION_EXPIRED"

        exercise = None
        if reject_reason is None and command.candidate_id == "defer_exercise":
            try:
                preview = read_exercise_preview(db, run_id)
                exercise = next(option for option in preview["options"] if option["candidate_id"] == "defer_exercise")
                reject_reason = exercise["reason_code"] if exercise["result"] != "feasible" else None
            except (LookupError, StopIteration):
                reject_reason = "EXERCISE_UNAVAILABLE"
        elif reject_reason is None:
            plan = evaluate_run(db, run_id)
            candidate = next(
                entry for entry in plan.candidates if entry.candidate_id == command.candidate_id
            )
            if candidate.result != "feasible":
                reject_reason = candidate.reason_code or "CO2_EVIDENCE_MISSING"

        if reject_reason is not None:
            return _save_receipt(
                db, run_id, command, digest,
                CrewActionReceipt(
                    operation_id=command.operation_id,
                    candidate_id=command.candidate_id,
                    status="rejected", reason_code=reject_reason,
                    basis_decision_rev=command.basis_decision_rev,
                    current_decision_rev=current_rev, applied=False,
                ),
            )

        # Accepting a command represents one operational effect in the journal.
        # A subsequent scenario reducer can consume the selected candidate,
        # while the decision revision prevents competing commands at this basis.
        receipt = CrewActionReceipt(
            operation_id=command.operation_id,
            candidate_id=command.candidate_id,
            status="accepted", reason_code=None,
            basis_decision_rev=current_rev,
            current_decision_rev=current_rev + 1, applied=True,
        )
        db.execute(
            "UPDATE runs SET decision_rev = decision_rev + 1 WHERE run_id = ?",
            (run_id,),
        )
        if exercise is not None:
            record_deferral(db, run_id, run["mission_s"], command.operation_id, exercise)
        event_id = f"action:{command.operation_id}"
        db.execute(
            """INSERT INTO events
               (run_id, event_seq, event_id, event_type, mission_s, visibility, payload_json)
               SELECT ?, COALESCE(MAX(event_seq), 0) + 1, ?, 'crew.action_committed', ?,
                      'operational', ? FROM events WHERE run_id = ?""",
            (
                run_id, event_id, run["mission_s"],
                json.dumps(
                    {"operation_id": command.operation_id,
                     "candidate_id": command.candidate_id,
                     "decision_rev": receipt.current_decision_rev},
                    sort_keys=True,
                ),
                run_id,
            ),
        )
        return _save_receipt(db, run_id, command, digest, receipt)

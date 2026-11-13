"""Persist synthetic Crew check-ins in the private event lane."""

import json
from hashlib import sha256
from pathlib import Path

from symbiosis_x.contracts.checkins import PrivateCheckInReceipt, PrivateCheckInRequest
from symbiosis_x.storage.repository import Repository


class CheckInNotFound(Exception):
    pass


class CheckInConflict(Exception):
    pass


def _synthetic_roster_ids() -> frozenset[str]:
    """Read the canonical synthetic roster; never accept caller-invented crew IDs."""
    roster_path = Path(__file__).resolve().parents[4] / "catalogs" / "crew" / "synthetic-roster.json"
    roster = json.loads(roster_path.read_text(encoding="utf-8"))
    if roster.get("synthetic") is not True:
        raise RuntimeError("crew roster must be synthetic")
    return frozenset(member["crew_id"] for member in roster["crew"])


def create_check_in(
    repository: Repository, run_id: str, command: PrivateCheckInRequest
) -> PrivateCheckInReceipt:
    if command.synthetic is not True:
        raise CheckInConflict("SYNTHETIC_CHECK_IN_REQUIRED")
    if not command.note.strip():
        raise CheckInConflict("CHECK_IN_NOTE_REQUIRED")
    if command.crew_id not in _synthetic_roster_ids():
        raise CheckInConflict("CREW_NOT_ON_ROSTER")

    digest = sha256(command.model_dump_json().encode()).hexdigest()
    with repository.write() as db:
        run = db.execute(
            "SELECT status, mission_s FROM runs WHERE run_id = ?", (run_id,)
        ).fetchone()
        if run is None:
            raise CheckInNotFound("RUN_NOT_FOUND")

        prior = db.execute(
            """SELECT payload_json FROM events
               WHERE run_id = ? AND event_id = ?
                 AND event_type = 'crew.check_in' AND visibility = 'crew'""",
            (run_id, command.check_in_id),
        ).fetchone()
        if prior is not None:
            stored = json.loads(prior["payload_json"])
            if stored.get("request_digest") != digest:
                raise CheckInConflict("CHECK_IN_ID_REUSED")
            return PrivateCheckInReceipt.model_validate(stored["receipt"])

        # Event IDs are unique across every event type and visibility in a run.
        collision = db.execute(
            "SELECT 1 FROM events WHERE run_id = ? AND event_id = ?",
            (run_id, command.check_in_id),
        ).fetchone()
        if collision is not None:
            raise CheckInConflict("CHECK_IN_ID_REUSED")

        if run["status"] != "active":
            raise CheckInConflict("RUN_CLOSED")

        receipt = PrivateCheckInReceipt(
            check_in_id=command.check_in_id,
            run_id=run_id,
            crew_id=command.crew_id,
            note=command.note,
            synthetic=True,
            mission_s=run["mission_s"],
        )
        payload = {
            "request_digest": digest,
            "receipt": receipt.model_dump(mode="json"),
        }
        event_seq = db.execute(
            "SELECT COALESCE(MAX(event_seq), 0) + 1 FROM events WHERE run_id = ?",
            (run_id,),
        ).fetchone()[0]
        db.execute(
            """INSERT INTO events
               (run_id, event_seq, event_id, event_type, mission_s, visibility, payload_json)
               VALUES (?, ?, ?, 'crew.check_in', ?, 'crew', ?)""",
            (
                run_id,
                event_seq,
                command.check_in_id,
                run["mission_s"],
                json.dumps(payload, separators=(",", ":"), sort_keys=True),
            ),
        )
    return receipt


def read_check_in(
    repository: Repository, run_id: str, check_in_id: str
) -> PrivateCheckInReceipt:
    with repository.read() as db:
        row = db.execute(
            """SELECT payload_json FROM events
               WHERE run_id = ? AND event_id = ?
                 AND event_type = 'crew.check_in' AND visibility = 'crew'""",
            (run_id, check_in_id),
        ).fetchone()
    if row is None:
        raise CheckInNotFound("CHECK_IN_NOT_FOUND")
    return PrivateCheckInReceipt.model_validate(
        json.loads(row["payload_json"])["receipt"]
    )

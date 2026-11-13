"""Queue immutable Ground snapshots and deliver them on mission time.

Relay runs inside the run writer's transaction. A queued snapshot is stored
once with its basis (snapshot ID and decision revision), observation time and
due time, and is never rewritten. Delivery only stamps the message with its
own due time, so a step that crosses several due times delivers each packet
at the time it was scheduled. The Ground projection reads delivered records
only; Relay never reads or writes plant state.
"""

import json
from hashlib import sha256
from secrets import token_hex
from sqlite3 import Connection, Row

from symbiosis_x.contracts.commands import (
    AdvisoryDisposition, AdvisoryReceipt, CaseRelayReceipt, GroundAdvisoryRequest, ShareCaseStatusRequest,
)
from symbiosis_x.contracts.projections import GroundCaseStatus, GroundPacket

# One-way link delay in the golden scenario: v102 observed 01:00 reaches Ground at 06:00,
# and advice issued at 08:00 reaches Crew at 13:00.
RELAY_DELAY_S = 300


class SnapshotConflict(Exception):
    """A snapshot or its delivery already exists with different content."""


class AdvisoryRejected(Exception):
    """Advice cannot be queued; the message is a public reason code."""


class CaseRelayRejected(Exception):
    """A health case status cannot be relayed or acknowledged; the message is a reason code."""


# Every scripted drill is an emergency, so Ground gets the same generic priority for
# all of them; the priority never reveals the drill kind.
EMERGENCY_REVIEW_PRIORITY = "urgent"
CASE_MESSAGE_PREFIX = "health-case:"


def message_id_for(snapshot_id: str) -> str:
    return f"relay:{snapshot_id}"


def queue_ground_snapshot(
    db: Connection, run_id: str, *, snapshot_id: str, decision_rev: int,
    observed_at_s: int, issued_at_s: int, deliver_at_s: int, packet: GroundPacket,
) -> str:
    """Store one operational packet for Ground and schedule its delivery.

    Replaying an identical request is a no-op. Any change to a stored packet,
    its basis or its schedule raises SnapshotConflict.
    """
    if not observed_at_s <= deliver_at_s or not issued_at_s <= deliver_at_s:
        raise ValueError("INVALID_DELIVERY_CHRONOLOGY")
    payload = GroundPacket.model_validate(packet.model_dump()).model_dump_json()
    message_id = message_id_for(snapshot_id)

    stored = db.execute(
        """SELECT decision_rev, observed_at_s, payload_json FROM snapshots
           WHERE run_id = ? AND snapshot_id = ? AND audience = 'ground'""",
        (run_id, snapshot_id),
    ).fetchone()
    scheduled = db.execute(
        """SELECT issued_at_s, deliver_at_s, ground_snapshot_id FROM messages
           WHERE run_id = ? AND message_id = ?""",
        (run_id, message_id),
    ).fetchone()
    if stored is not None or scheduled is not None:
        same = (
            stored is not None and scheduled is not None
            and tuple(stored) == (decision_rev, observed_at_s, payload)
            and tuple(scheduled) == (issued_at_s, deliver_at_s, snapshot_id)
        )
        if not same:
            raise SnapshotConflict("SNAPSHOT_IMMUTABLE")
        return message_id

    db.execute(
        """INSERT INTO snapshots (run_id, snapshot_id, audience, decision_rev, observed_at_s, payload_json)
           VALUES (?, ?, 'ground', ?, ?, ?)""",
        (run_id, snapshot_id, decision_rev, observed_at_s, payload),
    )
    db.execute(
        """INSERT INTO messages (run_id, message_id, direction, issued_at_s, deliver_at_s,
                                  ground_snapshot_id, payload_json)
           VALUES (?, ?, 'to_ground', ?, ?, ?, '{}')""",
        (run_id, message_id, issued_at_s, deliver_at_s, snapshot_id),
    )
    return message_id


def deliver_due(db: Connection, run_id: str, mission_s: int) -> list[str]:
    """Mark every Ground message due by mission_s as delivered at its due time."""
    due = [
        row["message_id"]
        for row in db.execute(
            """SELECT message_id FROM messages
               WHERE run_id = ? AND direction = 'to_ground'
                 AND delivered_at_s IS NULL AND deliver_at_s <= ?
               ORDER BY deliver_at_s, message_id""",
            (run_id, mission_s),
        )
    ]
    for message_id in due:
        db.execute(
            """UPDATE messages SET delivered_at_s = deliver_at_s
               WHERE run_id = ? AND message_id = ? AND delivered_at_s IS NULL""",
            (run_id, message_id),
        )
    return due


def queue_ground_advisory(
    db: Connection, run: Row, request: GroundAdvisoryRequest, *, expires_after_s: int | None = None,
) -> AdvisoryReceipt:
    """Queue Ground advice for Crew on a basis Ground has already received.

    Runs inside the caller's write transaction. A retried operation returns
    its stored receipt even after the run closes; reusing an operation ID for
    different advice raises OPERATION_ID_REUSED. The message is not delivered
    here: SX-07D classifies it when it reaches Crew.
    """
    run_id, mission_s = run["run_id"], run["mission_s"]
    digest = sha256(request.model_dump_json().encode()).hexdigest()
    prior = db.execute(
        """SELECT request_digest, receipt_json FROM operations
           WHERE run_id = ? AND operation_scope = 'ground_advisory' AND operation_id = ?""",
        (run_id, request.operation_id),
    ).fetchone()
    if prior is not None:
        if prior["request_digest"] != digest:
            raise AdvisoryRejected("OPERATION_ID_REUSED")
        return AdvisoryReceipt.model_validate_json(prior["receipt_json"])
    if run["status"] != "active":
        raise AdvisoryRejected("RUN_CLOSED")

    # Only a snapshot whose Ground delivery has happened can be cited. Unknown and
    # not-yet-delivered snapshots share one reason so Ground cannot probe the queue.
    basis = db.execute(
        """SELECT s.decision_rev FROM snapshots s
           JOIN messages m ON m.run_id = s.run_id AND m.ground_snapshot_id = s.snapshot_id
           WHERE s.run_id = ? AND s.snapshot_id = ? AND s.audience = 'ground'
             AND m.direction = 'to_ground' AND m.delivered_at_s IS NOT NULL AND m.delivered_at_s <= ?
           LIMIT 1""",
        (run_id, request.basis_snapshot_id, mission_s),
    ).fetchone()
    if basis is None:
        raise AdvisoryRejected("BASIS_NOT_DELIVERED")

    receipt = AdvisoryReceipt(
        operation_id=request.operation_id, run_id=run_id, status="queued",
        candidate_id=request.candidate_id, basis_snapshot_id=request.basis_snapshot_id,
        basis_decision_rev=basis["decision_rev"], issued_at_s=mission_s,
        deliver_at_s=mission_s + RELAY_DELAY_S,
    )
    payload = receipt.model_dump_json()
    # Expiry is a scenario or policy input, not something Ground chooses.
    expires_at_s = None if expires_after_s is None else mission_s + expires_after_s
    db.execute(
        """INSERT INTO messages (run_id, message_id, direction, issued_at_s, deliver_at_s,
                                  expires_at_s, ground_snapshot_id, payload_json)
           VALUES (?, ?, 'to_crew', ?, ?, ?, ?, ?)""",
        (run_id, f"advisory:{request.operation_id}", receipt.issued_at_s, receipt.deliver_at_s,
         expires_at_s, receipt.basis_snapshot_id, payload),
    )
    db.execute(
        """INSERT INTO events
           (run_id, event_seq, event_id, event_type, mission_s, visibility, payload_json)
           SELECT ?, COALESCE(MAX(event_seq), 0) + 1, ?, 'ground.advisory_issued', ?, 'operational', ?
           FROM events WHERE run_id = ?""",
        (run_id, f"advisory:{request.operation_id}", mission_s, payload, run_id),
    )
    db.execute(
        """INSERT INTO operations (run_id, operation_scope, operation_id, request_digest, receipt_json)
           VALUES (?, 'ground_advisory', ?, ?, ?)""",
        (run_id, request.operation_id, digest, payload),
    )
    return receipt


def receive_due_advisories(db: Connection, run_id: str, mission_s: int) -> list[AdvisoryDisposition]:
    """Receive Ground advice due onboard by mission_s and journal how each was classified.

    Advice arrives at its own due time. It is held when it expired before
    arrival or when its basis revision is older than the run's current
    decision revision; otherwise it may enter Crew review. Intake only records
    a disposition: it never applies a command or changes plant state, and Crew
    authorization is a separate request through the commit gate.
    """
    current_rev = db.execute("SELECT decision_rev FROM runs WHERE run_id = ?", (run_id,)).fetchone()[0]
    due = db.execute(
        """SELECT message_id, deliver_at_s, expires_at_s, payload_json FROM messages
           WHERE run_id = ? AND direction = 'to_crew'
             AND delivered_at_s IS NULL AND deliver_at_s <= ?
           ORDER BY deliver_at_s, message_id""",
        (run_id, mission_s),
    ).fetchall()
    dispositions = []
    for message in due:
        advice = AdvisoryReceipt.model_validate_json(message["payload_json"])
        arrived_at_s = message["deliver_at_s"]
        if message["expires_at_s"] is not None and message["expires_at_s"] < arrived_at_s:
            outcome, reason = "held", "ADVICE_EXPIRED"
        elif advice.basis_decision_rev < current_rev:
            outcome, reason = "held", "STALE_BASIS"
        else:
            outcome, reason = "crew_review", None
        disposition = AdvisoryDisposition(
            operation_id=advice.operation_id, disposition=outcome, reason_code=reason,
            candidate_id=advice.candidate_id, basis_snapshot_id=advice.basis_snapshot_id,
            basis_decision_rev=advice.basis_decision_rev, current_decision_rev=current_rev,
            received_at_s=arrived_at_s, applied=False,
        )
        db.execute(
            """UPDATE messages SET delivered_at_s = deliver_at_s
               WHERE run_id = ? AND message_id = ? AND delivered_at_s IS NULL""",
            (run_id, message["message_id"]),
        )
        db.execute(
            """INSERT INTO events
               (run_id, event_seq, event_id, event_type, mission_s, visibility, payload_json)
               SELECT ?, COALESCE(MAX(event_seq), 0) + 1, ?, 'crew.advisory_received', ?, 'operational', ?
               FROM events WHERE run_id = ?""",
            (run_id, f"received:{message['message_id']}", arrived_at_s,
             disposition.model_dump_json(), run_id),
        )
        dispositions.append(disposition)
    return dispositions


def _case_alias(db: Connection, run_id: str, case_id: str) -> str:
    """Return the case's random alias, creating it on first share.

    The alias is random rather than derived from the case: Ground knows the run
    ID and the drill IDs are predictable, so any hash of them could be reversed.
    The mapping stays onboard in the operations table, which Ground never reads.
    """
    row = db.execute(
        """SELECT receipt_json FROM operations
           WHERE run_id = ? AND operation_scope = 'case_alias' AND operation_id = ?""",
        (run_id, case_id),
    ).fetchone()
    if row is not None:
        return json.loads(row["receipt_json"])["case_alias"]
    alias = "health-case-" + token_hex(8)
    db.execute(
        """INSERT INTO operations (run_id, operation_scope, operation_id, request_digest, receipt_json)
           VALUES (?, 'case_alias', ?, ?, ?)""",
        (run_id, case_id, sha256(alias.encode()).hexdigest(), json.dumps({"case_alias": alias})),
    )
    return alias


def queue_case_status(
    db: Connection, run: Row, request: ShareCaseStatusRequest, *, case_id: str, status: str,
) -> CaseRelayReceipt:
    """Queue the approved minimal status of one onboard case for Ground.

    Only the alias, a generic review priority and the case status leave the
    ship; delivery time is added when the packet arrives. History, vitals,
    reports, crew IDs and onboard event times are never passed in. Runs inside
    the caller's write transaction and never touches the onboard case, so
    local escalation does not depend on it.
    """
    run_id, mission_s = run["run_id"], run["mission_s"]
    digest = sha256(f"{request.model_dump_json()}:{case_id}:{status}".encode()).hexdigest()
    prior = db.execute(
        """SELECT request_digest, receipt_json FROM operations
           WHERE run_id = ? AND operation_scope = 'case_relay' AND operation_id = ?""",
        (run_id, request.operation_id),
    ).fetchone()
    if prior is not None:
        if prior["request_digest"] != digest:
            raise CaseRelayRejected("OPERATION_ID_REUSED")
        return CaseRelayReceipt.model_validate_json(prior["receipt_json"])
    if run["status"] != "active":
        raise CaseRelayRejected("RUN_CLOSED")

    receipt = CaseRelayReceipt(
        operation_id=request.operation_id, case_alias=_case_alias(db, run_id, case_id),
        review_priority=EMERGENCY_REVIEW_PRIORITY, status=status,
        issued_at_s=mission_s, deliver_at_s=mission_s + RELAY_DELAY_S,
    )
    packet = receipt.model_dump_json(include={"case_alias", "review_priority", "status"})
    db.execute(
        """INSERT INTO messages (run_id, message_id, direction, issued_at_s, deliver_at_s, payload_json)
           VALUES (?, ?, 'to_ground', ?, ?, ?)""",
        (run_id, CASE_MESSAGE_PREFIX + request.operation_id, mission_s, receipt.deliver_at_s, packet),
    )
    db.execute(
        """INSERT INTO events
           (run_id, event_seq, event_id, event_type, mission_s, visibility, payload_json)
           SELECT ?, COALESCE(MAX(event_seq), 0) + 1, ?, 'relay.case_status_queued', ?, 'operational', ?
           FROM events WHERE run_id = ?""",
        (run_id, f"case-relay:{request.operation_id}", mission_s, packet, run_id),
    )
    db.execute(
        """INSERT INTO operations (run_id, operation_scope, operation_id, request_digest, receipt_json)
           VALUES (?, 'case_relay', ?, ?, ?)""",
        (run_id, request.operation_id, digest, receipt.model_dump_json()),
    )
    return receipt


def _latest_delivered_cases(db: Connection, run_id: str, mission_s: int) -> dict[str, Row]:
    rows = db.execute(
        """SELECT message_id, delivered_at_s, acknowledged_at_s, payload_json FROM messages
           WHERE run_id = ? AND direction = 'to_ground' AND message_id LIKE ?
             AND delivered_at_s IS NOT NULL AND delivered_at_s <= ?
           ORDER BY delivered_at_s, message_id""",
        (run_id, CASE_MESSAGE_PREFIX + "%", mission_s),
    ).fetchall()
    latest: dict[str, Row] = {}
    for row in rows:
        latest[json.loads(row["payload_json"])["case_alias"]] = row
    return latest


def ground_case_statuses(db: Connection, run_id: str, mission_s: int) -> list[GroundCaseStatus]:
    """Ground's view: the newest delivered status per case, nothing before delivery."""
    statuses = []
    for alias, row in _latest_delivered_cases(db, run_id, mission_s).items():
        packet = json.loads(row["payload_json"])
        acknowledged = row["acknowledged_at_s"]
        statuses.append(GroundCaseStatus(
            case_alias=alias, review_priority=packet["review_priority"], status=packet["status"],
            delivered_at_s=row["delivered_at_s"],
            ground_ack="pending" if acknowledged is None else "acknowledged",
            ground_acknowledged_at_s=acknowledged,
        ))
    return statuses


def acknowledge_ground_case(db: Connection, run: Row, alias: str) -> GroundCaseStatus:
    """Record that Ground received the newest delivered status for one case.

    The acknowledgment is a separate Ground event. It never changes the onboard
    case, and repeating it returns the original acknowledgment time.
    """
    run_id, mission_s = run["run_id"], run["mission_s"]
    row = _latest_delivered_cases(db, run_id, mission_s).get(alias)
    if row is None:
        # Unknown and not-yet-delivered cases look the same, so Ground cannot probe the queue.
        raise CaseRelayRejected("CASE_NOT_DELIVERED")
    if row["acknowledged_at_s"] is None:
        if run["status"] != "active":
            raise CaseRelayRejected("RUN_CLOSED")
        db.execute(
            """UPDATE messages SET acknowledged_at_s = ?
               WHERE run_id = ? AND message_id = ? AND acknowledged_at_s IS NULL""",
            (mission_s, run_id, row["message_id"]),
        )
        db.execute(
            """INSERT INTO events
               (run_id, event_seq, event_id, event_type, mission_s, visibility, payload_json)
               SELECT ?, COALESCE(MAX(event_seq), 0) + 1, ?, 'ground.case_acknowledged', ?, 'operational', ?
               FROM events WHERE run_id = ?""",
            (run_id, f"case-ack:{row['message_id']}", mission_s,
             json.dumps({"case_alias": alias}), run_id),
        )
    return next(status for status in ground_case_statuses(db, run_id, mission_s) if status.case_alias == alias)

"""Queue immutable Ground snapshots and deliver them on mission time.

Relay runs inside the run writer's transaction. A queued snapshot is stored
once with its basis (snapshot ID and decision revision), observation time and
due time, and is never rewritten. Delivery only stamps the message with its
own due time, so a step that crosses several due times delivers each packet
at the time it was scheduled. The Ground projection reads delivered records
only; Relay never reads or writes plant state.
"""

from sqlite3 import Connection

from symbiosis_x.contracts.projections import GroundPacket


class SnapshotConflict(Exception):
    """A snapshot or its delivery already exists with different content."""


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

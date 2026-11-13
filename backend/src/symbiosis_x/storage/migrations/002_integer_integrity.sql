-- Keep journal cursors and mission times integral on both new and existing databases.

-- The guard rejects invalid revision-1 data without modifying the database.

CREATE TEMP TABLE validate_revision_2 (ok INTEGER NOT NULL CHECK (ok = 1));

INSERT INTO validate_revision_2 SELECT 0 FROM runs WHERE
        typeof(seed) <> 'integer'
        OR typeof(schema_version) <> 'integer'
        OR typeof(mission_s) <> 'integer'
        OR typeof(decision_rev) <> 'integer'
LIMIT 1;

INSERT INTO validate_revision_2 SELECT 0 FROM events WHERE
        typeof(event_seq) <> 'integer'
        OR typeof(mission_s) <> 'integer'
LIMIT 1;

INSERT INTO validate_revision_2 SELECT 0 FROM snapshots WHERE
        typeof(decision_rev) <> 'integer'
        OR typeof(observed_at_s) <> 'integer'
LIMIT 1;

INSERT INTO validate_revision_2 SELECT 0 FROM messages WHERE
        typeof(issued_at_s) <> 'integer'
        OR typeof(deliver_at_s) <> 'integer'
        OR typeof(expires_at_s) NOT IN ('integer', 'null')
        OR typeof(delivered_at_s) NOT IN ('integer', 'null')
        OR typeof(acknowledged_at_s) NOT IN ('integer', 'null')
LIMIT 1;

DROP TABLE validate_revision_2;

CREATE TRIGGER runs_integer_insert
BEFORE INSERT ON runs
WHEN typeof(NEW.seed) <> 'integer'
        OR typeof(NEW.schema_version) <> 'integer'
        OR typeof(NEW.mission_s) <> 'integer'
        OR typeof(NEW.decision_rev) <> 'integer'
BEGIN
    SELECT RAISE(ABORT, 'runs integer fields require integer values');
END;

CREATE TRIGGER runs_integer_update
BEFORE UPDATE OF seed, schema_version, mission_s, decision_rev ON runs
WHEN typeof(NEW.seed) <> 'integer'
        OR typeof(NEW.schema_version) <> 'integer'
        OR typeof(NEW.mission_s) <> 'integer'
        OR typeof(NEW.decision_rev) <> 'integer'
BEGIN
    SELECT RAISE(ABORT, 'runs integer fields require integer values');
END;

CREATE TRIGGER events_integer_insert
BEFORE INSERT ON events
WHEN typeof(NEW.event_seq) <> 'integer'
        OR typeof(NEW.mission_s) <> 'integer'
BEGIN
    SELECT RAISE(ABORT, 'events integer fields require integer values');
END;

CREATE TRIGGER events_integer_update
BEFORE UPDATE OF event_seq, mission_s ON events
WHEN typeof(NEW.event_seq) <> 'integer'
        OR typeof(NEW.mission_s) <> 'integer'
BEGIN
    SELECT RAISE(ABORT, 'events integer fields require integer values');
END;

CREATE TRIGGER snapshots_integer_insert
BEFORE INSERT ON snapshots
WHEN typeof(NEW.decision_rev) <> 'integer'
        OR typeof(NEW.observed_at_s) <> 'integer'
BEGIN
    SELECT RAISE(ABORT, 'snapshots integer fields require integer values');
END;

CREATE TRIGGER snapshots_integer_update
BEFORE UPDATE OF decision_rev, observed_at_s ON snapshots
WHEN typeof(NEW.decision_rev) <> 'integer'
        OR typeof(NEW.observed_at_s) <> 'integer'
BEGIN
    SELECT RAISE(ABORT, 'snapshots integer fields require integer values');
END;

CREATE TRIGGER messages_integer_insert
BEFORE INSERT ON messages
WHEN typeof(NEW.issued_at_s) <> 'integer'
        OR typeof(NEW.deliver_at_s) <> 'integer'
        OR typeof(NEW.expires_at_s) NOT IN ('integer', 'null')
        OR typeof(NEW.delivered_at_s) NOT IN ('integer', 'null')
        OR typeof(NEW.acknowledged_at_s) NOT IN ('integer', 'null')
BEGIN
    SELECT RAISE(ABORT, 'messages integer fields require integer values');
END;

CREATE TRIGGER messages_integer_update
BEFORE UPDATE OF issued_at_s, deliver_at_s, expires_at_s, delivered_at_s, acknowledged_at_s ON messages
WHEN typeof(NEW.issued_at_s) <> 'integer'
        OR typeof(NEW.deliver_at_s) <> 'integer'
        OR typeof(NEW.expires_at_s) NOT IN ('integer', 'null')
        OR typeof(NEW.delivered_at_s) NOT IN ('integer', 'null')
        OR typeof(NEW.acknowledged_at_s) NOT IN ('integer', 'null')
BEGIN
    SELECT RAISE(ABORT, 'messages integer fields require integer values');
END;

PRAGMA user_version = 2;

-- The application applies this migration in a single write transaction.
CREATE TABLE runs (
    run_id TEXT PRIMARY KEY NOT NULL,
    scenario_id TEXT NOT NULL,
    scenario_version TEXT NOT NULL,
    seed INTEGER NOT NULL,
    schema_version INTEGER NOT NULL CHECK (schema_version > 0),
    model_version TEXT NOT NULL,
    policy_version TEXT NOT NULL,
    mission_s INTEGER NOT NULL DEFAULT 0 CHECK (mission_s >= 0),
    decision_rev INTEGER NOT NULL DEFAULT 0 CHECK (decision_rev >= 0),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
    reset_from_run_id TEXT REFERENCES runs (run_id),
    start_actor_id TEXT,
    start_id TEXT,
    start_request_digest TEXT,
    UNIQUE (start_actor_id, start_id),
    CHECK (
        (start_actor_id IS NULL AND start_id IS NULL AND start_request_digest IS NULL)
        OR (start_actor_id IS NOT NULL AND start_id IS NOT NULL AND start_request_digest IS NOT NULL)
    )
);

CREATE TABLE events (
    run_id TEXT NOT NULL REFERENCES runs (run_id),
    event_seq INTEGER NOT NULL CHECK (event_seq > 0),
    event_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    mission_s INTEGER NOT NULL CHECK (mission_s >= 0),
    visibility TEXT NOT NULL CHECK (visibility IN ('crew', 'operational')),
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    PRIMARY KEY (run_id, event_seq),
    UNIQUE (run_id, event_id)
);

CREATE TABLE operations (
    run_id TEXT NOT NULL REFERENCES runs (run_id),
    operation_scope TEXT NOT NULL,
    operation_id TEXT NOT NULL,
    request_digest TEXT NOT NULL,
    receipt_json TEXT NOT NULL CHECK (json_valid(receipt_json)),
    PRIMARY KEY (run_id, operation_scope, operation_id)
);

CREATE TABLE snapshots (
    run_id TEXT NOT NULL REFERENCES runs (run_id),
    snapshot_id TEXT NOT NULL,
    audience TEXT NOT NULL CHECK (audience IN ('crew', 'ground')),
    decision_rev INTEGER NOT NULL CHECK (decision_rev >= 0),
    observed_at_s INTEGER NOT NULL,
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    PRIMARY KEY (run_id, snapshot_id),
    UNIQUE (run_id, snapshot_id, audience)
);

CREATE TABLE messages (
    run_id TEXT NOT NULL REFERENCES runs (run_id),
    message_id TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('to_ground', 'to_crew')),
    issued_at_s INTEGER NOT NULL CHECK (issued_at_s >= 0),
    deliver_at_s INTEGER NOT NULL CHECK (deliver_at_s >= issued_at_s),
    expires_at_s INTEGER CHECK (expires_at_s >= issued_at_s),
    delivered_at_s INTEGER CHECK (delivered_at_s >= deliver_at_s),
    acknowledged_at_s INTEGER CHECK (
        acknowledged_at_s IS NULL OR
        (delivered_at_s IS NOT NULL AND acknowledged_at_s >= delivered_at_s)
    ),
    ground_snapshot_id TEXT,
    snapshot_audience TEXT NOT NULL DEFAULT 'ground' CHECK (snapshot_audience = 'ground'),
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    PRIMARY KEY (run_id, message_id),
    FOREIGN KEY (run_id, ground_snapshot_id, snapshot_audience)
        REFERENCES snapshots (run_id, snapshot_id, audience)
);

CREATE INDEX messages_due_idx ON messages (run_id, deliver_at_s, message_id)
    WHERE delivered_at_s IS NULL;

PRAGMA user_version = 1;

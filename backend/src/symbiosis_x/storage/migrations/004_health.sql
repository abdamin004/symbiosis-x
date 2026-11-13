-- SX-25A: onboard emergency drill cases. The application applies this
-- migration in a single write transaction.
--
-- A case is opened locally by an authorized Crew user and lives in the Crew
-- lane only. Opening it never reads or writes relay messages or Ground
-- snapshots, so it works during a communication blackout. One case per drill
-- per run; the operation ID makes a repeated request return the same case.
CREATE TABLE emergency_cases (
    run_id TEXT NOT NULL REFERENCES runs (run_id),
    case_id TEXT NOT NULL,
    drill_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('chest_pain', 'collapse')),
    operation_id TEXT NOT NULL,
    request_digest TEXT NOT NULL,
    event_id TEXT NOT NULL,
    visibility TEXT NOT NULL DEFAULT 'crew' CHECK (visibility = 'crew'),
    opened_at_s INTEGER NOT NULL CHECK (opened_at_s >= 0),
    subject_crew_id TEXT NOT NULL,
    reported_by TEXT NOT NULL,
    report_kind TEXT NOT NULL
        CHECK (report_kind IN ('direct_symptom_report', 'bystander_report')),
    responsiveness TEXT
        CHECK (responsiveness IS NULL OR responsiveness IN ('responsive', 'unresponsive', 'unknown')),
    responder_crew_id TEXT NOT NULL,
    acknowledged_at_s INTEGER CHECK (acknowledged_at_s IS NULL OR acknowledged_at_s >= opened_at_s),
    acknowledged_by TEXT,
    case_json TEXT NOT NULL CHECK (json_valid(case_json)),
    PRIMARY KEY (run_id, case_id),
    UNIQUE (run_id, drill_id),
    UNIQUE (run_id, operation_id),
    CHECK (
        (kind = 'chest_pain' AND report_kind = 'direct_symptom_report' AND responsiveness IS NULL)
        OR (kind = 'collapse' AND report_kind = 'bystander_report' AND responsiveness IS NOT NULL)
    ),
    CHECK ((acknowledged_at_s IS NULL) = (acknowledged_by IS NULL)),
    FOREIGN KEY (run_id, event_id, visibility)
        REFERENCES events (run_id, event_id, visibility)
);

PRAGMA user_version = 4;

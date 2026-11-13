-- SX-15: explicit facilitator-controlled pause for the optional run driver.
-- Manual facilitator advance is intentionally independent of this flag.
CREATE TABLE run_driver_state (
    run_id TEXT PRIMARY KEY NOT NULL REFERENCES runs (run_id),
    paused INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0, 1))
) STRICT;

PRAGMA user_version = 5;

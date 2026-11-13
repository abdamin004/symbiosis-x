-- The journal owns event identity. Include visibility in the projection foreign
-- keys so a private journal event cannot become operational telemetry.
CREATE UNIQUE INDEX events_projection_key ON events (run_id, event_id, visibility);

CREATE TABLE telemetry_observations (
    run_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    visibility TEXT NOT NULL DEFAULT 'operational' CHECK (visibility = 'operational'),
    entity_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    metric TEXT NOT NULL,
    observed_at_s INTEGER NOT NULL,
    received_at_s INTEGER NOT NULL CHECK (received_at_s >= observed_at_s),
    value REAL,
    unit TEXT NOT NULL,
    quality TEXT NOT NULL CHECK (quality IN ('valid', 'suspect', 'unavailable')),
    model_version TEXT NOT NULL,
    CHECK ((quality = 'unavailable') = (value IS NULL)),
    PRIMARY KEY (run_id, event_id),
    FOREIGN KEY (run_id, event_id, visibility)
        REFERENCES events (run_id, event_id, visibility)
) STRICT;

CREATE INDEX telemetry_series_time
    ON telemetry_observations (run_id, entity_id, metric, observed_at_s, event_id);

CREATE TABLE health_observations (
    run_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    visibility TEXT NOT NULL DEFAULT 'crew' CHECK (visibility = 'crew'),
    crew_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    metric TEXT NOT NULL,
    observed_at_s INTEGER NOT NULL,
    received_at_s INTEGER NOT NULL CHECK (received_at_s >= observed_at_s),
    numeric_value REAL,
    unit TEXT,
    structured_value_json TEXT CHECK (json_type(structured_value_json) = 'object'),
    context_json TEXT NOT NULL CHECK (json_type(context_json) = 'object'),
    quality TEXT NOT NULL CHECK (quality IN ('valid', 'suspect', 'unavailable')),
    CHECK ((numeric_value IS NULL) = (unit IS NULL)),
    CHECK (
        (quality = 'unavailable' AND numeric_value IS NULL AND structured_value_json IS NULL)
        OR (quality <> 'unavailable' AND
            ((numeric_value IS NOT NULL) <> (structured_value_json IS NOT NULL)))
    ),
    PRIMARY KEY (run_id, event_id),
    FOREIGN KEY (run_id, event_id, visibility)
        REFERENCES events (run_id, event_id, visibility)
) STRICT;

CREATE INDEX health_series_time
    ON health_observations (run_id, crew_id, metric, observed_at_s, event_id);

PRAGMA user_version = 3;

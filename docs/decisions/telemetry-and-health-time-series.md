# Time series for telemetry and health observations

Use timestamped, append-only observations for spacecraft telemetry and time-varying Crew health data. Keep SQLite for the pilot. Profiles, medical history, and versioned baselines remain records linked to the appropriate astronaut and run.

## Observation contract

Keep the run ID, entity or astronaut ID, metric, source ID, value and unit, quality, and provenance with every observation. Store integer mission seconds for the observed and received times. Preserve original UTC timestamps for imported datasets and record their mission-time alignment separately. Delivery to Ground has its own timestamp and snapshot revision. Use a stable event ID to deduplicate writes within a run. Order observations by observed time for trends, with a stable tie-breaker for equal times.

Sample spacecraft telemetry on its configured cadence. Record Crew measurements when they happen and preserve context such as method, resting or post-activity state, and meal timing where relevant. Keep blood-pressure pairs together, represent sleep with interval boundaries, and store symptom reports as structured events with optional private text. Treat unavailable, late and rejected samples explicitly. Missing samples create gaps, and late samples do not overwrite a newer current value.

## SQLite and access

Keep the existing event journal for audit and replay. When implementing history queries, add typed observation tables or projections maintained in the same transaction as the journal. Use a composite index beginning with run, entity or astronaut, and metric, followed by observation time. Confirm the index against actual history queries and measure the workload before adopting a separate time-series engine. SQLite supports indexed range queries and window functions. [SQLite query planning](https://www.sqlite.org/queryplanner.html#searchsort) · [SQLite window functions](https://www.sqlite.org/windowfunctions.html)

Serve operational telemetry and private health series through their respective authorized queries. Build Ground views from delivered operational snapshots and approved case status. Keep private readings, baseline history and symptom notes out of Ground responses, shared exports and Ground agent tools.

## What this unlocks

Start with an explainable CO₂ trend and a within-person health trend over comparable readings. Return the window, contributing observation IDs, sample count, freshness and missing-data status. Agents can request bounded, role-scoped history and explain deterministic flags using that evidence. If a later ML experiment has a clear prediction target, compare it with those rules on held-out runs. Evaluate synthetic replay and external evidence separately.

KAN-23 establishes the first CO₂ source and observation envelope. It samples selected replay checkpoints in the standalone deck. Persistence, continuous sampling and trend queries come in subsequent slices.

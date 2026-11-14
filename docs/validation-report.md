# Thirty-day synthetic mission validation

**78 of 78 authored events recognized by the replay checks.**

Seed 4242. Four fictional crew members, 30 mission days and eight scheduled indicators. The run has 960 observation slots and 12 retry deliveries. Evidence stays inside an isolated SQLite run.

| Event type | Recognized | Authored |
| --- | ---: | ---: |
| Abnormal reading | 12 | 12 |
| Duplicate retry | 12 | 12 |
| Emergency trigger | 6 | 6 |
| Late packet | 12 | 12 |
| Missing run | 12 | 12 |
| Sensor artifact | 12 | 12 |
| Slow trend | 12 | 12 |

False review alerts on clean crew-days — 0 of 20.
Missing data shown as normal — 0.

The harness replays arrival timestamps, persists observations through Crew measurement code and checks the assessment, trend, and reminder at each receipt. A missing run contains three explicit unavailable results. A retry must return the original receipt and leave one row in the ledger. Emergency checks use independent runs to exercise each case's existing single-open contract.

Daily drift uses one comparable observation per day over a four-day window. Each metric has a synthetic demo threshold. Blood pressure drift uses systolic pressure with matching method and posture. Symptom drift counts distinct reported labels without revealing private notes. Clean crew-days exclude authored event days and days whose four-day trend window contains injected drift. The reference comparisons in individual assessments retain their sourced Earth-based scope.

These results measure behavior on a seeded fixture of authored cases. The data and rules are for training simulation.

Regenerate and check the committed artifacts with `PYTHONPATH=backend/src python scripts/generate_mission_dataset.py --check`.

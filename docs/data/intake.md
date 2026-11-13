# Data intake log

SX-12. One entry per dataset received from outside the project. Each entry
records where the data came from, what we may do with it, how to recognise the
exact version, its units, timebase, coverage and privacy class, and a manual
trace of one sample row. Anything we could not confirm stays **pending**. A
pending field is never filled in with a guess.

The original export stays outside the repository. Only the adapter output is
committed, and it can be checked against the original with the hash below.
Synthetic fixtures such as `scenarios/variants/organizer-replay.json` are not
received data and are not logged here.

## RAD-001 · NASA OSDR RadLab, ISS DosTel1 absorbed dose rate

| Field | Record | Status |
|---|---|---|
| Source | NASA Open Science Data Repository (OSDR) RadLab. [Portal](https://visualization.osdr.nasa.gov/radlab/gui/overview), [data API guide](https://visualization.osdr.nasa.gov/radlab/gui/data-api/) | Confirmed |
| Request | [CSV export query](https://visualization.osdr.nasa.gov/radlab/api/?spacecraft=ISS&instrument_id=DosTel1&timestamp%3E=2022-04-01T00%3A00%3A00&timestamp%3C2022-04-01T00%3A20%3A00&absorbed_dose_rate&format=csv): spacecraft ISS, instrument DosTel1, field `absorbed_dose_rate` | Confirmed |
| Permitted use | No licence or data-use statement is recorded for this export yet. Use is limited to labelled mission context in the local demo until the owner records one. | **Pending** |
| Version | The API returns no dataset version. Identified by the query above, retrieved again on 2026-11-13. The export (805 bytes, 15 data rows) has SHA-256 `3f9e2fc18a8a973d0c1f9b9c4e6a953a87732076dd6249fe352fae39e0274295`. If NASA reprocesses the data, the hash changes. | Recorded |
| Adapter output | `contracts/examples/radlab-instrument-series.json`, written by `backend/src/symbiosis_x/crew/radiation.py` (SX-19). SHA-256 `0be0ff8a60ed97b2e0d603de09e5aac24ca25078f939e2fe35639623bc1723d1`. | Recorded |
| Units | The adapter records µGy/hour. The CSV header names the column `absorbed_dose_rate` but carries no unit. This review did not check the unit against NASA documentation. | **Pending** |
| Timebase | Source timestamps have no UTC offset (for example `2022-04-01T00:00:00`). The adapter treats them as UTC and appends `Z`. The source does not state this. | **Pending** |
| Coverage | 2022-04-01 00:00:00 to 00:18:54 (query window 00:00 to 00:20). 15 rows, irregularly spaced: the gaps run from 10 s to 3 min 20 s. No missing values in this window. Gaps are shown as gaps and never interpolated. | Confirmed |
| Privacy | Instrument telemetry from an ISS dosimeter, with no person identifiers. It is not any astronaut's personal dose and not a health alert threshold. It is shown only as supporting context in the Crew console. | Confirmed |
| Mission time | Archive timestamps are observation times in 2022 UTC. They are not mapped onto scenario mission time and are never shown as current telemetry. | Confirmed |

### Sample row trace

Manual review on 2026-11-13, tracing the third row end to end:

| Step | Value |
|---|---|
| Source row in the export | `"2022-04-01T00:03:30","DosTel1",2.21904,"ISS"` |
| Adapter output point | `{"timestamp_utc": "2022-04-01T00:03:30Z", "value": 2.21904}` |
| Instrument and spacecraft | DosTel1 on ISS, matching the series header |
| Quantity and unit | `absorbed_dose_rate`, µGy/hour. The unit is pending, as above. |
| Time | Observed at 2022-04-01 00:03:30. The UTC reading is pending, as above. |
| Permission | Pending, as above |
| Shown in | Crew console › Supporting context › Archived radiation context, labelled with the source and the query link |

All 15 rows of the re-fetched export match the committed adapter output exactly
in timestamp (with `Z` appended) and value. Neither the row count nor the
missing-value count changed.

### Open items

1. Record the OSDR data-use terms for RadLab exports. Owner: Mohamed (SX-12).
2. Confirm the unit and the timezone of `absorbed_dose_rate` from NASA documentation, and cite the page here.
3. Until items 1 and 2 are closed, SX-12B must not treat this series as an approved sample.

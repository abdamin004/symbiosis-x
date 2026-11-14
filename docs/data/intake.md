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

## Inspiration4 research evidence

Opened and checked on 2026-11-14. The official NASA mission collection links OSD-569 whole blood, OSD-571 plasma and OSD-575 serum. It describes four private astronauts on a three-day flight and outlines the controlled-access process for raw sensitive materials. The prototype uses public study metadata and aggregate published findings for research context. Crew readings, histories, baselines and demo limits are synthetic. [NASA Inspiration4 datasets](https://www.nasa.gov/osdr-latest-news-i4-mission-datasets/) · [OSDR mission index](https://osdr.nasa.gov/bio/repo/data/missions/SpaceX%20Inspiration4)

The public investigation, study and assay (ISA) ZIPs were fetched from the OSDR file inventory. The bytes were hashed directly and each ZIP passed archive integrity checks. Verification extracted only distinct mission-relative time labels and assay labels from the metadata. Archive bytes and participant-level rows were excluded from the repository.

| Source and file inventory | Public ISA archive | Bytes | SHA-256 | Supports this visible feature |
|---|---|---:|---|---|
| [OSD-569](https://osdr.nasa.gov/bio/repo/data/studies/OSD-569) · [File inventory](https://osdr.nasa.gov/osdr/data/osd/files/569) | `OSD-569_metadata_OSD-569-ISA.zip` | 123512 | `5b3c19c5079816b283125caf4009db8e39d48377d92763e9e61e86e3e1b4c159` | Whole-blood row in the NASA research card |
| [OSD-571](https://osdr.nasa.gov/bio/repo/data/studies/OSD-571) · [File inventory](https://osdr.nasa.gov/osdr/data/osd/files/571) | `OSD-571_metadata_OSD-571-ISA.zip` | 172450 | `75ea258ef5b0157adf5697e1ce60396c22a66fb373e5ee1cca6eae03662c32aa` | Plasma row in the NASA research card |
| [OSD-575 v3](https://osdr.nasa.gov/bio/repo/data/studies/OSD-575) · [File inventory](https://osdr.nasa.gov/osdr/data/osd/files/575) | `OSD-575_metadata_OSD-575-ISA.zip` | 71702 | `a1d3e49e2b61ab427a8760d0c98e0324a53272d0e1314632290266b014476f1d` | Serum row and laboratory assay units in the NASA research card |

The metadata lists L−92, L−44, L−3, R+1, R+45, R+82 and R+194 across each study’s assay collection, with L and R in days relative to launch and return. Each schedule varies by assay. The OSD-575 study description lists the first six timepoints. Its public submitted comprehensive metabolic panel CSV also contains R+194, consistent with the ISA sample table. The display labels that extra point for the metabolic panel specifically.

| Other source opened 2026-11-14 | Evidence reviewed | Supports this visible feature |
|---|---|---|
| [Jones et al., *Nature* 632, 1155–1164, 2024](https://pmc.ncbi.nlm.nih.gov/articles/PMC11357997/) · DOI `10.1038/s41586-024-07648-x` | Cardiovascular results and Fig. 5f describe a positive association between higher cabin CO₂ and higher HRV for 3 of 4 crew members in flight. Extended Data Fig. 10 and the survey methods specify self-reported sleep timing, sleep quality and behavioral ratings. | Context for pairing ship CO₂ with crew observations. The fictional heart-rate reading uses bpm, while the paper’s HRV measure uses ms. The association supplies neither a cause for the demo alert nor a threshold. |
| [NASA Spaceflight Standard Measures](https://www.nasa.gov/directorates/smd/space-life-physical-sciences-research-applications-division/human-research-program/spaceflight-standard-measures-characterizing-how-humans-adapt-in-space/) | The actigraphy, sleep quality and team questionnaire, and sensorimotor bullets describe physical activity and sleep tracking, self-reported sleep and mood, and preflight and postflight heart rate and blood pressure. | Measurement context labels and the distinction between sleep duration and reported quality in the astronaut twin |
| [NASA Flight Crew Physiological Data for Crew State Monitoring](https://catalog.data.gov/dataset/flight-crew-physiological-data-for-crew-state-monitoring) | The description identifies pilot and copilot pairs in controlled sessions and an aviation flight simulator. | Reviewed as a potential aviation comparator. The prototype and validation report use synthetic training data. |

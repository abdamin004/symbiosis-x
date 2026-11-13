# Acceptance evidence

This file records how each external source supports a visible SYMBIOSIS X feature, and the review that checked it. All astronaut data in the product is synthetic (SIM-01 to SIM-04). Real NASA data appears only as labelled environmental context.

## Source register

Each entry lists the link, source date, data type, coverage and units where they apply, limitations, and the visible feature it supports. Environmental context and personal measurements are kept in separate tables, as they are in the product: the RadLab chart is never mixed with astronaut readings.

### A. Mission operations and medical autonomy (NASA ExMC and HRP)

| ID | Source | Source date | Data type | Limitations | Supports this visible feature |
| --- | --- | --- | --- | --- | --- |
| S1 | NASA ExMC, [*Exploration Medical Capability Clinical Decision Support System Concept of Operations*](https://ntrs.nasa.gov/citations/20220017856), NTRS 20220017856 (Ames Research Center; Krihak, Russell, Shetye, Shaw) | Published 2021-03-01; added to NTRS 2022-12-01 | HRP project document (concept of operations). No dataset. | It describes a proposed onboard decision-support concept, not a flight-certified system or treatment protocols. | **Emergency Assist** (`/runs/:runId/crew/emergency`): a case opens, gets a local responder and is acknowledged onboard without Ground (SX-25A). Also the **Crew Health** explained assessment (SX-23D). The document says deep-space crews face delayed or no communication and must be more self-reliant than in low Earth orbit. |
| S2 | NASA HRP, [*5 Hazards of Human Spaceflight*](https://www.nasa.gov/hrp/hazards/) | Page last updated 2026-06-12 | Program overview web page | General public overview with no quantitative limits. | **Emergency Assist** and the **Ground** delayed view: the "Distance from Earth" hazard says medical care becomes harder to receive from Earth and self-sufficiency is key, which is why the local alert never waits for Ground. |
| S3 | NASA HRP, [*Human Research Program*](https://www.nasa.gov/hrp/) and [*Risks of Human Spaceflight*](https://www.nasa.gov/hrp/risks/) | Viewed 2026-11-13 (no page date shown) | Program overview web pages | The current HRP page lists elements such as Space Radiation and Human Health Countermeasures, but not ExMC by name. ExMC is cited through S1, which identifies itself as an HRP project document. | Context for the **Crew Health** page as a whole: HRP studies how spaceflight hazards, including radiation, isolation and distance, affect crew health. |

### B. Environmental context (RadLab, radiation and cabin atmosphere)

| ID | Source | Source date | Data type | Coverage and units | Limitations | Supports this visible feature |
| --- | --- | --- | --- | --- | --- | --- |
| E1 | NASA OSDR RadLab [portal](https://visualization.osdr.nasa.gov/radlab/gui/overview) and [Data API guide](https://visualization.osdr.nasa.gov/radlab/gui/data-api/) | Viewed 2026-11-13 | Spacecraft radiation instrument telemetry (archive) | The API guide defines `absorbed_dose_rate` in μGy/hour and `dose_equivalent_rate` in μSv/hour, with ISO timestamps. | Instrument readings at a spacecraft location, not a crew member's personal dose. CSV timestamps have no offset, so the parser records "interpreted as UTC". | **Crew Health → Archived radiation context** chart (`RadiationContext.jsx`): instrument, quantity, unit, UTC coverage and gaps. |
| E2 | RadLab [CSV export](https://visualization.osdr.nasa.gov/radlab/api/?spacecraft=ISS&instrument_id=DosTel1&timestamp%3E=2022-04-01T00%3A00%3A00&timestamp%3C2022-04-01T00%3A20%3A00&absorbed_dose_rate&format=csv): ISS, DosTel1, absorbed dose rate | Data from 2022-04-01, 00:00:00 to 00:18:54 UTC. Export rerun 2026-11-13. | Time series (CSV) | 15 rows, 0 missing, μGy/hour. Stored as `contracts/examples/radlab-instrument-series.json`. | A 19-minute ISS slice in low Earth orbit. It is shown for context and does not drive any assessment, alert or plant input. | The same chart. Its points are this export. |
| E3 | NASA Science Data, [*May 2026 Science Data and Software Highlights*](https://science.data.nasa.gov/features-events/data-software-highlights-may-2026) | Published 2026-06-04, updated 2026-08-12 | News note | Announces the RadLab update with Artemis I Orion radiation data. The product's chart still uses the ISS slice in E2, not Artemis I. | Provenance of the **Archived radiation context** source: RadLab is a maintained NASA OSDR portal. |
| E4 | NASA HRP, [*Hazard: Space Radiation*](https://www.nasa.gov/hrp/hazard-space-radiation/) | Page last updated 2025-06-05 | Program overview web page | Qualitative. Gives no dose limits. | Why the **Crew Health** page shows radiation at all: crews can't see or feel radiation, and NASA works on ways to monitor it. |
| E5 | NASA-STD-3001 Vol. 2, [*6.0 Natural and Induced Environments*](https://www.nasa.gov/reference/6-0-natural-and-induced-environments-vol-2/), requirement V2 6004 | Page last updated 2026-04-21 | Technical standard | V2 6004: average one-hour ppCO₂ in the habitable volume no more than 3 mmHg. | The product's 3,200 ppm planner limit is a labelled demo rule, not V2 6004. A one-hour ppCO₂ check needs supported pressure and enough time coverage, which the prototype does not model. | **Crew** and **Ground** cabin CO₂ readings and the planner's `CO2_PEAK_LIMIT` (`twin/constraints.py`), which says "not NASA's one-hour" limit. |

### C. Personal measurement references (synthetic astronaut readings)

These are Earth-based references applied only to fictional crew readings. They live in versioned catalogs, so the full citation, version and access date stay with the rule that uses them.

| ID | Catalog | Sources | Source date | Units | Limitations | Supports this visible feature |
| --- | --- | --- | --- | --- | --- | --- |
| M1 | `catalogs/crew/health-guides.json` (SX-23C) | MedlinePlus *Pulse* and *Body temperature norms*; AHA *Home Blood Pressure Monitoring*; Muntner et al. 2019 (Hypertension 73(5)); FDA *Blood Glucose Monitoring Devices*; ISO 15197:2013; ADA Standards of Care 2025 §6; *Consensus Sleep Diary* (Sleep 2012); AASM/SRS sleep consensus (Sleep 2015); PROMIS | Per entry; web pages accessed 2026-11-13 | bpm, mmHg, mg/dL, °C, minutes, score | Ground-based procedures, labelled as such. Mood and symptoms use a project-defined self-report, not a clinical scale. | **Take Measurement** help cards (`/runs/:runId/crew/measure`). |
| M2 | `catalogs/crew/health-reference-rules.json` (SX-23D, `health-reference-rules-v1`) | MedlinePlus *Pulse* (adult resting 60–100 bpm); AHA *Understanding Blood Pressure Readings* (categories); ADA Standards of Care 2025 §2 (fasting plasma glucose 100 and 126 mg/dL); MedlinePlus *Body temperature norms* (36.1–37.2 °C, fever above 38 °C) | Per entry; checked 2026-11-13 | bpm, mmHg, mg/dL, °C | Earth-based adult references. Applied only with a matching method and context. Lab glucose cutoffs are never applied to a handheld meter. The temperature range is applied to oral readings only. | **Crew Health** assessment, which shows the personal baseline and the sourced reference side by side. |
| M3 | `catalogs/crew/sim-01-health.json` | Synthetic baseline (`synthetic.sim-01-health-baseline-v1`) | Fixture | 72 bpm resting | Fictional. Not derived from a real person. | **Crew Health** baseline alert (SX-04C) and the personal range (SX-23D). |

## Source-to-feature review

**Method:** open each link and check that the source supports its stated use. Reviewed 2026-11-13 on branch `ahmed` from `main` at `91cd20d`.

| ID | Opened | What the source says (paraphrased) | Supports stated use? |
| --- | --- | --- | --- |
| S1 | NTRS record and abstract | ExMC/HRP concept for an onboard clinical decision-support system. Deep-space missions will have communication delays and periods with no contact, so crews must manage health more independently than in low Earth orbit. | **Yes**, for local emergency routing and onboard assessment. It is not evidence for any specific treatment. |
| S2 | HRP hazards page | Lists five hazards. Under "Distance from Earth", instructions, supplies and medical care become harder to receive from Earth, and self-sufficiency is key. | **Yes**, for the rule that the local alert never waits for Ground. |
| S3 | HRP home and risks pages | HRP develops methods to protect astronaut health and lists risks by hazard, including space radiation. ExMC is not named on the current home page. | **Yes**, as program context only. ExMC attribution rests on S1. |
| E1 | RadLab portal and Data API guide | The API defines `absorbed_dose_rate` as absorbed radiation dose rate in μGy/hour, with ISO timestamp filters and instrument IDs such as DosTel1. | **Yes**. The chart's unit label matches the API definition. |
| E2 | Export URL rerun | Returns CSV columns `timestamp,instrument_id,absorbed_dose_rate,spacecraft`. The first rows match the checked-in example (for example, `2022-04-01T00:00:00`, DosTel1, 1.99686…). | **Yes**. The chart's data is traceable to this request. |
| E3 | NASA Science Data note | OSDR updated RadLab to include Artemis I radiation telemetry from four Orion modules. | **Yes**, for RadLab provenance only. The product does not plot Artemis I data. |
| E4 | HRP space radiation hazard page | Radiation can't be seen or felt, and NASA studies ways to monitor and protect against it. | **Yes**, as the reason to show radiation context. It gives no thresholds, and the product applies none. |
| E5 | NASA-STD-3001 Vol. 2 §6.2.1.3 | V2 6004 limits average one-hour ppCO₂ to 3 mmHg. | **Yes**, for the distinction drawn in the product: the 3,200 ppm planner rule is a labelled demo rule, not this requirement. |
| M1, M2 | Catalog sources | Each link was opened, or its DOI checked through Crossref, when SX-23C and SX-23D were built. Values match the cited text. | **Yes**. Details are in those PRs and in each catalog entry's `version` field. |
| M3 | Fixture | Synthetic only. | **Yes**, labelled as synthetic. |

**Result:** every entry supports its stated use within the listed limitations. No source is used for a clinical decision.

### Trace the RadLab chart

A judge can follow the chart back to NASA in four hops:

1. **On screen:** Crew console → **Archived radiation context** shows "ISS · DosTel1 · absorbed dose rate", the unit μGy/hour, the UTC coverage, and the note that it is "separate from the fictional astronaut health readings" (`frontend/src/features/crew/RadiationContext.jsx`, rendered by `MissionConsole.jsx` for the Crew role only).
2. **Data file:** `contracts/examples/radlab-instrument-series.json` stores `source.portal_url`, `source.api_guide_url` and `source.export_url`, plus spacecraft, instrument, quantity, unit, UTC coverage, row count and missing-value count.
3. **Parser:** `backend/src/symbiosis_x/crew/radiation.py` builds that file from the RadLab CSV. It keeps the detector, unit and UTC basis, keeps gaps as gaps, and rejects unknown quantities. It is checked by `backend/tests/unit/test_radiation.py`.
4. **Source:** open `export_url` (E2) to get the same CSV, and use the Data API guide (E1) for the unit definition.

The chart is environmental context. It feeds no health assessment, alert, planner input or Ground packet.

### Why local response works before Ground delivery

- **Opening the case (local).** The Crew posts `POST /api/v1/runs/{run_id}/crew/emergencies`.
  - One case opens with a local responder as owner and the current mission time.
  - The escalation is marked `depends_on_vitals: false` and `depends_on_relay: false`.
  - Opening the case reads no relay messages and writes nothing for Ground.
  - Proof: `backend/tests/integration/test_emergency.py::test_emergency_cases_route_without_ground`. It runs both drills with no vitals and with the relay forced to fail, and checks that no Ground rows are written.
- **Acknowledging the case (local).** The assigned responder acknowledges onboard straight away.
- **Sharing with Ground (delayed).** Sharing the case queues only an alias, a priority and a status. Ground receives it 300 mission seconds later.
  - Proof: `backend/tests/integration/test_health_relay.py::test_delayed_case_packet_is_minimal`. The case opens at 00:00 and is acknowledged locally while Ground has nothing. Ground can't acknowledge before delivery (`CASE_NOT_DELIVERED`). Delivery happens at 05:00.
- **Ground's acknowledgment.** It is Ground's own record and leaves the onboard case unchanged.

This matches S1 and S2: with delayed or no contact, the crew acts first and Ground is informed when the link allows.

### Commands

```sh
python -m pytest backend/tests/unit/test_radiation.py backend/tests/integration/test_emergency.py backend/tests/integration/test_health_relay.py -q
```

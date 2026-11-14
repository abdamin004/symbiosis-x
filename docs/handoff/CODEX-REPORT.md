# SYMBIOSIS X submission handoff

## Done

| Brief item | Status | Commit | Verification |
| --- | --- | --- | --- |
| A1 · KAN-161 · 30-second cut | partial | `1816cad` | `flight-health30.spec.js` checks cue boundaries, the end card and short-cut seek. Long demo remains available. |
| A2 · KAN-165 · Cabin exposure | partial | `1816cad`, `168f778` | Rehearsal test checks modeled rise and recovery. Crew integration checks Sana’s elevated sample and recovery and Ground’s privacy boundary. |
| A3 · KAN-161 · Astronaut twin | partial | `f02b0cd` | The short-cut browser test checks the eight indicators, baseline comparison, history and fictional history label. |
| A4 · KAN-162 · Emergency guidance | done | `4b3bac4`, `1e913ad` | `flight-emergency.spec.js`, `emergency.spec.js` and the cross-role golden replay exercise two local drills and delayed sharing. |
| A5 · KAN-161 · Ground delivery | partial | `1816cad`, `1e913ad` | Short browser test checks receipt timing and withheld categories; golden replay tests the real Crew-to-Ground API. |
| A6 · KAN-161 · Recording mode | partial | `1816cad` | Short browser checks assert the rehearsal layout, privacy label and hidden flight controls. |
| A7 · KAN-165 · Equipment | partial | `fef26a8`, `168f778` | Catalog contract and short browser test check sensor linkage, units and a marked sample in every room. |
| B1 · KAN-162 · Crew profiles | done | `4b3bac4` | Profile unit tests check all four fictional histories and complete metric baselines. Crew/Ground integration checks privacy. |
| B2 · KAN-163 · Thirty mission days | done | `4f7240f` | Generator `--check` and `docs/validation-report.md`. |
| B3 · KAN-164 · NASA context | done | `1fc52ec`, `31f7577` | Public ISA metadata and hashes in the source register; API and browser checks for the private sleep archive. |
| B4 · KAN-163 · History and reminders | done | `4f7240f` | Assessment and trend tests cover blood pressure and symptoms; all four profiles expose eight reminders. Existing blood pressure context behavior is covered. |

## How to record

From a clean checkout, use Python 3.11 or later. The server below binds only to loopback and uses a disposable SQLite DB.

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e './backend[test]'
capture_dir="$(mktemp -d)"
python scripts/build_mission_canvas.py "$capture_dir/mission.html"
python scripts/build_flight_canvas.py "$capture_dir/flight.html"
SYMBIOSIS_X_MISSION_CANVAS="$capture_dir/mission.html" SYMBIOSIS_X_DB_PATH="$capture_dir/demo.sqlite3" \
  python -m uvicorn symbiosis_x.main:app --host 127.0.0.1 --port 8767 --no-proxy-headers
```

Open [the 30-second cut](http://127.0.0.1:8767/flight?demo=health30) at 1600 × 900. Start recording, switch to full screen, reload the URL and trim any browser setup frames. The cut plays once and holds the end card. Add `&t=15` to rehearse from the emergency beat. To show the independent live emergency flow, open the full Flight demo from the mission menu. The standalone recording uses the offline rehearsal and is silent.

Use the submitted story in this order: identify the three twins, show the personal baseline, explain the ship telemetry, demonstrate local guidance, then show the privacy boundary at Ground. For questions, show Medical and the thirty-day validation separately from the film.

## Numbers

- Modeled cabin CO₂: **2,000 ppm start, 3,333 ppm peak, 2,732 ppm recovery sample**. The chart marks **3,200 ppm** as the demo limit. The recovery sample remains above the fictional starting level.
- Ground receives the scripted case at **T+11:00** after sending at **T+06:00**, a **300-second mission delay** condensed into the four-second video beat.
- Synthetic validation: **78/78 authored cases recognized**, **0/20 clean crew-days with false review**, and **0 missing observations shown as normal** across 960 scheduled slots and 12 retry deliveries.

## Sources opened

Sources reviewed 2026-11-14. [The intake register](../data/intake.md) records links, the NASA study versions and downloaded metadata hashes.

| Source | Evidence used |
| --- | --- |
| [NASA Inspiration4 collection](https://www.nasa.gov/osdr-latest-news-i4-mission-datasets/) and [OSDR mission index](https://osdr.nasa.gov/bio/repo/data/missions/SpaceX%20Inspiration4) | Which public studies correspond to which sample types and the controlled access boundary for sensitive data. |
| [OSD-569](https://osdr.nasa.gov/bio/repo/data/studies/OSD-569), [OSD-571](https://osdr.nasa.gov/bio/repo/data/studies/OSD-571), [OSD-575](https://osdr.nasa.gov/bio/repo/data/studies/OSD-575) | ISA study tables for whole blood, plasma and serum sample types, collection timepoints and assays. These are discrete laboratory studies. |
| [Jones et al., Nature, 2024](https://pmc.ncbi.nlm.nih.gov/articles/PMC11357997/) | Results and Fig. 5f confirm a positive cabin CO₂ to HRV association in three of four crew members. Extended Data Fig. 10 and methods describe self-reported sleep and behavior. No cognition count is shown. |
| [NASA Spaceflight Standard Measures](https://www.nasa.gov/directorates/smd/space-life-physical-sciences-research-applications-division/human-research-program/spaceflight-standard-measures-characterizing-how-humans-adapt-in-space/) | Actigraphy, questionnaires and cardiovascular context support explaining sleep duration, sleep quality, mood, heart rate and blood pressure separately. |
| [NASA Flight Crew Physiological Data](https://catalog.data.gov/dataset/flight-crew-physiological-data-for-crew-state-monitoring) | Data description identifies aviation simulator pilots and copilots. Reviewed, not used in detection or simulation. |
| American Red Cross [Heart Attack](https://www.redcross.org/take-a-class/resources/learn-first-aid/heart-attack), [First Aid Steps](https://www.redcross.org/take-a-class/first-aid/performing-first-aid/first-aid-steps), [Unresponsive and Breathing](https://www.redcross.org/take-a-class/resources/learn-first-aid/unresponsive-and-breathing-person), [CPR](https://www.redcross.org/take-a-class/cpr/performing-cpr/cpr-steps), [Respiratory Distress](https://www.redcross.org/take-a-class/resources/learn-first-aid/respiratory-distress-trouble-breathing) | Recognition, initial questions and prioritization inform the paraphrased training steps. The drill JSON stores the version and access date. |

## Changed from this brief

The cabin case concerns Sana Kepler. The chest-pain drill concerns Mara Vale; Sana responds. The film presents these as separate events. The long walkthrough remains unchanged. `health30` uses a fixed clock, real cabin-model samples, a scripted drill and a scripted Ground receipt. The live role flow independently verifies local response, authorization, delay and privacy. Profile baselines and validation events are fictional and the published association supplies research context only.

## Not done / risks

- Long-cut seeking, the end-card change for the 223-second route and recording-only switches for standalone long Flight are deferred.
- The Crew API exposes Sana’s modeled cabin flag for the bound health-story run, but the long Flight astronaut panel still uses its authored incident state. The short-cut readings and next-check text are fixed for reliable capture.
- The short Ground animation stages a representative receipt. The live route still uses its existing acknowledgement and telemetry views. It does not animate that packet or publish the equipment catalog as live operational samples.
- The recording shows a representative simulated equipment tag per room. Per-device runtime samples, the furniture-to-health inputs and their shared operational projection remain follow-up work.
- The layout was judged at 1600 × 900. Review the actual MP4 before publishing; the proof suite validates behavior on synthetic fixtures.

## Check results

The local `python scripts/check.py --browser` run passed: 5 contract, 128 backend unit, 86 backend integration, 61 Chromium and 12 focused Flight checks. The frontend built successfully.

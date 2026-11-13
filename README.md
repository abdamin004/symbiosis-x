# SYMBIOSIS X

SYMBIOSIS X is a software-only prototype for astronaut self-assessment in a simulated mission. The ship carries four fictional astronauts (SIM-01 through SIM-04). The health demo follows SIM-01 through a measurement, an explained review alert, an onboard emergency drill and a delayed Ground receipt. The cabin twin provides mission context and a separate stale-advice replay.

Use the [Jira board](https://crewsync-1794569647227.atlassian.net/jira/software/projects/KAN/boards/2) for ticket status and the [build plan](SYMBIOSIS%20X%20Feature%20Backlog%20and%20Build%20Plan.html) for dependencies and acceptance checks. The [technical architecture](SYMBIOSIS%20X%20Technical%20Architecture.html) describes the role boundaries and the five planned screens.

## Project description

**Challenge:** [2026 NASA Space Apps Challenge, *Create Health Monitoring Software for Astronauts on Space Missions*](https://www.spaceappschallenge.org/2026/challenges/health-monitoring-software/).

The challenge asks for a visual tool that helps astronauts assess their own health during a mission and decide when a result needs attention from the crew or from flight surgeons on the ground. It names NASA's Human Research Program hazards, including distance from Earth, and indicators such as blood pressure, heart rate, blood sugar, body temperature, sleep and mood.

SYMBIOSIS X answers with four ideas, each shown on its own screen of a simulated mission.

1. **Self-assessment that explains itself.** On **Take Measurement**, a crew member enters one of seven synthetic indicators. Each has a help card that cites its method: heart rate, blood pressure, glucose, temperature, sleep, mood and symptoms. On **Crew Health**, the reading is compared with two separate references. One is the crew member's own baseline. The other is an Earth-based sourced range, used only when the method and context match. Each comparison gives its reason, rule version and evidence. Missing context gives "unknown", never "normal".
2. **Explainable change.** A repeated resting heart rate above the personal band raises a review alert that names the readings behind it. A missing reading turns the alert to unknown and keeps the last good sample in view. The cabin twin explains its own changes in the same way: CO₂ rises when the main scrubber degrades, and the standby scrubber is blocked when 0.40 kW is needed but only 0.20 kW is available.
3. **Local emergency response.** On **Emergency Assist**, chest-pain and collapse drills open one case onboard, with a responder and timestamp, even during a communication blackout. The alert never waits for vital signs or the Ground link, and the procedure shown is a labelled training placeholder.
4. **Privacy-aware, delayed support.** **Ground** sees only allowlisted data, after a simulated 300-second relay delay. Each delivered snapshot shows its basis, observation and receive times and sample age, so an old basis is never mistaken for current state. Ground can queue advice on the snapshot it was shown. Advice built on an older basis is held onboard (`STALE_BASIS`) and changes nothing. Private notes, measurements and health profiles stay in the Crew projection, and a shared emergency reaches Ground only as an opaque case alias, priority and status.

**Who benefits:**
- **Astronauts:** a quick self-check with reasons they can read.
- **The onboard responder:** a case they can act on without waiting for Earth.
- **Flight surgeons on the ground:** delayed data that says how old it is, without private details they don't need.

**NASA provenance.** NASA's [ExMC clinical decision support concept of operations](https://ntrs.nasa.gov/citations/20220017856) and the [HRP five hazards](https://www.nasa.gov/hrp/hazards/) motivate the local-first response. [NASA OSDR RadLab](https://visualization.osdr.nasa.gov/radlab/gui/overview) ISS DosTel1 data appears on Crew Health as labelled radiation context. It is not a personal dose. [NASA-STD-3001 Vol. 2 V2 6004](https://www.nasa.gov/reference/6-0-natural-and-induced-environments-vol-2/) is cited so the demo's CO₂ limit is not mistaken for it. The full register is in [docs/acceptance.md](docs/acceptance.md).

**Simulation assumptions** (synthetic fixtures, not real data):
- All four astronauts (SIM-01 to SIM-04) and every health reading are fictional, labelled `synthetic`. No real health record is used.
- Earth-based adult references come from MedlinePlus, AHA and ADA, and are labelled as Earth-based.
- The personal heart-rate band (±15 bpm around a 72 bpm baseline) and the review alert rule (three resting readings ≥20 bpm above baseline) are demo rules, not clinical thresholds.
- The cabin is a 100 m³ single-zone CO₂ model with seed 4242. The 3,200 ppm planner limit is a demo rule, not NASA's one-hour ppCO₂ requirement. The relay delay is a fixed 300 mission seconds.
- Emergency procedures are training placeholders, not approved medical procedures. Everything is advisory, and any simulated plant change goes through the Crew commit gate.

**Not built yet** (described in the build plan, not claimed above):
- personal reminders and follow-up (SX-24C)
- the comparable trend in the live Crew view (the trend evaluator exists; the fixture panel shows it)
- the live Ground list of delivered health cases (the backend delivers them; the fixture console shows them)

### Project description review

Manual review against the SX-11D method, on `main` at `2dd0177` (2026-11-13):

| Check | Evidence | Result |
| --- | --- | --- |
| Challenge alignment | The challenge page asks for astronaut self-assessment, named indicators, and when to involve crew or flight surgeons. The four ideas above map to self-assessment (Take Measurement, Crew Health), explanation (assessment and alert reasons), and crew vs. Ground escalation (Emergency Assist, Ground). | Pass |
| Stakeholder benefit | Astronaut, onboard responder and flight-surgeon benefits are each tied to a screen. | Pass |
| NASA provenance | Every NASA link above was opened and checked for its stated use in the [source-to-feature review](docs/acceptance.md#source-to-feature-review). | Pass |
| Fixture labels | Crew, readings, references, demo rules, cabin model, relay delay and procedures are each labelled as synthetic or as a demo assumption. Unbuilt features are listed separately, not claimed. | Pass |
| Claims match the build | Claims were checked against merged work and its tests: SX-23C, SX-23D, SX-04C, SX-25A, SX-09B, SX-09D, SX-07D, SX-03B, SX-18B and KAN-60. | Pass, with the "not built yet" items excluded |

Update this section after the release rehearsal (SX-11B): refresh the commit and remove items from "Not built yet" as they land.

## Start on your laptop

Clone the private repository with your GitHub account and run the contract checks from the repository root. If you already have a clone, run `git fetch origin` before switching to your member branch.

```sh
git clone https://github.com/abdamin004/symbiosis-x.git
cd symbiosis-x
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r contracts/requirements-test.txt
python -m pytest backend/tests/integration/test_contract_examples.py -q
```

On Windows PowerShell use `py -3 -m venv .venv` and `.\.venv\Scripts\Activate.ps1`. This setup exercises the shared JSON contract.

## Run the backend locally

From the repository root, activate the virtual environment and run:

```sh
python -m pip install -e 'backend[test]'
python -m uvicorn symbiosis_x.main:app --host 127.0.0.1 --port 8766 --no-proxy-headers
```

Open [OpenAPI docs](http://127.0.0.1:8766/docs). Startup migrates the local database to revision 4. By default the file is `symbiosis-x.sqlite3` in the working directory. Set `SYMBIOSIS_X_DB_PATH` to use a different file. Use a temporary path for tests. The pilot canvas currently runs from generated replay data.

`GET /health/live` returns `{"status": "live"}` while FastAPI responds. It does not open SQLite or read the mission clock. `GET /health/ready` returns 200 when the migrated store, its schema revision and the golden manifest (`scenarios/sx01-golden-v1.json`, or `SYMBIOSIS_X_GOLDEN_MANIFEST`) are usable. Otherwise it returns 503 with one reason: `STORE_UNAVAILABLE`, `SCHEMA_MISMATCH`, `MANIFEST_MISSING` or `MANIFEST_INVALID`. It opens the store read-only, so a probe never creates a database or moves a run. The launcher and both consoles show this as a Ready, Starting or Unreachable service badge, separate from the simulated Ground link. The facilitator resets a run with `POST /api/v1/runs/{run_id}/reset` and a stable `reset_id`. One transaction closes the old run and starts a new run with the same scenario and seed. The old run stays readable and rejects further steps with `RUN_CLOSED`. Ground sends advice with `POST /api/v1/runs/{run_id}/ground/advisories`, using a stable `operation_id`, a `candidate_id` and the `basis_snapshot_id` it was shown. The snapshot must already be delivered to Ground, otherwise the request fails with `BASIS_NOT_DELIVERED`. The receipt keeps the basis and its decision revision and is due onboard 300 mission seconds later. When advice arrives onboard, the run journals a `crew.advisory_received` disposition. Advice whose basis revision is older than the run's current revision is held with `STALE_BASIS`, advice past a policy expiry is held with `ADVICE_EXPIRED`, and current advice goes to `crew_review`. Intake never applies an effect; Crew authorization is a separate request. Both role views carry a `trace` of operational milestones: Monitor opening or linking an incident, Ground queuing advice and Relay's onboard disposition. Each record has a case ID, mission time, actor, result, reason and next owner, never tool input, evidence or private data. Crew sees every milestone so far. Ground sees its own advice and only onboard milestones up to the observation time of the newest packet it has received, so the 13:00 hold stays onboard. Crew shares an emergency case with `POST /api/v1/runs/{run_id}/crew/emergencies/{case_id}/relay` and a stable `operation_id`. Relay queues an opaque case alias, a generic review priority and the case status, due at Ground 300 mission seconds later. The Ground view lists it under `health_cases` only after delivery. Ground acknowledges receipt with `POST /api/v1/runs/{run_id}/ground/health-cases/{case_alias}/acknowledgment`, which never changes the onboard case.

## Run the frontend

Use Node 20.19 or later. From the repository root:

```sh
cd frontend
npm install
npm run dev
```

Open [the run launcher](http://localhost:5173/). It links the Crew console (`/runs/run-001/crew`) and the Ground console (`/runs/run-001/ground`) for the same example run. Both consoles read the published SX-01A examples until [KAN-43 / SX-08B](https://crewsync-1794569647227.atlassian.net/browse/KAN-43) wires live reads. The dev server proxies `/api` and `/health` to the backend at `http://127.0.0.1:8766`. Set `SYMBIOSIS_X_API_URL` to use a different backend address. The route chooses a view only. The server resolves each caller's role and decides what it may read.

Run the browser smoke test from `frontend/`. The first run needs `npx playwright install chromium`.

```sh
npx playwright test tests/smoke.spec.js
```

## Run the checks

Run the same checks locally that CI runs on each pull request. From the repository root, with the backend and frontend dependencies installed:

```sh
python scripts/check.py            # contracts, backend unit and integration, frontend build
python scripts/check.py --browser  # also the Playwright smoke test, as CI does
python scripts/check.py --list     # show each suite and whether it has landed
```

The command exits nonzero if any suite fails. `--release` also requires the health replay (SX-26A) and privacy (SX-11A) suites and fails until they land.

## SX-01A handoff

[KAN-9 / SX-01A](https://crewsync-1794569647227.atlassian.net/browse/KAN-9) publishes four examples for the same `sx01-golden` scenario, seed `4242`. At mission time 13:00, Crew sees v103 and 0.20 kW. Ground still sees its delivered v102 and 0.60 kW. A commit attempted on the stale revision has `applied: false`.

| Example | Producer | Consumers |
| --- | --- | --- |
| [Crew v103](contracts/examples/crew-v103.json) | Sama's Crew projection, with Jana's synthetic observations and Ahmed's cabin state | Crew dashboard and contract tests |
| [Ground v102](contracts/examples/ground-v102.json) | Abdelrahman's Relay delivery and Sama's Ground projection | Ground dashboard and role privacy tests |
| [Candidate results](contracts/examples/candidate-results.json) | Sama's planner | Crew review and replay checks |
| [Action receipt](contracts/examples/action-receipts.json) | Sama's commit gate | Crew dashboard, receipt lookup and replay checks |

The [example schema](contracts/schemas/sx-01a.schema.json) validates these static payloads. The Crew CO₂ value is a modeled estimate at 13:00. Ground displays the observation from 01:00, received at 06:00. The candidate example assumes reduced activity is disallowed for this replay. The action receipt illustrates a separate attempt to commit using the obsolete Ground basis.

Mohamed coordinates shared contract changes and Sama reviews SX-01A. Use these examples for mocks, and carry their field names and units into [KAN-16 / SX-21B](https://crewsync-1794569647227.atlassian.net/browse/KAN-16).

## Sources and acceptance evidence

The [source register and source-to-feature review](docs/acceptance.md) record each NASA source the product uses. For each one, it gives the link, source date, data type, coverage and units, limitations, and the visible feature it supports. Environmental context and personal measurements are listed separately, as they are kept apart in the product.

| Source | Kind | Visible use |
| --- | --- | --- |
| [NASA ExMC clinical decision support ConOps](https://ntrs.nasa.gov/citations/20220017856) (HRP project document, 2021) | Mission operations | Emergency Assist opens and acknowledges a case onboard before Ground delivery. |
| [NASA HRP 5 Hazards](https://www.nasa.gov/hrp/hazards/) (updated 2026-06-12) | Mission operations | The "Distance from Earth" hazard is why the local alert never waits for Ground. |
| [NASA OSDR RadLab](https://visualization.osdr.nasa.gov/radlab/gui/overview) ISS DosTel1 export, 2022-04-01 UTC, μGy/hour | Environmental context | The Crew **Archived radiation context** chart. It is not a personal dose and feeds no assessment. |
| [NASA-STD-3001 Vol. 2 §6, V2 6004](https://www.nasa.gov/reference/6-0-natural-and-induced-environments-vol-2/) (updated 2026-04-21) | Environmental context | Cabin CO₂ context. The 3,200 ppm planner limit is a labelled demo rule, not V2 6004. |
| [Measurement guides](catalogs/crew/health-guides.json) and [reference rules](catalogs/crew/health-reference-rules.json) | Personal measurements (synthetic crew) | Take Measurement help cards and the Crew Health assessment. Earth-based references are labelled. |

The review also traces the RadLab chart from the screen back to the NASA export, and shows why local emergency response works before Ground delivery.

## Build with Codex

Open the repository root in a new Codex chat, or run `codex` from the repository root. Ask for a specialist by its exact name. The role files live in [`.codex/agents/`](.codex/agents) and use the parent session's model and permissions. [Official OpenAI documentation](https://learn.chatgpt.com/docs/agent-configuration/subagents)

| Codex agent | Human owner | Member branch | First pull |
| --- | --- | --- | --- |
| `sx_integration` | Mohamed | `mohamed` | [KAN-9 / SX-01A](https://crewsync-1794569647227.atlassian.net/browse/KAN-9), then KAN-16 / SX-21B after backend bootstrap |
| `sx_backend` | Sama | `sama` | [KAN-10 / SX-21A](https://crewsync-1794569647227.atlassian.net/browse/KAN-10), backend bootstrap |
| `sx_spacecraft` | Ahmed | `ahmed` | [KAN-11 / SX-03](https://crewsync-1794569647227.atlassian.net/browse/KAN-11), cabin CO₂ |
| `sx_crew_health` | Jana | `jana` | [KAN-12 / SX-04A](https://crewsync-1794569647227.atlassian.net/browse/KAN-12), confirmed activity, and [KAN-18 / SX-23B](https://crewsync-1794569647227.atlassian.net/browse/KAN-18), measurement catalog |
| `sx_relay` | Abdelrahman | `abdelrahman` | [KAN-13 / SX-07A](https://crewsync-1794569647227.atlassian.net/browse/KAN-13), first allowlisted runtime tool |
| `sx_frontend` | Suhad | `suhad` | [KAN-14 / SX-08A](https://crewsync-1794569647227.atlassian.net/browse/KAN-14), ship deck, and [KAN-17 / SX-08C](https://crewsync-1794569647227.atlassian.net/browse/KAN-17), launcher and role routes |

Example prompt for independent checks on the current branch:

> Spawn `sx_integration` to run the SX-01A contract tests, `sx_relay` to review the delivered Ground example for privacy and timestamps, and `sx_frontend` to check whether the role examples are ready for UI mocks. Keep the review read-only, wait for all three, and report test results and blockers.

## Branches and merges

The team uses `main` for integration and one long-lived branch per member, listed above. Give each specialist one Jira ticket and its owned paths. Each member publishes one reviewable batch at a time from their branch.

On your first checkout, replace `sama` with your branch name.

```sh
git switch --track origin/sama
```

Before each new ticket, update your branch with the latest integrated code.

```sh
git fetch origin
git merge --ff-only origin/sama
git merge origin/main
```

Run the ticket checks, push to your member branch, and open a pull request into `main`. Put the Jira key in the commit subject and PR title, for example `KAN-10 Bootstrap the FastAPI package`. Link Jira and GitHub in both directions. Use **Create a merge commit** on GitHub to keep the branch history shared with `main`. Keep your member branch after merge and update it before starting the next ticket.

In the PR, record the test command and result, affected consumers, and any blockers. Before starting work, assign the Jira ticket to yourself and move it to In Progress. Merge the tested change into main, then move the Jira ticket to In Review for a teammate to check. Move it to Done after peer review and any follow-up fixes.

## Run the cabin pilot

Generate a standalone HTML preview from the cabin model and synthetic astronaut roster.

```sh
python3 scripts/build_cabin_preview.py /tmp/symbiosis-x-cabin.html
```

Open the generated file. Select any astronaut and compare the Crew replay at 13:00 before and after confirming reduced activity at 06:00. The cabin adds the contributions of all four astronauts. Planning leaves the cabin input unchanged. The Ground fixture shows the earlier delivered snapshot at 13:00. This preview uses synthetic data and runs without the application server.

### Build canvas components

Use the [spacecraft icon sprite](frontend/src/ui/icons/spacecraft.svg) for cabin, scrubber, power and Crew. Keep the SVG paths on the same 24 × 24 grid and inherit `currentColor`. In React or HTML, give icon-only controls accessible names. Treat icons next to text as decorative.

Use violet for selection, blue for telemetry and amber for degraded equipment. Give status a text label as well as a color. Use the catalog's stable asset IDs and keep selection state in the canvas. The [spacecraft catalogs](catalogs/sx01/) define the cabin and its CO₂ source. See the [time-series design rule](docs/decisions/telemetry-and-health-time-series.md) for telemetry, private health history and future agent queries. Pass role-scoped values into components so the same deck and inspector can serve Crew and Ground.

### Seed synthetic observation history

Use a dedicated SQLite file and SQLite 3.37 or later for the typed observation tables.

```sh
python3 scripts/seed_time_series_demo.py /tmp/symbiosis-x-series.sqlite3
```

The seed writes one replay with 14 cabin CO₂ samples at 60-second intervals and 12 private synthetic heart-rate samples across four astronauts. Re-running the command keeps the same run. The app applies the schema on startup. History endpoints and health assessment are separate work.

### Open the room-based mission canvas

Generate the canvas from the spacecraft room catalog, then serve it on the same local origin as the run API.

```sh
python3 scripts/build_mission_canvas.py /tmp/symbiosis-x-mission.html
SYMBIOSIS_X_MISSION_CANVAS=/tmp/symbiosis-x-mission.html python -m uvicorn symbiosis_x.main:app --host 127.0.0.1 --port 8766 --no-proxy-headers
```

Open [Mission canvas](http://127.0.0.1:8766/mission). Start the nominal run at 00:00 and advance it once to 01:00. The room catalog describes the ship's planned functions and links existing assets to the same IDs used by telemetry. Command uses the live run API. Switch between Crew and Ground on the same run. Ground waits for the first packet and shows observation time, delivery time and age once it arrives. Replay and planned labels identify the other room capabilities. The canvas enables loopback demo sessions. For API-only testing, set `SYMBIOSIS_X_LOCAL_DEMO=1` and POST to `/api/v1/demo/session` to get the three role tokens. Send the appropriate token in the Bearer authorization header. The local operator can switch viewpoints. This session issuer is for a trusted local demo and grants all three demo roles to that operator. Keep the service bound to loopback without a reverse proxy.

The mission canvas shows all ship systems or filters them by room. Play, step, or scrub the travel replay to compare modeled cabin CO₂, astronaut activity, scrubber flow, and power headroom. Use **Show live readings** to return the system widgets to the nominal run's role-scoped readings where available. The five screen selectors link the working pilot slices and show the registered measurement types. Emergency workflows, measurement writes, and the integrated golden runtime remain separate tickets.

### Open the player flight view

Generate `flight.html` alongside the generated mission canvas.

```sh
python3 scripts/build_flight_canvas.py /tmp/flight.html
```

With the local backend running, open [Flight](http://127.0.0.1:8766/flight). Choose **ISS Research and Return** for Horizon’s station mission or **Orbital Systems Checkout** for Kestrel's shorter flight. Open **Briefing** for the crew, ship, pacing, and flight plan, then choose **New run** or **Resume**.

Start ship systems, assign crew checks, and press **Play**. Playback stops for Commander decisions including countdown, booster separation, insertion, and capture. Use **Flight command** to continue once in orbit. At 1×, four mission seconds pass per real second during checkout and orbital operations. **Save and exit** returns to the selector. Progress is stored per campaign in the browser on the same origin. **New run** asks before replacing the selected campaign's save.

For Horizon, coast to the insertion window and burn to raise periapsis. In parking orbit, coast to the calculated departure point, commit the ISS transfer burn, then coast to transfer apoapsis and match the station's orbit before beginning the docking approach. Burn playback is stretched so the changes in apoapsis and periapsis are visible. The navigation display uses an ideal coplanar model and a fictional station position; final approach uses the scripted range readout.

Select the attitude ball at the bottom center and use **WASD** or the arrow keys to pitch and yaw. Each accepted input spends one cold-gas pulse. Select **Orbit** beside the ball to open the full trajectory map. From the mission menu, **Run astronaut health demo** follows Horizon through a 3:43 synthetic playback. In parking orbit, the crew responds to rising cabin CO₂, keeps Sana’s wristband recheck private, and relays operational status to Ground after a delay. A separate scheduled spacewalk shows suit oxygen reserve, battery and tether status before ISS research and Earth recovery. **Pause demo** pauses the presentation clock.

Open a crew portrait and select **Wristband** or **Back pod** to inspect synthetic samples. Deck cameras show location and movement within covered rooms. Select an unobserved body region and choose **Request crewmate check**, then advance time until the observer arrives and reports. These checks are local to the current browser session. Camera tracks and visual observations do not provide measurements of internal organs.

To try persisted wearable data, start scenario `crew-wearables`, version `1`, seed `4242` from the facilitator controls. Open that run's **Flight canvas**, select Sana, and open **Gear** or **Vitals**. Advance the run in the facilitator tab to see a disconnect, a late packet, and motion evidence arrive on the run clock. Other crew in this fixture have no device samples.

Choose **Open replay** under **ISS Research Replay** or open the [ISS Research Replay](http://127.0.0.1:8766/flight?view=replay) directly. Fly or scrub the replay, select rooms and crew, and confirm reduced activity to change the cabin readings after the activity checkpoint. Use [Mission control](http://127.0.0.1:8766/mission) for live nominal commands and Crew and Ground verification.

The ISS Research Replay starts paused. The transport controls float below the resource ribbon. At 1×, four mission seconds pass per real second. Cycle 1×, 2× and 4× in the upper-right transport. Forward skips one mission hour. The lower-left Mission overview holds the clock, timeline, next event and Reset. Red Reset clears the local replay's tasks, check-ins and inspection request. Select an equipment icon, choose an astronaut and assign work. The astronaut moves to the station and the progress bar tracks 30 mission seconds. Duty, Needs, Vitals and Devices open separate movable overlays.

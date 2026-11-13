# SYMBIOSIS X

SYMBIOSIS X is a software-only prototype for astronaut self-assessment in a simulated mission. The ship carries four fictional astronauts (SIM-01 through SIM-04). The health demo follows SIM-01 through a measurement, an explained review alert, an onboard emergency drill and a delayed Ground receipt. The cabin twin provides mission context and a separate stale-advice replay.

Use the [Jira board](https://crewsync-1794569647227.atlassian.net/jira/software/projects/KAN/boards/2) for ticket status and the [build plan](SYMBIOSIS%20X%20Feature%20Backlog%20and%20Build%20Plan.html) for dependencies and acceptance checks. The [technical architecture](SYMBIOSIS%20X%20Technical%20Architecture.html) describes the role boundaries and the five planned screens.

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

Open [OpenAPI docs](http://127.0.0.1:8766/docs). Startup migrates the local database to revision 3. By default the file is `symbiosis-x.sqlite3` in the working directory. Set `SYMBIOSIS_X_DB_PATH` to use a different file. Use a temporary path for tests. The pilot canvas currently runs from generated replay data. The simulation API routes and health probes have their own tickets.

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

With the local backend running, open [Flight](http://127.0.0.1:8766/). Fly or scrub the replay, select rooms and crew, and confirm reduced activity to change the cabin readings after the activity checkpoint. Use [Mission control](http://127.0.0.1:8766/mission) for live nominal commands and Crew and Ground verification. Flight uses the shared Python replay, with scripted crew duties and Ground handoff.

Flight starts paused. The transport controls float below the resource ribbon. At 1×, four mission seconds pass per real second. Use the forward control or timeline to jump. Red Reset clears the local replay's tasks, check-ins and inspection request. Select an equipment icon, choose an astronaut and assign work. The astronaut moves to the station and the progress bar tracks 30 mission seconds. Duty, Needs, Vitals and Devices open separate movable overlays.

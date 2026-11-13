# Land to land: first playable mission

**Player role:** the ship Commander owns onboard assignments and commits. Ground
advises using delivered evidence, then sees acknowledgments and outcomes on the
relay schedule. Both views follow the same run. Start at the launchpad and finish
with a recovery or failure debrief. Orbit is a milestone, and the mission can still
be held, aborted, partially completed or lost. Keep the existing ISS replay and
health-first golden run as separate, named options.

The first game scenario is **ISS Research and Return**. Use a staged launch stack,
an orbital vehicle, and a separately inventoried return capsule. Offer an
**Orbital Systems Checkout** mission as the second playable preset using a lighter
vehicle and no station transfer. The menu lists mission objective, crew, ship,
scenario version, estimated playtime and availability. Choose a preset, start a
new seeded run or resume a saved run. Do not make vehicle switching available in a
running mission outside its authored handoff.

## PR 1 — Mission selection and crew job board

Add versioned mission and vehicle definitions. A vehicle owns its room graph,
equipment stations, stage inventory, capacities and performance envelope. A mission
owns eligible vehicles, objectives, holds, fault schedule and ending conditions.
Use the existing deterministic Python and SQLite path for authoritative state.
Keep the browser's continuous controls, with 15 mission seconds per job tick and
four mission seconds per real second at 1×. Stepping and time acceleration process
the same due jobs, plant events and deliveries in the same order; stop fast forward
at decisions that require a player.

One job type serves daily work, phase checklists and crisis response. Store stable
job ID, origin, urgency, due time, station, role and training prerequisites,
required apparel and resources, assignee, route, expected work and completion
evidence. State flow: offered → assigned → travelling → working → verify →
completed, with explicit blocked, held, cancelled and expired branches. A Commander
may move people between stations, delegate routine jobs or pause optional work. A
crisis may interrupt an eligible job at a safe boundary, preserving completed work.
A crew member cannot be in two places or own two active jobs. An assigned job does
not prove completion.

Default watch: Mara commands and approves; Ivo keeps power, life support and
propulsion ready; Noor runs communications and watch handoffs; Sana handles
research and crew check-ins. Any trained astronaut may cover an eligible duty.
Routine work includes scrubber and power inspections, galley prep, hygiene and
cleaning, protected rest, lab sampling and relay readback. Workload and rest may
change **synthetic** task endurance; private vitals or self-reports may prompt a
check-in or defer optional work under an authored game rule. Missing data is
explicit. Wearables never infer mood and no advisory acts on the plant.

Acceptance: assign a recurring inspection, reassign it in transit, and verify one
completion. A blocked handoff names its missing resource or collaborator.
Replay, skip and resume reproduce the same job log.

## PR 2 — Launch, staging, stable orbit and propulsion

Build on [KAN-33 navigation](https://crewsync-1794569647227.atlassian.net/browse/KAN-33).
Use a scripted ascent envelope and budgeted maneuvers for the first game build.
The pad shows the full stack. Complete checkout, suit-up and restraint jobs,
release a hold, lift off, burn out and detach the booster, then stage the upper
vehicle and perform orbit insertion/circularization. The stage overlay shows
what is attached, what may separate, why it is gated and which stage owns fuel.
Discarded stages leave the exterior view and no longer contribute fuel or mass.
Stable orbit requires a committed insertion and a valid modeled orbit envelope.

Engineering's propulsion view shows readiness, dry-run evidence, current stage,
remaining fuel and Δv, next maneuver window, planned burn duration and expected
post-burn orbit. Commander confirms against fresh evidence. Missed windows, a
held engine and inadequate reserve have explicit paths to retry, loiter or abort.
Only a committed burn debits propellant; skipping time never bypasses a hold.
Accept a deterministic flight to stable orbit, then replay a missed or invalid
burn and verify that the ship does not reach orbit by elapsed time alone.

Design references: [KSPedia](https://static-files.kerbalspaceprogram.com/pd/KSPedia-PS4.pdf)
separates matching planes, rendezvous and docking; the [KSP2 developer notes](https://forum.kerbalspaceprogram.com/topic/212081-kerbal-space-program-2-pre-release-notes/)
show current stage Δv and a burn segment on the projected path. Use that
planned-versus-actual distinction without requiring a full orbit sandbox.

## PR 3 — Rendezvous, docking, and return

The orbit map previews a phasing maneuver, close approach and a separately
authorized final approach. Surface relative position and closing rate plus an
explicit go/hold/retreat decision. [KAN-83](https://crewsync-1794569647227.atlassian.net/browse/KAN-83)
owns capture, seal, pressure verification and hatch authority. Unknown or stale
evidence keeps the hatch held. The cargo handoff is a separate accepted receipt;
no implicit atmosphere or inventory transfer. After station work, change to a
return capsule, confirm the burn and entry envelope, perform reentry, descent,
landing and recovery. Show crew restraints, heat-shield and descent checks as
jobs. Accept a full return and a held docking that never silently becomes success.

## PR 4 — Science, cooking, apparel, and relationships

Use Engineering for thruster checks, bus experiments and verified dry-run
receipts. Use Medical for the wrist/back-pod research protocol: valid baseline,
task, paired evidence, verify, archive or repeat. Each experiment has a lead,
reviewer and record of what the result qualified. Build a Galley job chain:
check packaged ingredients, allocate potable water and served power, prepare
meal, distribute portions, then clean the station. Protect critical loads if the
galley and experiment compete for power. Ingredients and water debit once on
accepted completion. The [KSP2 For Science update](https://forum.kerbalspaceprogram.com/ksp2-release-notes/v0200-for-science-r12/)
provides a useful pattern for separating the mission tracker from earned results.

Apparel is both a visible character layer and a gameplay state: cabin wear,
launch/entry suit with helmet and restraints, and optional later EVA equipment.
Issue and check suit fit, condition and kit availability. Mood has a private
self-report lane and a separate authored game layer for morale and social beats.
Shared meals, resolved conflicts and successful handoffs can change the fictional
cooperation state. Keep a cause-and-time history and avoid treating traits,
morale or apparel as real health measurements.

## PR 5 — Crises and outcomes

Faults create jobs with owners, evidence, deadlines and a plant consequence.
The first playable crisis combines a scrubber fault with reduced electrical
reserve during rendezvous. Ivo must inspect, Noor reports or works locally
during a blackout, Sana reschedules optional work and Mara can defer a load,
approve a valid response, hold approach or abort. The existing approved
command gate is the only writer of plant changes. Ignoring a deadline can
consume a recoverable margin, make the science objective unattainable, or force
a game failure after a modeled boundary is crossed.

Persist outcomes: full success, safe return without all objectives, aborted and
recovered, and mission lost. Score recovery, objectives verified, reserve and
quality of decision trace. Ground is scored on evidence freshness and usefulness;
it cannot substitute for onboard authority. Verify success, safe abort and loss
from the same seed with different decisions. Every debrief names the decisive
event and time. A winning path must be discoverable from the same cues that
explain the failed one.

## PR 6 — Real-time animation and 2.5D cutaway

**Use 2.5D for the next art pass.** Keep 2D room, door, route and hit geometry as
the source of truth. Add layered hull panels, raised bulkheads, depth shadows,
directional lighting, equipment silhouette and background parallax. Use exterior
shots for launch, stage separation, orbit changes and approach; keep the
readable interior for crew management. Avoid a full 3D migration until the
crew job loop proves out: it would add asset, camera and hit-testing work now.

Use animation clips for idle, walking, floating, checking, working, cooking,
resting, suiting and talking. Position interpolates between simulation snapshots;
progress, interruptions and contact decisions come from the model. Layer suit
over body and role colors over suit; add task indicators and restrained reactions.
Doors respond to transit. Camera has overview and focus modes and never moves
click regions away from their painted targets. Implement pause and reduced motion.
Accept an unbroken 60-second crew demonstration with visible handoff,
interruption and resumed work; verify the same outcome with animation disabled.

# Flight systems: implementation order

The Flight cutaway is a synthetic gameplay replay. Its painted walls, routes and
fixtures give the player places to work. A visual selection alone cannot change a
simulation state. Use the existing room and crew IDs, keep the live golden scenario
unchanged, and build the first resource loop in a versioned Python scenario.
The [workflow integration order](flight-workflow-pr-order.md) still governs live
commands, delivered evidence and docking.

## 1. Establish a shared clock and electrical allocation

Use 15 mission seconds as the player order tick, independent of playback speed.
Advance deterministic Python models by mission time so replay, seek and skip agree.
Record intent, due time, applied command and outcome separately. Use the existing
[KAN-32 standby gate](https://crewsync-1794569647227.atlassian.net/browse/KAN-32)
and coordinate its ownership before changing electrical code.

Start with an outbound solar → bus ↔ battery budget. Use scripted sun/eclipse and
array condition, explicit charge/discharge efficiencies and limits. Give each
fixture a demand, priority and served load in kW. Protect circulation, cooling and
command; shed optional lab/galley loads first. Display available generation,
requested/served load, headroom, unserved load and remaining battery kWh separately.
Make the arrays and bus inspectable. Gate load changes through authorized commands.
Accept only if an eclipse drains storage, sunlight recharges it, the budget balances
and the existing 0.40 kW standby demand still fails at 0.20 kW headroom. Add a
separate thermal slice for waste heat from served loads and powered radiator cooling;
confirm a cooling loss raises temperature and restoration reverses the trend.
[NASA electrical design](https://science.nasa.gov/mission/hubble/observatory/design/electrical-power/) ·
[NASA thermal control](https://ntrs.nasa.gov/citations/20010091676)

## 2. Connect air to occupancy and served power

Build a three-zone variant: Habitat, passage and shared rooms, and Life Support
return. Use explicit duct links and volumes totaling 100 m³. Track O₂, CO₂ and N₂
inventories in moles; derive fraction, partial pressure and total pressure at a
provisional fixed temperature. Ducts may cross bulkheads. Each synthetic astronaut
contributes to one occupied zone at a time based on the confirmed activity interval.
Fan allocation controls exchange, scrubber allocation controls capture and tank
makeup supplies O₂. Defer humidity and powered electrolysis to separate slices.

Flight needs zone tint, airflow, current readings, sensor age and inspection actions.
Accept only if gas exchange conserves each species in a sealed test, isolated
rooms diverge and remix, and fan power loss produces a detectable local change.
Keep the legacy 2,063.74 ppm checkpoint at 13:00; missing pressure evidence keeps
the hatch pending. [NASA life-support reference](https://www.nasa.gov/reference/environmental-control-and-life-support-systems-eclss/)

## 3. Give water and habitat independent inventories

Use integer mL ledgers per vehicle for potable water, reserve, wastewater, product
pending verification and losses. Galley pouch filling, meal preparation and WC use
have defined costs applied exactly once on authorized completion. Meals also have
packaged counts. On the station only, a powered recovery processor moves wastewater
and explicitly credited condensate into a quality hold. Verification releases
potable product, and rejected volume is accounted for. Docking alone transfers
nothing. Keep private crew hydration/meal/hygiene records separate from inventory.

Show potable stock, predicted endurance and processor state. Verify conservation,
deduplication, separate vehicle tanks, power interruption, quality failure and
approved transfer. Then add the optional coupling of potable draw and served power
to oxygen production. Keep the UI explicit about modeled versus scripted readings.

## 4. Surface the communications loop

Wire a read-only Comms station widget to the persisted Relay and decision receipts
after KAN-65/67 and KAN-68. Show queued, due, received, read back, held or applied
as distinct states; include packet age, immutable revision and exact scheduled
timestamps. Noor can read back or report; Mara decides; only the command gate
applies plant actions. Ground gets the explicit delivered allowlist. Verify v102
arrives at 06:00, its advice arrives at 13:00 after the 10:00 drop to v103, and the
gate produces one stale receipt with no plant change. Add powered transmitter
bursts and explicit contact windows separately. The existing five-minute delay is
a training scenario setting.

## 5. Give Command and Cargo a gated approach and transfer

Start with KAN-33: derive effective phase, next waypoint, scheduled or held ETA,
and plan revision in Python. Command and the minimap read the same projection;
Ground sees the last delivered value and age. Put the checklist in Command and
the transfer manifest and lock state in Cargo. Separate approach, capture, seal, pressure verification,
hatch readiness, custody and return handoff. Show the source and age of each
evidence item; expire stale evidence, display blockers, and preserve Commander
authority. Do the live hatch acceptance in KAN-83. Verify failed or absent evidence
keeps transfer pending, repeat requests are idempotent, and a successful transfer
changes custody only once. Check that the return vehicle starts with separate stock.

## 6. Make research and crew relationships playable

At the research workbench, use an explicit ready → baseline → task → pair verified
→ archive or repeat protocol. Sana runs the experiment, Ivo checks lab power,
Noor records the handoff, and Mara reschedules around rest and power. Reserve the
workbench, crew and watts; release them on pause/cancel. Missing or late samples
must be visible; require a valid pair before archiving, and deduplicate on replay.
Keep the medical drill and its private health workflow separate. KAN-46/51 own
crew observation and history; Ground can receive approved operational progress.

The four original personas use the [RimWorld character model](https://rimworldwiki.com/wiki/Characters)
and its [community discussion of trait interactions](https://ludeon.com/forums/index.php?topic=17605.0)
as references. Their relationships are scripted in Flight today. Next, persist
small interaction events (kit readback, lab readiness, paired sample verified, reschedule acknowledged)
with actor, partner, cause, outcome and mission time. Let those events affect
synthetic work preference or cooperation only in an opt-in crew scenario. Keep
self-reported mood and symptoms separate and never infer them from wearable readings.
Test that the same schedule, orders and initial seed produce the same interactions. A required collaborator who is busy
or away cannot acknowledge the handoff; repeated playback adds no duplicate event.

## Shared data rule

Use [the time-series design](telemetry-and-health-time-series.md) for new observations.
Keep run, subject, metric, unit, source/model version, quality, observed time and
received time. Version additions to the typed event contract and test the Ground
allowlist before exposing a system reading. Store resource ledgers, the command
receipt and observations under the same mission clock. A scrub to a timestamp must
agree with continuous playback to that timestamp.

# Flight workflow integration order

The local inspection replay implements Ground advice, delayed delivery, Commander disposition, specialist inspection, and a delayed operational report. It uses browser storage for the two replay views. Crew health stays in the player tab. An inspection request cannot change the plant, approve an action, or open the hatch.

Follow the existing Mission Operations and Mission Control Design workflow diagrams for the live implementation. Merge and verify these slices in order:

1. **Shift and evidence.** KAN-26, KAN-42, KAN-13 and KAN-62 establish mission checkpoints, accepted telemetry, and owned incidents. Keep actual task confirmation separate from a planned assignment. Keep private check-ins separate from the operational trace.
2. **Ground and decision.** KAN-48, KAN-65 and KAN-67 deliver an immutable operational snapshot and attach its revision to advice. Verify the Commander can hold obsolete advice and that only an eligible onboard command reaches the writer. Confirm duplicate actions produce a single receipt.
3. **Integrated golden run.** KAN-68 composes the model, observations, incident, Relay and command gate. Apply due plant changes and deliveries before evaluation and commit the trace with the state change. Exercise the v102 advice against v103 case.
4. **Docking, station work and return.** KAN-83 establishes the separate capture, seal, pressure and hatch checks. Follow with independently reviewable crew and cargo custody tasks, station research, a return vehicle handoff and debrief. Unknown evidence keeps transfer pending.
5. **Crew measurement and history.** KAN-46 and KAN-51 wire private measurements and comparable trends. A workload or rest schedule can inform a check-in prompt. Only the astronaut supplies mood and symptoms.

Flight's **Workflows** view connects the Mission Operations shift workflow and
Mission Control Design W2 to a configurable Life Support inspection. Releasing
an inspection records the procedure version, due checkpoint, assignee and
station. The same job drives the crew route and work progress. The event export
groups that case by ID and orders its simulated milestones by mission time and
sequence. W4 reads the existing Ground relay record. Launch checkout and W6
read accepted milestones from the local launch save.

The demo keeps procedure settings and allocated jobs in browser storage.
Milestones for an inspection are derived from the deterministic task clock.
Server-side journal capture, repeated-case analysis and measured crew
observations are separate from this rehearsal.

Life Support, Power, Comms, and Exterior Inspection each have their own saved
assignee, deadline and repeat interval. Release is checked against crew and
station availability. The active assignment drives the job board and avatar,
and retains the procedure version in its case log. Launch, Ground relay and
docking retain their separate command gates.

Horizon can run an antenna inspection in parking orbit or at the station.
The spacewalker and an airlock watch share one assignment. A link loss recalls
the spacewalker, and a recalled inspection keeps ISS transfer held until a later
inspection returns safely and the Commander verifies it. Suit channels and
airlock states are synthetic. [NASA Quest airlock](https://www.nasa.gov/international-space-station/quest-airlock/)
and [NASA spacesuits](https://www.nasa.gov/suits-and-rovers/spacesuits/) inform the scene.

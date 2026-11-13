# Flight workflow integration order

The local inspection replay implements Ground advice, delayed delivery, Commander disposition, specialist inspection, and a delayed operational report. It uses browser storage for the two replay views. Crew health stays in the player tab. An inspection request cannot change the plant, approve an action, or open the hatch.

Follow the existing Mission Operations and Mission Control Design workflow diagrams for the live implementation. Merge and verify these slices in order:

1. **Shift and evidence.** KAN-26, KAN-42, KAN-13 and KAN-62 establish mission checkpoints, accepted telemetry, and owned incidents. Keep actual task confirmation separate from a planned assignment. Keep private check-ins separate from the operational trace.
2. **Ground and decision.** KAN-48, KAN-65 and KAN-67 deliver an immutable operational snapshot and attach its revision to advice. Verify the Commander can hold obsolete advice and that only an eligible onboard command reaches the writer. Confirm duplicate actions produce a single receipt.
3. **Integrated golden run.** KAN-68 composes the model, observations, incident, Relay and command gate. Apply due plant changes and deliveries before evaluation and commit the trace with the state change. Exercise the v102 advice against v103 case.
4. **Docking, station work and return.** KAN-83 establishes the separate capture, seal, pressure and hatch checks. Follow with independently reviewable crew and cargo custody tasks, station research, a return vehicle handoff and debrief. Unknown evidence keeps transfer pending.
5. **Crew measurement and history.** KAN-46 and KAN-51 wire private measurements and comparable trends. A workload or rest schedule can inform a check-in prompt. Only the astronaut supplies mood and symptoms.

import crew from "@contracts/examples/crew-v103.json";
import ground from "@contracts/examples/ground-v102.json";

// Fixture mode until SX-08B wires live role-scoped reads.
const FIXTURES = { crew, ground };

export const FIXTURE_RUN = {
  runId: crew.run_id,
  scenarioId: crew.scenario_id,
  seed: crew.seed,
};

/** Return the published example for this role and run, or null when none exists. */
export function fixtureFor(runId, role) {
  const payload = FIXTURES[role];
  return payload?.run_id === runId ? payload : null;
}

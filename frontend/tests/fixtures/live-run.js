// Synthetic responses for mocked live-run browser tests. The trace and plan
// were captured from the sx01-golden run advanced to 13:00 (780 s).
export const RUN_ID = "run-live-1";

export const GOLDEN_1300_TRACE = [
  { case_id: "inc-1fa7d4f9baf0", mission_s: 60, actor: "monitor", step: "incident_opened", result: "INSUFFICIENT_EVIDENCE", reason_code: null, next_owner: "crew" },
  { case_id: "advice-op-demo-013", mission_s: 480, actor: "ground", step: "advice_queued", result: "queued", reason_code: null, next_owner: "crew" },
  { case_id: "inc-c2bab98b0285", mission_s: 600, actor: "monitor", step: "incident_opened", result: "INSUFFICIENT_EVIDENCE", reason_code: null, next_owner: "crew" },
  { case_id: "advice-op-demo-013", mission_s: 780, actor: "relay", step: "advice_received", result: "held", reason_code: "STALE_BASIS", next_owner: "crew" },
];

export const GOLDEN_1300_PLAN = {
  status: "INSUFFICIENT_EVIDENCE", basis_snapshot_id: "crew-v103", decision_rev: 103,
  policy_version: "demo-1", horizon_s: 21600,
  candidates: [
    { candidate_id: "hold_course", result: "rejected", reason_code: "CO2_PEAK_LIMIT", peak_co2_ppm: 3757.12, required_kw: null, available_kw: null },
    { candidate_id: "start_standby", result: "rejected", reason_code: "POWER_LIMIT", peak_co2_ppm: null, required_kw: 0.4, available_kw: 0.2 },
    { candidate_id: "reduce_activity", result: "unknown", reason_code: "ACTIVITY_PERMISSION_UNKNOWN", peak_co2_ppm: null, required_kw: null, available_kw: null },
  ],
};

const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

function runView(role, trace) {
  const base = { run_id: RUN_ID, scenario_id: "sx01-golden", scenario_version: "1", seed: 4242, mission_s: 780, step: 5, status: "active", trace };
  return role === "crew"
    ? { ...base, role, decision_rev: 103, co2: null, health_profile: { crew_id: "SIM-01" }, health_assessment: null }
    : { ...base, role, packet: null, health_cases: [] };
}

/** Mock the demo session and both role views; returns nothing. */
export async function mockLiveRun(page, { crewTrace = GOLDEN_1300_TRACE, groundTrace = GOLDEN_1300_TRACE.slice(0, 2), plan = GOLDEN_1300_PLAN } = {}) {
  await page.route("**/api/v1/demo/session", (route) => route.fulfill(json({ facilitator: "fac-token", crew: "crew-token", ground: "ground-token" })));
  await page.route(`**/api/v1/runs/${RUN_ID}/crew`, (route) => route.fulfill(json(runView("crew", crewTrace))));
  await page.route(`**/api/v1/runs/${RUN_ID}/ground`, (route) => route.fulfill(json(runView("ground", groundTrace))));
  await page.route(`**/api/v1/runs/${RUN_ID}/plans/evaluate`, (route) => route.fulfill(json(plan)));
}

export { json };

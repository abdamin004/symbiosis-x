import { expect, test } from "@playwright/test";

test("local response remains available during blackout", async ({ page }) => {
  await page.route("**/api/v1/demo/session", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ facilitator: "fac-token", crew: "crew-token", ground: "ground-token" }),
  }));
  let openRequest;
  await page.route("**/api/v1/runs/run-001/crew/emergencies", (route) => {
    openRequest = route.request().postDataJSON();
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({
      case_id: "case-drill-collapse-v1", run_id: "run-001", drill_id: openRequest.drill_id,
      kind: "collapse", status: "open", opened_at_s: 60, owner: "SIM-04",
      subject_crew_id: "SIM-03", reported_by: "SIM-04", report_kind: "bystander_report",
      report: "Fictional drill script: SIM-04 finds SIM-03 collapsed.",
      responsiveness: "unknown",
      procedure: { kind: "training_placeholder", ref: "training-placeholder-collapse-v1", label: "TRAINING PLACEHOLDER: not an approved medical procedure." },
      escalation: { level: "local_alert", raised_at_s: 60, depends_on_vitals: false, depends_on_relay: false },
      vitals: { heart_rate: "unavailable", last_valid_observed_at_s: null },
      ground_link: "not_required", acknowledgment: null, synthetic: true, visibility: "crew",
    }) });
  });
  await page.route("**/api/v1/runs/run-001/crew/emergencies/case-drill-collapse-v1/acknowledgment", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({
      case_id: "case-drill-collapse-v1", run_id: "run-001", drill_id: "drill-collapse-v1",
      kind: "collapse", status: "acknowledged", opened_at_s: 60, owner: "SIM-04",
      subject_crew_id: "SIM-03", reported_by: "SIM-04", report_kind: "bystander_report",
      report: "Fictional drill script: SIM-04 finds SIM-03 collapsed.", responsiveness: "unknown",
      procedure: { kind: "training_placeholder", ref: "training-placeholder-collapse-v1", label: "TRAINING PLACEHOLDER: not an approved medical procedure." },
      escalation: { level: "local_alert", raised_at_s: 60, depends_on_vitals: false, depends_on_relay: false },
      vitals: { heart_rate: "unavailable", last_valid_observed_at_s: null }, ground_link: "not_required",
      acknowledgment: { acknowledged_by: "SIM-04", acknowledged_at_s: 60 }, synthetic: true, visibility: "crew",
    }),
  }));
  await page.goto("/runs/run-001/crew/emergency");
  await page.locator("#emergency-drill").selectOption("drill-collapse-v1");
  await page.getByRole("button", { name: "Raise local drill alert" }).click();
  const activeCase = page.getByTestId("emergency-case");
  await expect(activeCase).toContainText("Ground link not required");
  await expect(activeCase).toContainText("Heart-rate data");
  await expect(activeCase).toContainText("unavailable");
  await expect(page.getByRole("list",{name:"Onboard training steps"})).toContainText("check responsiveness and normal breathing");
  expect(openRequest.responsiveness).toBe("unknown");
  await page.getByRole("button", { name: "Acknowledge local response" }).click();
  await expect(activeCase).toContainText("Local responder acknowledged at 60s");
});


// Captured from the real API (drill-chest-pain-v1 on a fresh sx01-golden run); run_id replaced.
const CHEST_PAIN_CASE = {"case_id": "case-drill-chest-pain-v1", "run_id": "run-001", "drill_id": "drill-chest-pain-v1", "kind": "chest_pain", "status": "open", "opened_at_s": 0, "owner": "SIM-02", "subject_crew_id": "SIM-01", "reported_by": "SIM-01", "report_kind": "direct_symptom_report", "report": "Fictional drill script: SIM-01 reports chest pain.", "responsiveness": null, "procedure": {"kind": "training_placeholder", "ref": "training-placeholder-chest-pain-v1", "label": "TRAINING PLACEHOLDER: not an approved medical procedure. Follow the mission's approved onboard medical procedure."}, "escalation": {"level": "local_alert", "raised_at_s": 0, "depends_on_vitals": false, "depends_on_relay": false}, "vitals": {"heart_rate": "unavailable", "last_valid_observed_at_s": null}, "ground_link": "not_required", "acknowledgment": null, "synthetic": true, "visibility": "crew"};

test("chest-pain drill acts onboard without a Ground acknowledgment", async ({ page }) => {
  await page.route("**/api/v1/demo/session", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ facilitator: "fac-token", crew: "crew-token", ground: "ground-token" }),
  }));
  // Blackout: any Ground or relay traffic fails.
  const groundCalls = [];
  await page.route(/\/api\/v1\/runs\/[^/]+\/(ground|crew\/emergencies\/[^/]+\/relay)/, (route) => { groundCalls.push(route.request().url()); return route.abort(); });
  let openRequest;
  let ackRequest;
  await page.route("**/api/v1/runs/run-001/crew/emergencies", (route) => {
    openRequest = route.request().postDataJSON();
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(CHEST_PAIN_CASE) });
  });
  await page.route("**/api/v1/runs/run-001/crew/emergencies/case-drill-chest-pain-v1/acknowledgment", (route) => {
    ackRequest = route.request().postDataJSON();
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      ...CHEST_PAIN_CASE, status: "acknowledged", acknowledgment: { acknowledged_by: "SIM-02", acknowledged_at_s: 0 } }) });
  });

  await page.goto("/runs/run-001/crew/emergency");
  await page.locator("#emergency-drill").selectOption("drill-chest-pain-v1");
  await expect(page.getByLabel("Is the chest pain still present?")).toBeVisible();
  await page.getByRole("button", { name: "Raise local drill alert" }).click();

  const activeCase = page.getByTestId("emergency-case");
  await expect(activeCase.getByRole("heading")).toHaveText("Local alert · open");
  await expect(activeCase.getByTestId("emergency-ground-link")).toHaveText("Ground link not required");
  await expect(activeCase).toContainText("SIM-01 reports chest pain");
  await expect(activeCase).toContainText("Assigned responderSana Kepler");
  await expect(activeCase).toContainText("Escalationlocal_alert");
  await expect(page.getByText(/Simulated training only · follow/)).toBeVisible();
  expect(openRequest).toMatchObject({ drill_id: "drill-chest-pain-v1", reported_by: "SIM-01", synthetic: true });
  expect(openRequest).not.toHaveProperty("responsiveness");

  // The onboard responder closes the loop; nothing waits for Ground.
  await page.getByRole("button", { name: "Acknowledge local response" }).click();
  await expect(activeCase).toContainText("Local responder acknowledged at 0s");
  expect(ackRequest).toEqual({ acknowledged_by: "SIM-02" });
  expect(groundCalls).toEqual([]);
});

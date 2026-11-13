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
  await expect(activeCase).toContainText("TRAINING PLACEHOLDER");
  expect(openRequest.responsiveness).toBe("unknown");
  await page.getByRole("button", { name: "Acknowledge local response" }).click();
  await expect(activeCase).toContainText("Local responder acknowledged at 60s");
});


test("chest-pain drill raises and acknowledges a local alert without Ground", async ({ page }) => {
  await page.route("**/api/v1/demo/session", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ facilitator: "fac-token", crew: "crew-token", ground: "ground-token" }),
  }));
  let openRequest;
  const caseBody = (status, acknowledgment = null) => ({
    case_id: "case-drill-chest-pain-v1", run_id: "run-001", drill_id: "drill-chest-pain-v1",
    kind: "chest_pain", status, opened_at_s: 120, owner: "SIM-02",
    subject_crew_id: "SIM-01", reported_by: "SIM-01", report_kind: "self_report",
    report: "Fictional drill script: SIM-01 reports chest pain.",
    responsiveness: "unknown",
    procedure: { kind: "training_placeholder", ref: "training-placeholder-chest-pain-v1", label: "TRAINING PLACEHOLDER: not an approved medical procedure." },
    escalation: { level: "local_alert", raised_at_s: 120, depends_on_vitals: false, depends_on_relay: false },
    vitals: { heart_rate: "unavailable", last_valid_observed_at_s: null },
    ground_link: "not_required", acknowledgment, synthetic: true, visibility: "crew",
  });
  await page.route("**/api/v1/runs/run-001/crew/emergencies", async (route) => {
    openRequest = route.request().postDataJSON();
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(caseBody("open")) });
  });
  await page.route("**/api/v1/runs/run-001/crew/emergencies/case-drill-chest-pain-v1/acknowledgment", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify(caseBody("acknowledged", { acknowledged_by: "SIM-02", acknowledged_at_s: 120 })),
  }));

  await page.goto("/runs/run-001/crew/emergency");
  await page.locator("#emergency-drill").selectOption("drill-chest-pain-v1");
  await page.getByRole("button", { name: "Raise local drill alert" }).click();
  const activeCase = page.getByTestId("emergency-case");
  await expect(activeCase).toContainText("Local alert");
  await expect(activeCase).toContainText("Ground link not required");
  await expect(activeCase).toContainText("Heart-rate data");
  await expect(activeCase).toContainText("unavailable");
  await expect(activeCase).toContainText("TRAINING PLACEHOLDER");
  expect(openRequest).toMatchObject({ drill_id: "drill-chest-pain-v1", reported_by: "SIM-01", synthetic: true });
  await expect(openRequest.operation_id).toMatch(/^emergency-/);
  await page.getByRole("button", { name: "Acknowledge local response" }).click();
  await expect(activeCase).toContainText("Local responder acknowledged at 120s");
});

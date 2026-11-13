import { expect, test } from "@playwright/test";

test("seven metrics open the matching form", async ({ page }) => {
  await page.goto("/runs/run-001/crew/measure");
  const picker = page.getByLabel("Indicator");
  const cases = [
    ["heart_rate", "Heart rate", ["value", "activity"]],
    ["blood_pressure", "Blood pressure", ["systolic", "diastolic"]],
    ["glucose", "Blood glucose", ["value", "method", "meal_context"]],
    ["temperature", "Body temperature", ["value", "method", "site"]],
    ["sleep", "Sleep", ["duration_min", "start_mission_s", "end_mission_s"]],
    ["mood", "Mood self-report", ["score"]],
    ["symptoms", "Symptoms", ["symptoms", "private_text"]],
  ];
  for (const [metric, label, controls] of cases) {
    await picker.selectOption(metric);
    await expect(page.getByRole("heading", { name: label + " guide" })).toBeVisible();
    for (const id of controls) await expect(page.locator("#" + id)).toBeVisible();
  }
  await picker.selectOption("blood_pressure");
  await page.locator("#systolic").fill("120");
  await page.locator("#diastolic").fill("80");
  await page.getByRole("button", { name: "Validate measurement" }).click();
  await expect(page.getByTestId("measurement-preview")).toContainText('"systolic": 120');
  await picker.selectOption("mood");
  await page.locator("#score").fill("9");
  await page.getByRole("button", { name: "Validate measurement" }).click();
  await expect(page.getByRole("alert")).toContainText("between 1 and 5");
});

test("crew sees the reason for a saved reading", async ({ page }) => {
  const { mockLiveRun, json, RUN_ID } = await import("./fixtures/live-run.js");
  const saved = (await import("./fixtures/crew-health-live.json", { with: { type: "json" } })).default;
  await mockLiveRun(page);
  let assessment = null;
  let body;
  await page.route(`**/api/v1/runs/${RUN_ID}/crew`, (route) => route.fulfill(json({
    run_id: RUN_ID, scenario_id: "sx01-golden", scenario_version: "1", seed: 4242, mission_s: 0, step: 0, status: "active",
    role: "crew", decision_rev: 100, co2: { value: 2000, unit: "ppm", observed_at_s: 0, source_id: "sim.cabin.co2", event_id: "sim.cabin.co2:0" },
    health_profile: saved.health_profile, health_assessment: assessment, trace: [],
  })));
  await page.route(`**/api/v1/runs/${RUN_ID}/crew/measurements`, (route) => {
    body = route.request().postDataJSON();
    assessment = saved.health_assessment;
    return route.fulfill(json({ measurement_id: body.measurement_id, run_id: RUN_ID, crew_id: "SIM-01", synthetic: true,
      measurement: body.measurement, context: body.context, received_at_s: 0 }, 201));
  });

  await page.goto(`/runs/${RUN_ID}/crew`);
  const dashboard = page.getByTestId("crew-health-dashboard");
  await expect(dashboard.getByTestId("crew-health-flag")).toHaveText("No reading yet");
  await expect(dashboard.getByRole("list", { name: "Health indicators" }).getByRole("listitem")).toHaveCount(7);
  await expect(dashboard.getByTestId("indicator-heart_rate")).toContainText("Baseline 72 bpm");
  // Crew Health comes before the separate cabin context.
  const [healthBox, cabinBox] = [await dashboard.boundingBox(), await page.getByTestId("live-cabin-context").boundingBox()];
  expect(healthBox.y).toBeLessThan(cabinBox.y);
  // The deck and RadLab sit in the supporting panel, after Crew Health.
  const supporting = page.getByTestId("supporting-context");
  await supporting.locator("> summary").click();
  await expect(supporting.getByRole("link", { name: "Open the cabin deck" })).toHaveAttribute("href", "/mission");
  await expect(supporting.getByTestId("supporting-deck")).toContainText(`does not show run ${RUN_ID}`);
  await expect(supporting.getByTestId("radlab-context")).toBeVisible();
  const followsCabin = await supporting.evaluate((panel) =>
    !!(document.querySelector('[data-testid="live-cabin-context"]').compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING));
  expect(followsCabin).toBe(true);

  await dashboard.getByRole("link", { name: "Take a measurement" }).click();
  await page.locator("#value").fill("118");
  await page.getByRole("button", { name: "Validate measurement" }).click();
  await page.getByRole("button", { name: "Save to private Crew record" }).click();
  await page.getByRole("link", { name: "See the assessment in Crew Health" }).click();

  expect(body.context).toEqual({ activity: "rest" });
  await expect(dashboard.getByTestId("crew-health-flag")).toHaveText("Flagged for review");
  await expect(dashboard.getByTestId("indicator-heart_rate")).toContainText("Latest reading");
  await expect(dashboard.getByTestId("crew-health-reading")).toHaveText("118 bpm");
  await expect(dashboard.getByTestId("crew-health-quality")).toHaveText("valid");
  await expect(dashboard.getByTestId("crew-health-assessment")).toContainText("activity rest");
  const personal = dashboard.getByTestId("comparison-personal");
  await expect(personal.getByTestId("comparison-personal-status")).toHaveText("Outside personal range");
  await expect(personal).toContainText("above the personal range 57–87 bpm around the 72 bpm resting baseline");
  const reference = dashboard.getByTestId("comparison-reference");
  await expect(reference.getByTestId("comparison-reference-status")).toHaveText("Outside reference");
  await expect(reference).toContainText("Earth-based adult reference. Not validated for spaceflight.");
  await expect(reference.getByRole("link", { name: "Pulse" })).toHaveAttribute("href", "https://medlineplus.gov/ency/article/003399.htm");

  await dashboard.getByRole("link", { name: "Open Emergency Assist" }).click();
  await expect(page).toHaveURL(new RegExp(`/runs/${RUN_ID}/crew/emergency$`));
  await expect(page.getByRole("heading", { name: "Emergency Assist" })).toBeVisible();
});

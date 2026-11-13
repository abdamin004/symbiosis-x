import { expect, test } from "@playwright/test";
import { GOLDEN_1300_PLAN, json, mockLiveRun, RUN_ID } from "./fixtures/live-run.js";

test("Crew can read the alert reason", async ({ page }) => {
  await page.goto("/runs/run-001/crew");

  const panel = page.getByTestId("crew-health-panel");
  await expect(panel.getByRole("heading", { name: "Crew health context" })).toBeVisible();
  await expect(panel.getByTestId("health-alert-status")).toHaveText("Review alert");
  await expect(panel.getByTestId("health-alert-reason")).toContainText(
    "Three consecutive resting readings (95, 97, 98 bpm)",
  );
  await expect(panel.getByTestId("health-alert-reason")).toContainText("72 bpm personal baseline");
  await expect(panel.getByTestId("health-evidence-quality")).toHaveText("valid · 3 samples");
  await expect(panel.getByTestId("health-trend-status")).toHaveText("Rising trend · review with Crew");
  await expect(panel.getByTestId("health-trend-support")).toContainText("4 comparable samples");
  await expect(panel.getByTestId("health-trend-support")).toContainText("T+10:00 – T+13:00");
  await expect(panel.getByTestId("cabin-context")).toContainText("CO₂:");
  await expect(panel.getByTestId("cabin-context")).toContainText("modeled estimate");
  await expect(page.getByTestId("radlab-context")).toBeVisible();

  await page.goto("/runs/run-001/ground");
  await expect(page.getByTestId("crew-health-panel")).toHaveCount(0);
  await expect(page.getByTestId("radlab-context")).toHaveCount(0);
});

test("missing health and cabin readings remain unknown", async ({ page }) => {
  await page.goto("/tests/fixtures/crew-health.html");

  const panel = page.getByTestId("crew-health-panel");
  await expect(panel.getByTestId("health-alert-status")).toHaveText("Unknown");
  await expect(panel.getByTestId("health-observation")).toContainText("Unknown");
  await expect(panel.getByTestId("health-alert-reason")).toContainText("latest reading at 840 s is missing");
  await expect(panel.getByTestId("cabin-context")).toContainText("CO₂ is unknown");
  await expect(panel.getByTestId("health-trend-status")).toHaveText("Insufficient history");
  await expect(panel.getByTestId("health-trend-support")).toContainText("2 of 3 required comparable samples");
});

test("archive chart shows source and missing gaps", async ({ page }) => {
  await page.goto("/tests/fixtures/radiation-context.html");

  const panel = page.getByTestId("radlab-context");
  await expect(panel.getByRole("heading", { name: "Archived radiation context" })).toBeVisible();
  await expect(panel.getByText("DosTel1")).toBeVisible();
  await expect(panel.getByText("µGy/hour", { exact: true })).toBeVisible();
  await expect(panel.getByRole("link", { name: "NASA OSDR RadLab source query" })).toHaveAttribute(
    "href",
    /visualization\.osdr\.nasa\.gov\/radlab\/api/,
  );
  await expect(panel.getByTestId("radlab-gap")).toHaveCount(1);
  await panel.getByText("Readings (3)").click();
  await expect(panel.getByRole("cell", { name: "No reading (gap)" })).toBeVisible();
  await expect(panel.getByTestId("radlab-gap-summary")).toContainText("not interpolated");
  await expect(panel).not.toContainText("SIM-01 personal dose");
});

test("standby shows its power constraint", async ({ page }) => {
  await mockLiveRun(page);
  await page.goto(`/runs/${RUN_ID}/crew`);

  const list = page.getByTestId("candidate-list");
  await expect(list.getByTestId("candidate-basis")).toContainText("basis crew-v103 (v103)");
  await expect(list.getByTestId("candidate-basis")).toContainText("advisory only");
  const standby = list.getByTestId("candidate-start_standby");
  await expect(standby).toContainText("Not available");
  await expect(standby).toContainText("POWER_LIMIT");
  await expect(standby.getByTestId("candidate-power")).toHaveText("Power 0.40 kW required · 0.20 kW available");
  await expect(list.getByTestId("candidate-hold_course")).toContainText("3757 ppm (limit 3,200)");
  await expect(list.getByTestId("candidate-reduce_activity")).toContainText("Unknown");
  // No option is feasible, so nothing can be selected for approval.
  await expect(list.getByRole("button", { name: "Select for approval" })).toHaveCount(0);
});

test("approval retries use the same operation ID", async ({ page }) => {
  const plan = { ...GOLDEN_1300_PLAN, candidates: GOLDEN_1300_PLAN.candidates.map((c) => c.candidate_id === "start_standby"
    ? { ...c, result: "feasible", reason_code: null, available_kw: 0.6 } : c) };
  await mockLiveRun(page, { plan });
  const posts = [];
  const lookups = [];
  await page.route(`**/api/v1/runs/${RUN_ID}/actions`, (route) => {
    posts.push(route.request().postDataJSON());
    if (posts.length === 1) return route.abort("failed");             // the response is lost
    const sent = posts.at(-1);
    return route.fulfill(json({ operation_id: sent.operation_id, candidate_id: sent.candidate_id, status: "accepted",
      reason_code: null, basis_decision_rev: 103, current_decision_rev: 104, applied: true }));
  });
  await page.route(`**/api/v1/runs/${RUN_ID}/actions/*`, (route) => {
    lookups.push(decodeURIComponent(new URL(route.request().url()).pathname.split("/").at(-1)));
    return route.fulfill(json({ detail: "ACTION_NOT_FOUND" }, 404));
  });

  await page.goto(`/runs/${RUN_ID}/crew`);
  await page.getByTestId("candidate-start_standby").getByRole("button", { name: "Select for approval" }).click();
  await page.getByTestId("approval-panel").getByRole("button", { name: "Approve" }).click();

  const uncertain = page.getByTestId("approval-uncertain");
  await expect(uncertain).toContainText("may or may not have been recorded");
  await uncertain.getByRole("button", { name: "Look up receipt" }).click();
  await expect(uncertain).toContainText("no record of this approval yet");
  await uncertain.getByRole("button", { name: "Send again" }).click();

  await expect(page.getByTestId("approval-decision")).toHaveText("Accepted · applied");
  expect(posts).toHaveLength(2);
  const operationId = posts[0].operation_id;
  expect(operationId).toMatch(/^approve-/);
  expect(posts[1]).toEqual(posts[0]);
  expect(posts[0]).toMatchObject({ candidate_id: "start_standby", basis_decision_rev: 103, policy_version: "demo-1", basis_snapshot_id: "crew-v103" });
  expect(lookups).toEqual([operationId]);
  await expect(page.getByTestId("approval-operation-id")).toHaveText(operationId);
});


test("Crew can submit a private check-in", async ({ page }) => {
  await mockLiveRun(page);
  let submitted;
  await page.route(`**/api/v1/runs/${RUN_ID}/crew/check-ins`, async (route) => {
    submitted = route.request().postDataJSON();
    await route.fulfill(json({
      check_in_id: submitted.check_in_id,
      run_id: RUN_ID,
      crew_id: submitted.crew_id,
      note: submitted.note,
      mission_s: 780,
      synthetic: true,
    }, 201));
  });

  const marker = "SAMA_PRIVATE_CHECKIN_ACCEPTANCE";
  await page.goto(`/runs/${RUN_ID}/crew`);
  const form = page.getByTestId("private-checkin");
  await expect(form).toBeVisible();
  await form.getByRole("textbox").fill(marker);
  await form.getByRole("button", { name: "Save private check-in" }).click();
  await expect(page.getByTestId("checkin-receipt")).toContainText(marker);
  expect(submitted).toMatchObject({ crew_id: "SIM-01", note: marker, synthetic: true });
  expect(submitted.check_in_id).toMatch(/^checkin-/);

  await page.goto(`/runs/${RUN_ID}/ground`);
  await expect(page.getByText(marker, { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("private-checkin")).toHaveCount(0);
});

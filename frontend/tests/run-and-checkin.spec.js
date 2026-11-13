import { expect, test } from "@playwright/test";

async function mockSession(page) {
  await page.route("**/api/v1/demo/session", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ facilitator: "fac-token", crew: "crew-token", ground: "ground-token" }),
  }));
}

test("facilitator starts and steps one shared run", async ({ page }) => {
  await mockSession(page);
  let startBody;
  let advanceBody;
  await page.route("**/api/v1/runs", (route) => {
    startBody = route.request().postDataJSON();
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      run_id: "run-live-123", scenario_id: startBody.scenario_id, scenario_version: startBody.scenario_version,
      seed: startBody.seed, mission_s: 0, step: 0,
    }) });
  });
  await page.route("**/api/v1/runs/run-live-123/advance", (route) => {
    advanceBody = route.request().postDataJSON();
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      run_id: "run-live-123", scenario_id: "sx01-golden", scenario_version: "1", seed: 4242,
      mission_s: 60, step: 1, advance_id: advanceBody.advance_id,
    }) });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Start run" }).click();
  await expect(page.getByTestId("launcher-run-id")).toHaveText("run-live-123");
  expect(startBody.seed).toBe(4242);
  await expect(page.getByRole("link", { name: /Open Crew console/ })).toHaveAttribute("href", "/runs/run-live-123/crew");
  await expect(page.getByRole("link", { name: /Open Ground console/ })).toHaveAttribute("href", "/runs/run-live-123/ground");
  await page.getByRole("button", { name: "Advance one step" }).click();
  await expect(page.getByTestId("launcher-mission-time")).toHaveText("60");
  expect(advanceBody.expected_step).toBe(0);
  expect(advanceBody.advance_id).toBeTruthy();
});

test("Crew can submit a private check-in", async ({ page }) => {
  await mockSession(page);
  let saved;
  await page.route("**/api/v1/runs/run-001/crew/check-ins", (route) => {
    saved = route.request().postDataJSON();
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({
      check_in_id: saved.check_in_id, run_id: "run-001", crew_id: "SIM-01",
      note: saved.note, synthetic: true, mission_s: 0,
    }) });
  });
  await page.goto("/runs/run-001/crew");
  const form = page.getByTestId("private-checkin");
  await form.getByLabel("How are you feeling?").fill("Synthetic check-in marker: feeling steady.");
  await form.getByRole("button", { name: "Save private check-in" }).click();
  await expect(form.getByTestId("checkin-receipt")).toContainText("Synthetic check-in marker: feeling steady.");
  expect(saved.synthetic).toBe(true);
  expect(saved.crew_id).toBe("SIM-01");
  expect(saved.check_in_id).toBeTruthy();
});

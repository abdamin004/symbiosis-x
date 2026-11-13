import { expect, test } from "@playwright/test";

test("facilitator ends the mission after confirming", async ({ page }) => {
  await page.route("**/api/v1/demo/session", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ facilitator: "fac-token", crew: "crew-token", ground: "ground-token" }),
  }));
  await page.route("**/api/v1/runs", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({
      run_id: "run-end-1", scenario_id: "sx01-golden", scenario_version: "1", seed: 4242, mission_s: 0, step: 0,
    }) }));
  const endBodies = [];
  await page.route("**/api/v1/runs/run-end-1/end", (route) => {
    endBodies.push(route.request().postDataJSON());
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      run_id: "run-end-1", scenario_id: "sx01-golden", scenario_version: "1", seed: 4242,
      mission_s: 0, step: 0, end_id: endBodies.at(-1).end_id, status: "closed",
    }) });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Start run" }).click();
  await expect(page.getByTestId("launcher-run-id")).toHaveText("run-end-1");

  // Ending needs a second, explicit confirmation; backing out sends nothing.
  await page.getByRole("button", { name: "End mission" }).click();
  await page.getByRole("button", { name: "Keep flying" }).click();
  expect(endBodies).toHaveLength(0);
  await page.getByRole("button", { name: "End mission" }).click();
  await page.getByRole("button", { name: "Confirm end" }).click();

  await expect(page.getByTestId("launcher-run-status")).toHaveText("Mission ended · read only");
  await expect(page.getByRole("status")).toContainText("Mission ended at 0 seconds");
  expect(endBodies).toHaveLength(1);
  expect(endBodies[0].end_id).toMatch(/^end-/);
  await expect(page.getByRole("button", { name: "Advance one step" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "End mission" })).toHaveCount(0);
  // The role links still open the ended run for review.
  await expect(page.getByRole("link", { name: /Open Crew console/ })).toHaveAttribute("href", "/runs/run-end-1/crew");
});

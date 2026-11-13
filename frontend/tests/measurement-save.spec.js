import { expect, test } from "@playwright/test";

test("Crew can save a validated synthetic health measurement", async ({ page }) => {
  await page.route("**/api/v1/demo/session", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ facilitator: "fac-token", crew: "crew-token", ground: "ground-token" }),
  }));
  let requestBody;
  await page.route("**/api/v1/runs/run-001/crew/measurements", (route) => {
    requestBody = route.request().postDataJSON();
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({
      measurement_id: requestBody.measurement_id, run_id: "run-001", crew_id: "SIM-01",
      synthetic: true, measurement: requestBody.measurement, context: requestBody.context, received_at_s: 0,
    }) });
  });
  await page.goto("/runs/run-001/crew/measure");
  await page.locator("#value").fill("88");
  await page.getByRole("button", { name: "Validate measurement" }).click();
  await page.getByRole("button", { name: "Save to private Crew record" }).click();
  await expect(page.getByTestId("measurement-saved")).toContainText("Saved privately for SIM-01");
  expect(requestBody.synthetic).toBe(true);
  expect(requestBody.measurement.value).toBe(88);
  expect(requestBody.measurement.metric).toBe("heart_rate");
});

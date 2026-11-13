import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const example = (name) =>
  JSON.parse(readFileSync(new URL(`../../contracts/examples/${name}.json`, import.meta.url)));
const crew = example("crew-v103");
const ground = example("ground-v102");

const minutes = (seconds) =>
  `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

test("Ground shows delivered basis and sample age", async ({ page }) => {
  // The published golden handoff: Crew is on v103 with 0.20 kW while Ground still holds v102 at 0.60 kW.
  expect(crew.equipment.power_headroom.value).toBe(0.2);
  expect(ground.equipment.power_headroom.value).toBe(0.6);

  await page.goto(`/runs/${ground.run_id}/ground`);
  const panel = page.getByTestId("ground-snapshot");
  await expect(panel).toHaveAttribute("data-state", "delivered");
  await expect(panel.getByRole("heading", { name: "Delivered snapshot" })).toBeVisible();
  await expect(page.getByTestId("ground-basis-snapshot")).toHaveText("ground-v102");
  await expect(page.getByTestId("ground-basis-revision")).toHaveText("v102");
  await expect(page.getByTestId("ground-power")).toHaveText("0.60 kW");
  await expect(page.getByTestId("ground-co2")).toHaveText("2000 ppm");
  await expect(page.getByTestId("ground-observed")).toHaveText(minutes(ground.delivery.observed_at_s));
  await expect(page.getByTestId("ground-received")).toHaveText(minutes(ground.delivery.received_at_s));
  // Sample age is mission time minus observation time: 13:00 − 01:00 = 12:00.
  await expect(page.getByTestId("ground-age")).toHaveText("12:00");
  expect(ground.delivery.age_s).toBe(ground.mission_s - ground.delivery.observed_at_s);
  await expect(page.getByTestId("relay-link-status")).toHaveText("Delayed");
  await expect(panel).not.toContainText("0.20");
  await expect(panel).not.toContainText("v103");

  // Crew reads its own live state on the same run: v103 and 0.20 kW, with no Ground panel.
  await page.goto(`/runs/${crew.run_id}/crew`);
  await expect(page.getByTestId("console-snapshot-id")).toHaveText("crew-v103");
  const power = page.getByRole("listitem").filter({ hasText: "Power headroom" });
  await expect(power).toContainText("0.2");
  await expect(power).toContainText("kW");
  await expect(page.getByTestId("ground-snapshot")).toHaveCount(0);
});

test("Ground keeps the empty state until the first live delivery", async ({ page }) => {
  const tokens = { facilitator: "fac-token", crew: "crew-token", ground: "ground-token" };
  let packet = null;
  await page.route("**/api/v1/demo/session", (route) => route.fulfill({ json: tokens }));
  await page.route("**/api/v1/runs/run-live-ground/ground", (route) => {
    expect(route.request().headers().authorization).toBe("Bearer ground-token");
    return route.fulfill({ json: {
      run_id: "run-live-ground", scenario_id: "sx01-golden", scenario_version: "1",
      mission_s: packet ? 900 : 300, role: "ground", packet, trace: [], health_cases: [],
    } });
  });

  await page.goto("/runs/run-live-ground/ground");
  const panel = page.getByTestId("ground-snapshot");
  await expect(panel).toHaveAttribute("data-state", "empty");
  await expect(panel).toContainText("No Ground packet has been delivered yet.");

  packet = {
    snapshot_id: "ground-v103", decision_rev: 103,
    delivery: { observed_at_s: 600, received_at_s: 900, age_s: 300, link_status: "delayed" },
    co2: { value: 2047.86, unit: "ppm", kind: "delivered_observation", observed_at_s: 600 },
    power_headroom: { value: 0.2, unit: "kW", observed_at_s: 600 },
  };
  await page.reload();
  await expect(panel).toHaveAttribute("data-state", "delivered");
  await expect(page.getByTestId("ground-basis-snapshot")).toHaveText("ground-v103");
  await expect(page.getByTestId("ground-basis-revision")).toHaveText("v103");
  await expect(page.getByTestId("ground-power")).toHaveText("0.20 kW");
  await expect(page.getByTestId("ground-co2")).toHaveText("2048 ppm");
  await expect(page.getByTestId("ground-observed")).toHaveText("10:00");
  await expect(page.getByTestId("ground-received")).toHaveText("15:00");
  await expect(page.getByTestId("ground-age")).toHaveText("05:00");
});

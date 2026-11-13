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

test("advice uses displayed delivered snapshot", async ({ page }) => {
  const tokens = { facilitator: "fac-token", crew: "crew-token", ground: "ground-token" };
  const requests = [];
  let reply = "queued";
  await page.route("**/api/v1/demo/session", (route) => route.fulfill({ json: tokens }));
  await page.route(`**/api/v1/runs/${ground.run_id}/ground/advisories`, (route) => {
    const body = route.request().postDataJSON();
    requests.push({ body, authorization: route.request().headers().authorization });
    if (reply === "lost") return route.abort("connectionreset");
    if (reply === "rejected") return route.fulfill({ status: 409, json: { detail: "BASIS_NOT_DELIVERED" } });
    return route.fulfill({ json: {
      operation_id: body.operation_id, run_id: ground.run_id, status: "queued",
      candidate_id: body.candidate_id, basis_snapshot_id: body.basis_snapshot_id,
      basis_decision_rev: 102, issued_at_s: ground.mission_s, deliver_at_s: ground.mission_s + 300,
    } });
  });

  await page.goto(`/runs/${ground.run_id}/ground`);
  const displayed = await page.getByTestId("ground-basis-snapshot").textContent();
  expect(displayed).toBe("ground-v102");
  const form = page.getByTestId("advisory-form");
  await expect(form.getByTestId("advisory-basis")).toHaveText(displayed);
  await form.getByLabel("Start standby scrubber").check();

  // The first send is lost; the retry reuses its operation ID, so the server queues it once.
  reply = "lost";
  await form.getByRole("button", { name: "Queue advice" }).click();
  await expect(form.getByTestId("advisory-rejected")).toBeVisible();
  reply = "queued";
  await form.getByRole("button", { name: "Queue advice" }).click();

  const receipt = form.getByTestId("advisory-receipt");
  await expect(receipt).toHaveAttribute("data-status", "queued");
  await expect(form.getByTestId("advisory-status")).toHaveText("Queued");
  await expect(form.getByTestId("advisory-receipt-basis")).toHaveText("ground-v102 · v102");
  await expect(form.getByTestId("advisory-due")).toHaveText("18:00");
  await expect(form.getByTestId("advisory-rejected")).toHaveCount(0);

  expect(requests).toHaveLength(2);
  for (const { body, authorization } of requests) {
    expect(authorization).toBe("Bearer ground-token");
    expect(body.basis_snapshot_id).toBe(displayed);
    expect(body.candidate_id).toBe("start_standby");
  }
  expect(requests[1].body.operation_id).toBe(requests[0].body.operation_id);

  // A rejected basis shows the server's reason in the form, not a receipt.
  reply = "rejected";
  await form.getByLabel("Hold course").check();
  await form.getByRole("button", { name: "Queue advice" }).click();
  await expect(form.getByTestId("advisory-rejected")).toContainText("BASIS_NOT_DELIVERED");
  await expect(form.getByTestId("advisory-receipt")).toHaveCount(0);
  // Approval stays with Crew: Ground has no approve control.
  await expect(page.getByRole("button", { name: /approve/i })).toHaveCount(0);
});

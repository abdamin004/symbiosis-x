import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const example = (name) =>
  JSON.parse(readFileSync(new URL(`../../contracts/examples/${name}.json`, import.meta.url)));
const crew = example("crew-v103");
const ground = example("ground-v102");

test("launch links keep the same run ID", async ({ page }) => {
  const runId = crew.run_id;
  expect(ground.run_id).toBe(runId);

  for (const [role, snapshot, title] of [
    ["crew", crew, "Crew console"],
    ["ground", ground, "Ground console"],
  ]) {
    await page.goto("/");
    await expect(page.getByTestId("launcher-run-id")).toHaveText(runId);

    const link = page.getByRole("link", { name: new RegExp(title, "i") });
    await expect(link).toHaveAttribute("href", `/runs/${runId}/${role}`);
    await link.click();

    await expect(page).toHaveURL(new RegExp(`/runs/${runId}/${role}$`));
    const shell = page.getByTestId("console-shell");
    await expect(shell).toHaveAttribute("data-role", role);
    await expect(shell).toHaveAttribute("data-run-id", runId);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page.getByTestId("console-run-id")).toHaveText(runId);
    await expect(page.getByTestId("console-snapshot-id")).toHaveText(snapshot.snapshot_id);
  }

  await expect(page.getByRole("heading", { name: "Delivered snapshot" })).toBeVisible();
  await expect(page.getByText(crew.crew.check_in.text)).toHaveCount(0);
});

test("an unknown run shows the missing fixture state", async ({ page }) => {
  await page.route("**/api/v1/demo/session", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ facilitator: "fac-token", crew: "crew-token", ground: "ground-token" }),
  }));
  await page.route("**/api/v1/runs/run-unknown/ground", (route) => route.fulfill({
    status: 404, contentType: "application/json", body: JSON.stringify({ detail: "RUN_NOT_FOUND" }),
  }));
  await page.goto("/runs/run-unknown/ground");

  await expect(page.getByRole("status")).toHaveText("No fixture is available for run run-unknown.");
  await expect(page.getByTestId("console-shell")).toHaveCount(0);
});

test("service health is separate from simulated relay", async ({ page }) => {
  const readiness = { mode: "down" };
  await page.route("**/health/ready", (route) => {
    if (readiness.mode === "down") return route.abort("connectionrefused");
    if (readiness.mode === "starting") {
      return route.fulfill({
        status: 503,
        json: {
          status: "not_ready",
          reason: "SCHEMA_MISMATCH",
          checks: { store: "ok", schema: "mismatch", manifest: "ok" },
        },
      });
    }
    return route.fulfill({
      status: 200,
      json: { status: "ready", reason: null, checks: { store: "ok", schema: "ok", manifest: "ok" } },
    });
  });

  // A failed probe shows Unreachable on the launcher and console alike.
  await page.goto("/");
  const badge = page.getByTestId("service-status");
  await expect(badge).toHaveAttribute("data-state", "unreachable");
  await expect(badge).toContainText("Unreachable");

  // A readiness failure the service reports is Starting, not Unreachable.
  readiness.mode = "starting";
  await page.reload();
  await expect(badge).toHaveAttribute("data-state", "starting");
  await expect(badge).toContainText("Starting");

  // The Ground relay is simulated as delayed; the service itself stays Ready.
  readiness.mode = "ready";
  await page.goto(`/runs/${ground.run_id}/ground`);
  await expect(badge).toHaveAttribute("data-state", "ready");
  await expect(badge).toContainText("Ready");
  await expect(page.getByTestId("relay-link-status")).toHaveText("Delayed");
  await expect(badge).not.toContainText("Delayed");
});


test("facilitator starts and steps one shared run", async ({ browser, page }) => {
  const runId = "run-facilitator-08d";
  let step = 0;
  let advances = 0;
  const tokens = { facilitator: "fac-token", crew: "crew-token", ground: "ground-token" };
  const session = (route) => route.fulfill({ status: 200, json: tokens });
  const handleRun = async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const role = request.headers().authorization;
    if (role !== "Bearer fac-token") {
      await route.fulfill({ status: 403, json: { detail: "FORBIDDEN_ROLE" } });
      return;
    }
    if (pathname === "/api/v1/runs" && request.method() === "POST") {
      await route.fulfill({ status: 200, json: {
        run_id: runId, scenario_id: "sx01-golden", scenario_version: "1",
        seed: 4242, mission_s: 0, step: 0,
      } });
      return;
    }
    if (pathname === `/api/v1/runs/${runId}/advance`) {
      const payload = request.postDataJSON();
      expect(payload.advance_id).toBeTruthy();
      expect(payload.expected_step).toBe(step);
      step += 1;
      advances += 1;
      await route.fulfill({ status: 200, json: { run_id: runId, step, mission_s: step * 60 } });
      return;
    }
    await route.fulfill({ status: 404, json: { detail: "RUN_NOT_FOUND" } });
  };
  await page.route("**/api/v1/demo/session", session);
  await page.route("**/api/v1/runs**", handleRun);
  await page.goto("/");
  await page.getByRole("button", { name: "Start run" }).click();
  await expect(page.getByTestId("launcher-run-id")).toHaveText(runId);
  await expect(page.getByRole("link", { name: /open crew console/i }))
    .toHaveAttribute("href", `/runs/${runId}/crew`);
  await expect(page.getByRole("link", { name: /open ground console/i }))
    .toHaveAttribute("href", `/runs/${runId}/ground`);
  await page.getByRole("button", { name: "Advance one step" }).click();
  await expect(page.getByTestId("launcher-mission-time")).toHaveText("60");
  expect(advances).toBe(1);

  // Independent Crew and Ground browser sessions must not receive facilitator rights.
  for (const role of ["crew", "ground"]) {
    const context = await browser.newContext();
    try {
      const other = await context.newPage();
      await other.route("**/api/v1/demo/session", session);
      await other.route("**/api/v1/runs**", handleRun);
      await other.goto("/");
      await other.evaluate((id) => sessionStorage.setItem("symbiosis-x-active-run", id), runId);
      const denied = await other.evaluate(async ({ id, roleName }) => {
        const token = roleName + "-token";
        const response = await fetch(`/api/v1/runs/${id}/advance`, {
          method: "POST",
          headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
          body: JSON.stringify({ advance_id: "unauthorized-" + roleName, expected_step: 1 }),
        });
        return response.status;
      }, { id: runId, roleName: role });
      expect(denied).toBe(403);
    } finally {
      await context.close();
    }
  }
  expect(advances).toBe(1);
});

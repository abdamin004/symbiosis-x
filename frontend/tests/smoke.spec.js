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
  await page.route("**/api/v1/demo/session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ facilitator: "fac", crew: "crew", ground: "ground" }) }));
  await page.route("**/api/v1/runs/run-unknown/ground", (route) => route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ detail: "RUN_NOT_FOUND" }) }));
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

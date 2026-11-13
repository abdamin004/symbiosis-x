import { expect, test } from "@playwright/test";

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

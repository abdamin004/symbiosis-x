import { expect, test } from "@playwright/test";

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


import { test, expect } from "@playwright/test";

test("seven metrics open the matching form", async ({ page }) => {
  await page.goto("/runs/run-001/crew/measure");

  await expect(
    page.getByText("Take Measurement")
  ).toBeVisible();

  const metrics = [
    "Heart rate",
    "Blood pressure",
    "Blood glucose",
    "Body temperature",
    "Sleep",
    "Mood self-report",
    "Symptoms",
  ];

  for (const metric of metrics) {
    await page.getByRole("button", {
      name: metric,
      exact: true,
    }).click();

    await expect(
      page.getByText("Measurement guide")
    ).toBeVisible()
  }
});

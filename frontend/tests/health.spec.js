import { expect, test } from "@playwright/test";

test("seven metrics open the matching form", async ({ page }) => {
  await page.goto("/runs/run-001/crew/measure");
  const picker = page.getByLabel("Indicator");
  const cases = [
    ["heart_rate", "Heart rate", ["value", "activity"]],
    ["blood_pressure", "Blood pressure", ["systolic", "diastolic"]],
    ["glucose", "Blood glucose", ["value", "method", "meal_context"]],
    ["temperature", "Body temperature", ["value", "method", "site"]],
    ["sleep", "Sleep", ["duration_min", "start_mission_s", "end_mission_s"]],
    ["mood", "Mood self-report", ["score"]],
    ["symptoms", "Symptoms", ["symptoms", "private_text"]],
  ];
  for (const [metric, label, controls] of cases) {
    await picker.selectOption(metric);
    await expect(page.getByRole("heading", { name: label + " guide" })).toBeVisible();
    for (const id of controls) await expect(page.locator("#" + id)).toBeVisible();
  }
  await picker.selectOption("blood_pressure");
  await page.locator("#systolic").fill("120");
  await page.locator("#diastolic").fill("80");
  await page.getByRole("button", { name: "Validate measurement" }).click();
  await expect(page.getByTestId("measurement-preview")).toContainText('"systolic": 120');
  await picker.selectOption("mood");
  await page.locator("#score").fill("9");
  await page.getByRole("button", { name: "Validate measurement" }).click();
  await expect(page.getByRole("alert")).toContainText("between 1 and 5");
});

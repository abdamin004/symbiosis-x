import { expect, test } from "@playwright/test";

test("Ground sees pending, then only the approved case status", async ({ page }) => {
  // The Ground console has no delivered case in the v102 fixture: it stays pending.
  await page.goto("/runs/run-001/ground");
  await expect(page.getByTestId("ground-health-pending")).toContainText("Pending");
  await page.goto("/runs/run-001/crew");
  await expect(page.getByTestId("ground-health-status")).toHaveCount(0);

  await page.goto("/tests/fixtures/ground-health.html");
  const item = page.getByTestId("ground-health-case");
  await expect(item).toContainText("health-case-3f2a9c1b7e");
  await expect(item).toContainText("Urgent review · Open onboard");
  await expect(item).toContainText("Delivered 05:00");
  await expect(item).not.toContainText("SIM-");
  await item.getByRole("button", { name: "Acknowledge receipt" }).click();
  await expect(page.getByTestId("ground-health-ack")).toHaveText("Receipt acknowledged 06:00");
});

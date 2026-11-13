import { expect, test } from "@playwright/test";

test("keyboard and pointer select the same asset in both role consoles", async ({ page }) => {
  for (const role of ["crew", "ground"]) {
    await page.goto(`/runs/run-001/${role}`);
    const deck = page.getByTestId("deck-map");
    await expect(deck).toBeVisible();
    await expect(deck.locator("#ship-map")).toBeVisible();

    const power = deck.getByRole("button", { name: "Inspect power bus" });
    await power.click();
    await expect(deck.getByTestId("deck-selected-title")).toHaveText("Power bus");
    await expect(power).toHaveAttribute("aria-pressed", "true");

    const medical = deck.getByRole("button", { name: "Inspect medical kit" });
    await medical.focus();
    await medical.press("Enter");
    await expect(deck.getByTestId("deck-selected-title")).toHaveText("Medical kit");
    await expect(medical).toHaveAttribute("aria-pressed", "true");

    if (role === "ground") {
      await expect(page.getByTestId("crew-health-panel")).toHaveCount(0);
      await expect(deck.getByTestId("deck-selected-title")).not.toContainText("health record");
    }
  }
});

import { expect, test } from "@playwright/test";
import { mockLiveRun, RUN_ID } from "./fixtures/live-run.js";

test("case card shows the hold reason and next owner", async ({ page }) => {
  await mockLiveRun(page);
  await page.goto(`/runs/${RUN_ID}/crew`);

  const strip = page.getByTestId("agent-status-strip");
  await expect(strip.getByTestId("case-card")).toHaveCount(3);
  const advice = strip.locator('[data-case-id="advice-op-demo-013"]');
  await expect(advice).toContainText("Ground advice op-demo-013 · open since 08:00");
  await expect(advice).toContainText("Relay: Classified arriving advice");
  await expect(advice.getByTestId("case-result")).toHaveText("held · STALE_BASIS");
  await expect(advice.getByTestId("case-next-owner")).toHaveText("Next: Crew · as of 13:00");
  await expect(page.getByTestId("trace-timeline").getByRole("listitem")).toHaveCount(4);

  // Ground sees only its own advice and delivered onboard milestones, never the onboard hold.
  await page.goto(`/runs/${RUN_ID}/ground`);
  await expect(page.getByTestId("case-card")).toHaveCount(2);
  await expect(page.getByTestId("agent-status-strip")).not.toContainText("STALE_BASIS");
  await expect(page.locator('[data-case-id="advice-op-demo-013"]').getByTestId("case-result")).toHaveText("queued");
});

import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const storyboard = JSON.parse(readFileSync(
  new URL("../../scenarios/expected/sx01-golden-storyboard.json", import.meta.url), "utf8"));

const minutes = (seconds) =>
  `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

test("offline backup plays the five saved frames without the service", async ({ page }) => {
  // The service is down: every API and health request is refused, and none should be made.
  const serviceCalls = [];
  await page.route((url) => url.pathname.startsWith("/api/") || url.pathname.startsWith("/health/"), (route) => {
    serviceCalls.push(route.request().url());
    return route.abort("connectionrefused");
  });

  await page.goto("/backup");
  await expect(page.getByTestId("backup-provenance")).toContainText(
    `seed ${storyboard.seed} · model ${storyboard.model_version}`);

  expect(storyboard.frames).toHaveLength(5);
  for (const [index, frame] of storyboard.frames.entries()) {
    if (index) await page.getByRole("button", { name: "Next" }).click();
    const replay = page.getByTestId("backup-replay");
    await expect(replay).toHaveAttribute("data-beat", frame.beat_id);
    await expect(page.getByTestId("backup-beat-label")).toHaveText(frame.label);
    await expect(page.getByTestId("backup-mission-time")).toHaveText(minutes(frame.mission_s));
    await expect(page.getByTestId("backup-crew-revision")).toHaveText(`v${frame.crew.decision_rev}`);
    await expect(page.getByTestId("backup-crew-co2")).toHaveText(`${frame.crew.co2.value} ppm`);
    await expect(page.getByTestId("backup-ground-basis")).toHaveText(
      `${frame.ground.snapshot_id} · v${frame.ground.decision_rev}`);
    await expect(page.getByTestId("backup-ground-power")).toHaveText(
      `${frame.ground.power_headroom.value.toFixed(2)} kW`);
    await expect(page.getByTestId("backup-ground-age")).toHaveText(minutes(frame.ground.delivery.age_s));
  }

  // The last beat: Ground still on v102 at 0.60 kW while Crew is on v103 and the stale advice is held.
  await expect(page.getByTestId("backup-ground-basis")).toHaveText("ground-v102 · v102");
  await expect(page.getByTestId("backup-crew-revision")).toHaveText("v103");
  await expect(page.getByTestId("backup-crew-standby")).toContainText("POWER_LIMIT");
  await expect(page.getByTestId("backup-crew-trace")).toContainText("STALE_BASIS");
  await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();
  expect(serviceCalls).toEqual([]);
});

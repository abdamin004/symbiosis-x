// SX-26A: the health-first release replay on a fresh seeded instance.
// It drives all five routes through the real UI and API: Run Launcher, Take Measurement,
// Crew Health, Emergency Assist and Ground, then a separate collapse replay.
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { startBackend, stopBackend, useBackend } from "./support/backend.js";

const read = (path) => JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"));
const plan = read("scenarios/variants/health-demo-v1.json");
const expected = read("scenarios/expected/health-demo-v1.json");
const minutes = (seconds) =>
  `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

let backend;
test.beforeAll(async () => { backend = await startBackend("sx26a"); });
test.afterAll(() => stopBackend(backend));

async function sessions(browser, baseURL, count) {
  const contexts = await Promise.all(Array.from({ length: count }, () => browser.newContext({ baseURL })));
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  await Promise.all(pages.map((page) => useBackend(page, backend.origin)));
  return { contexts, pages };
}

async function startRun(facilitator) {
  await facilitator.goto("/");
  await facilitator.getByRole("button", { name: "Start run" }).click();
  await expect(facilitator.getByTestId("launcher-run-id")).toHaveText(/^[0-9a-f]{32}$/);
  return (await facilitator.getByTestId("launcher-run-id").textContent()).trim();
}

async function stepTo(facilitator, seconds) {
  await facilitator.getByRole("button", { name: "Advance one step" }).click();
  await expect(facilitator.getByTestId("launcher-mission-time")).toHaveText(String(seconds));
}

async function enterReading(crew, runId, reading) {
  await crew.goto(`/runs/${runId}/crew/measure`);
  await crew.locator("#metric-picker").selectOption(reading.metric);
  await crew.locator("#observed_at_s").fill(String(reading.observed_at_s));
  await crew.locator("#value").fill(String(reading.value));
  await crew.getByRole("button", { name: "Validate measurement" }).click();
  await crew.getByRole("button", { name: "Save to private Crew record" }).click();
  await expect(crew.getByTestId("measurement-saved")).toContainText("Saved privately for SIM-01");
}

test("health demo passes across Crew and Ground", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(120_000);
  const marker = plan.private_marker;
  const readings = plan.steps.filter((step) => step.action === "enter_reading").map((step) => step.reading);
  const { contexts, pages: [facilitator, crew, ground] } = await sessions(browser, baseURL, 3);
  try {
    // Run Launcher: the facilitator starts the seeded golden run.
    const runId = await startRun(facilitator);
    await testInfo.attach("run", { body: JSON.stringify({ runId, ...plan.base_run }), contentType: "application/json" });

    // Take Measurement: three resting heart-rate readings at 00:00, 01:00 and 06:00.
    await enterReading(crew, runId, readings[0]);
    await stepTo(facilitator, 60);
    await enterReading(crew, runId, readings[1]);
    await stepTo(facilitator, 360);
    await enterReading(crew, runId, readings[2]);

    // Crew Health: baseline and reference compared separately, a trend and a reminder.
    const at360 = expected.at_360_crew;
    await crew.goto(`/runs/${runId}/crew`);
    await expect(crew.getByText(/Mission time 06:00/)).toBeVisible();
    await expect(crew.getByTestId("crew-health-reading")).toContainText(at360.assessment.reading);
    await expect(crew.getByTestId("comparison-personal-status")).toHaveText("Outside personal range");
    await expect(crew.getByTestId("comparison-reference-status")).toHaveText("Within reference");
    await expect(crew.getByTestId("health-trend")).toBeVisible();
    await expect(crew.getByTestId("health-trend-reason")).toContainText(
      `rising from ${at360.trend.start_value} to ${at360.trend.end_value} bpm across ${at360.trend.sample_count}`);
    const reminders = crew.getByTestId("health-reminders");
    await expect(reminders).toHaveAttribute("data-precedence", "routine");
    await expect(crew.getByTestId("reminder-heart_rate")).toHaveAttribute("data-status", at360.reminders.heart_rate.status);
    await expect(crew.getByTestId("reminder-heart_rate-action")).toContainText("Review with the crew medical officer");
    await expect(crew.getByTestId("reminder-blood_pressure")).toHaveAttribute("data-status", at360.reminders.blood_pressure.status);
    // Cabin context remains available beside the health panels.
    await expect(crew.getByTestId("live-cabin-context")).toContainText("CO₂");
    // A private check-in carries the marker that must never reach Ground.
    const privatePanel = crew.getByTestId("private-checkin");
    await privatePanel.getByRole("textbox").fill(marker);
    await privatePanel.getByRole("button", { name: "Save private check-in" }).click();
    await expect(crew.getByTestId("checkin-receipt")).toBeVisible();
    await testInfo.attach("crew-health-0600", { body: await crew.screenshot({ fullPage: true }), contentType: "image/png" });

    // Emergency Assist: the chest-pain drill opens locally, is acknowledged and is shared.
    const caseExpected = expected.chest_pain_case;
    await crew.goto(`/runs/${runId}/crew/emergency`);
    await crew.locator("#emergency-drill").selectOption("drill-chest-pain-v1");
    await crew.getByRole("button", { name: "Raise local drill alert" }).click();
    const localCase = crew.getByTestId("emergency-case");
    await expect(localCase).toContainText(`${caseExpected.opened_at_s}s mission time`);
    await expect(localCase).toContainText(caseExpected.owner);
    await expect(localCase).toContainText(caseExpected.escalation);
    await expect(localCase).toContainText("Ground link not required");
    await crew.getByRole("button", { name: "Acknowledge local response" }).click();
    await expect(localCase).toContainText(`Local responder acknowledged at ${caseExpected.acknowledged_at_s}s`);
    await crew.getByRole("button", { name: "Share case status with Ground" }).click();
    await expect(crew.getByTestId("emergency-share-receipt")).toContainText(
      `due at Ground ${caseExpected.share.deliver_at_s}s`);

    // Emergency takes precedence over routine reminders.
    await crew.goto(`/runs/${runId}/crew`);
    await expect(crew.getByTestId("health-reminders")).toHaveAttribute("data-precedence", "emergency");
    await expect(crew.getByTestId("reminders-emergency")).toContainText("Emergency takes precedence");

    // Ground before delivery: the delayed packet has not arrived, so the case is pending.
    await stepTo(facilitator, 480);
    await ground.goto(`/runs/${runId}/ground`);
    await expect(ground.getByText(/Mission time 08:00/)).toBeVisible();
    await expect(ground.getByTestId("ground-health-pending")).toBeVisible();
    await expect(ground.getByTestId("ground-health-case")).toHaveCount(0);

    // Ground after delivery at 11:00: only the allowlisted alias, priority and status.
    await stepTo(facilitator, 600);
    await stepTo(facilitator, 780);
    await ground.reload();
    const groundCase = ground.getByTestId("ground-health-case");
    await expect(groundCase).toHaveCount(1);
    await expect(groundCase).toContainText(`Delivered ${minutes(expected.ground.at_780.case.delivered_at_s)}`);
    await expect(groundCase).toContainText(/health-case-/);
    await expect(ground.getByTestId("ground-basis-snapshot")).toHaveText(expected.ground.at_780.snapshot.snapshot_id);
    await expect(ground.getByTestId("ground-power")).toHaveText("0.60 kW");
    await ground.getByRole("button", { name: "Acknowledge receipt" }).click();
    await expect(ground.getByTestId("ground-health-ack")).toContainText("Receipt acknowledged 13:00");
    await testInfo.attach("ground-1300", { body: await ground.screenshot({ fullPage: true }), contentType: "image/png" });

    // Privacy: neither the Ground page nor Ground's API response carries private Crew data.
    const groundJson = await ground.evaluate(async (id) => {
      const tokens = await (await fetch("/api/v1/demo/session", { method: "POST" })).json();
      return fetch(`/api/v1/runs/${id}/ground`, { headers: { Authorization: "Bearer " + tokens.ground } })
        .then((response) => response.text());
    }, runId);
    const groundPage = await ground.locator("body").innerText();
    for (const secret of expected.ground.never_contains) {
      expect(groundJson, secret).not.toContain(secret);
      expect(groundPage, secret).not.toContain(secret);
    }

    // The Crew's onboard case is unchanged by Ground's acknowledgment.
    await crew.goto(`/runs/${runId}/crew`);
    await expect(crew.getByTestId("reminders-emergency")).toBeVisible();

    // Offline fallback: the saved golden frames still play.
    await crew.goto("/backup");
    await expect(crew.getByTestId("backup-replay")).toBeVisible();
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test("collapse drill runs as a separate replay", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(60_000);
  const collapse = expected.collapse_case;
  const { contexts, pages: [facilitator, crew] } = await sessions(browser, baseURL, 2);
  try {
    const runId = await startRun(facilitator);
    await crew.goto(`/runs/${runId}/crew/emergency`);
    await crew.locator("#emergency-drill").selectOption("drill-collapse-v1");
    await crew.locator("#responsiveness").selectOption(collapse.responsiveness);
    await crew.getByRole("button", { name: "Raise local drill alert" }).click();
    const localCase = crew.getByTestId("emergency-case");
    await expect(localCase).toContainText("Responsiveness");
    await expect(localCase).toContainText(collapse.responsiveness);
    await expect(localCase).toContainText(collapse.owner);
    await expect(localCase).toContainText(collapse.escalation);
    await crew.getByRole("button", { name: "Acknowledge local response" }).click();
    await expect(localCase).toContainText("Local responder acknowledged at 0s");
    await testInfo.attach("collapse-drill", { body: await crew.screenshot({ fullPage: true }), contentType: "image/png" });
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

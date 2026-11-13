import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { startBackend, stopBackend, useBackend } from "./support/backend.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
let backend, directory, flightHtml;

test.beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "flight-health-story-"));
  const output = join(directory, "flight.html");
  execFileSync(process.env.SX_TEST_PYTHON || "python3", ["scripts/build_flight_canvas.py", output], {
    cwd:root, stdio:"inherit",
  });
  flightHtml = readFileSync(output, "utf8");
  backend = await startBackend("kan151");
});

test.afterAll(() => {
  stopBackend(backend);
  if (directory) rmSync(directory, {recursive:true, force:true});
});

test("Mara's live Flight twin explains review and shares only a delayed case status", async ({page, request}) => {
  test.setTimeout(120_000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({width:1200,height:674});
  await page.clock.install({time:new Date("2026-01-01T00:00:00Z")});
  await page.clock.pauseAt(new Date("2026-01-01T00:00:10Z"));
  await useBackend(page,backend.origin);
  await page.route(url => url.pathname === "/flight", route =>
    route.fulfill({contentType:"text/html",body:flightHtml}));

  await page.goto("/flight");
  const runCreated = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/runs" &&
    response.request().method() === "POST");
  await page.getByRole("button",{name:"Run astronaut health demo"}).dispatchEvent("click");
  const started = await (await runCreated).json();
  expect(started.scenario_id).toBe("health-story");

  const show = page.locator("#show-health-story");
  const story = page.getByRole("region",{name:"Mara’s private health story"});
  const state = story.locator("#health-story-state");
  const advance = seconds => page.clock.runFor(seconds * 1000);
  await advance(30);
  await expect(show).toHaveText("Mara · Baseline within personal range");
  await show.click();
  await expect(story).toBeVisible();
  await expect(state).toHaveText("Baseline within personal range");
  await expect(story.getByRole("list",{name:"Health indicators"}).getByRole("listitem")).toHaveCount(7);
  await expect(story).toContainText("76 bpm");
  const gravity = story.locator("#health-story-gravity");
  await gravity.locator("summary").click();
  await expect(gravity).toContainText("Preflight");
  await expect(gravity).toContainText("Upright while standing");
  await gravity.locator("summary").click();
  await expect(story).toContainText("Blood pressure · Unobserved");
  await expect(story.getByRole("button",{name:/chest-pain/})).toBeHidden();

  await advance(49);
  await expect(show).toHaveText("Mara · More evidence needed");
  await show.click();
  await expect(state).toHaveText("More evidence needed");
  await expect(story).toContainText("88 bpm");
  await gravity.locator("summary").click();
  await expect(gravity).toContainText("Orbital microgravity");
  await expect(gravity).toContainText("Floating with handholds");
  await gravity.locator("summary").click();
  await expect(story.locator("#health-story-trend")).toContainText("comparable valid samples");

  // The cabin, scrubber and EVA beats keep their own timing. A later Flight
  // coast takes the health-story clock through the third scripted reading.
  for (let i=0;i<7 && (await show.textContent()) !== "Mara · Review resting heart rate";i++) await advance(10);
  await expect(show).toHaveText("Mara · Review resting heart rate");
  await show.click();
  await expect(state).toHaveText("Review resting heart rate");
  await expect(story.locator("#health-story-reason")).toContainText("95 bpm is above the personal range 57–87 bpm");
  await expect(story.locator("#health-story-trend")).toContainText("rising from 76 to 95 bpm");

  await page.getByRole("button",{name:"Pause demo"}).dispatchEvent("click");
  await story.getByRole("button",{name:"Raise chest-pain training alert"}).click();
  await expect(state).toHaveText("Chest-pain training drill");
  await expect(story).toContainText("Local alert raised");
  await expect(story).toContainText("Case status stays onboard");
  await story.getByRole("button",{name:"Acknowledge local response"}).click();
  await story.getByRole("button",{name:"Share case status with Ground"}).click();
  await expect(story).toContainText("Ground delivery at T+11:00");
  await expect(story).toContainText("05:00 remaining");

  const tokens = await (await request.post(backend.origin + "/api/v1/demo/session")).json();
  const run = backend.origin + "/api/v1/runs/" + started.run_id;
  const asGround = {headers:{Authorization:"Bearer " + tokens.ground}};
  const groundBefore = await request.get(run + "/ground",asGround);
  expect((await groundBefore.json()).health_cases).toEqual([]);
  expect((await request.get(run + "/crew/health-twin?crew_id=SIM-01",asGround)).status()).toBe(403);

  await story.getByRole("button",{name:"Advance story to relay delivery"}).click();
  await expect(story).toContainText("Case status delivered to Ground at T+11:00");
  const groundAfter = await request.get(run + "/ground",asGround);
  const delivered = (await groundAfter.json()).health_cases;
  expect(delivered).toHaveLength(1);
  expect(Object.keys(delivered[0]).sort()).toEqual([
    "case_alias","delivered_at_s","ground_ack","ground_acknowledged_at_s","review_priority","status",
  ]);
  await page.locator('[data-map-view="ground"]').dispatchEvent("click");
  const groundPanel = page.locator("#map-ground");
  await expect(groundPanel).toBeVisible();
  await expect(groundPanel.locator("#ground-health-story")).toHaveText("Training case · urgent · acknowledged · received T+11:00");
  for (const marker of ["Mara","SIM-01","heart_rate","95 bpm","chest-pain","health_assessment","ground_delivery"]) {
    expect(await groundAfter.text()).not.toContain(marker);
    expect(await groundPanel.textContent()).not.toContain(marker);
  }

  await page.getByRole("button",{name:"Resume demo"}).dispatchEvent("click");
  for (let i=0;i<10 && !await page.locator("#return-scene[data-phase=recovered]").isVisible();i++) {
    await advance(12);
  }
  await expect(page.locator("#return-scene")).toHaveAttribute("data-phase","recovered");
  const asCrew = {headers:{Authorization:"Bearer " + tokens.crew}};
  await expect.poll(async () => {
    const response = await request.get(run + "/crew/health-twin?crew_id=SIM-01",asCrew);
    return (await response.json()).gravity_context?.current.phase;
  }).toBe("recovery");

  await page.getByRole("button",{name:"Exit demo"}).dispatchEvent("click");
  await expect(show).toBeHidden();
  expect(errors).toEqual([]);
});

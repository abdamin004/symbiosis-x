import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const root = fileURLToPath(new URL("../../", import.meta.url));
let outputDirectory;
let flightHtml;

test.beforeAll(() => {
  outputDirectory = mkdtempSync(join(tmpdir(), "flight-timed-demo-"));
  const output = join(outputDirectory, "flight.html");
  execFileSync(process.env.SX_TEST_PYTHON || "python3", ["scripts/build_flight_canvas.py", output], {
    cwd: root,
    stdio: "inherit",
  });
  flightHtml = readFileSync(output, "utf8");
});

test.afterAll(() => {
  if (outputDirectory) rmSync(outputDirectory, { recursive: true, force: true });
});

test("the health demo shows the cabin response, private check and scheduled EVA without touching player saves", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({width:1200,height:674});
  const errors = [];
  const apiRequests = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.clock.install({time:new Date("2026-01-01T00:00:00Z")});
  await page.clock.pauseAt(new Date("2026-01-01T00:00:10Z"));
  await page.route(url => url.pathname === "/flight", route =>
    route.fulfill({contentType:"text/html",body:flightHtml}));
  await page.route("**/api/**", route => {
    apiRequests.push(route.request().url());
    return route.abort();
  });

  const saves = {
    "sx:launch-checkout:v1": JSON.stringify({time:15,jobs:{},hold:true}),
    "sx:flight-procedures:v1": JSON.stringify({configurations:{},tasks:[],nextCase:17}),
  };
  await page.addInitScript(slots => {
    for (const [key,value] of Object.entries(slots)) localStorage.setItem(key,value);
    window.demoStorageWrites = [];
    for (const method of ["setItem","removeItem","clear"]) {
      const write = Storage.prototype[method];
      Storage.prototype[method] = function (...args) {
        if (this === localStorage) window.demoStorageWrites.push([method,...args]);
        return write.apply(this,args);
      };
    }
  },saves);
  await page.goto("/flight?run_id=existing-private-run");

  const beat = page.locator("#demo-status");
  const clock = page.locator("#demo-time");
  const phase = page.locator("#guide-phase");
  const cabin = page.locator("#demo-evidence");
  const twin = page.locator("#personnel-widget");
  const advance = seconds => page.clock.runFor(seconds * 1000);
  const begin = () => page.getByRole("button",{name:"Run astronaut health demo"}).dispatchEvent("click");
  await expect(page.locator("#campaign-save")).toHaveText("Launch held · T+0:15");
  await begin();
  await expect(beat).toHaveText("Astronaut health · systems and crew checkout");
  await advance(10);
  await expect(phase).toHaveText("Booster ascent");
  await advance(11);
  await expect(phase).toHaveText("Orbital insertion burn");
  await page.getByRole("button",{name:"Pause demo"}).dispatchEvent("click");
  const pausedAt = await clock.textContent();
  await advance(12);
  await expect(clock).toHaveText(pausedAt);
  await expect(phase).toHaveText("Orbital insertion burn");
  await page.getByRole("button",{name:"Resume demo"}).dispatchEvent("click");
  await advance(9.1);
  await expect(clock).toHaveText("0:30 / 3:43");
  await expect(phase).toHaveText("Parking orbit · waiting for ISS window");
  await expect(beat).toHaveText("Stable orbit · cabin and Crew baseline");
  const sana = page.locator("#crew-strip").getByRole("button",{name:/Inspect Sana Kepler/});
  await expect(sana).toHaveAttribute("data-mood","Settled");
  await expect(cabin).toHaveText(/2000.00 ppm.*T\+02:15.*20 m³\/h.*cabin-1/);
  await expect(twin).toBeVisible();
  await expect(twin.locator("#personnel-name")).toHaveText("Sana Kepler");
  await expect(twin.locator("#region-source")).toHaveText("Synthetic demo · optical wristband");
  const audioToggle = page.locator("#flight-audio");
  await expect(audioToggle).toBeVisible();
  await audioToggle.dispatchEvent("click");
  await expect(audioToggle).toHaveAttribute("aria-pressed","false");
  await expect(page.locator("#pad-audio")).toHaveAttribute("aria-pressed","false");
  await expect(twin.locator("#region-reading")).toHaveText(/68 bpm.*observed T\+02:10.*received T\+02:15.*accepted/);
  const [twinBounds, shipBounds, guideBounds, readingBounds] = await Promise.all([
    twin.boundingBox(), page.locator("#ship").boundingBox(), page.locator("#mission-guide").boundingBox(),
    twin.locator("#region-reading").boundingBox(),
  ]);
  expect(twinBounds.x+twinBounds.width).toBeLessThan(shipBounds.x);
  expect(shipBounds.x+shipBounds.width).toBeLessThan(guideBounds.x);
  expect(readingBounds.y+readingBounds.height).toBeLessThan(twinBounds.y+twinBounds.height);
  await expect(twin.getByRole("link",{name:"Open private health record"})).toBeHidden();
  await advance(2.5);
  await expect(page.locator("#map-deck")).toBeVisible();
  await advance(2);
  await expect(beat).toHaveText("Suspected CO₂ exposure · check on Sana");
  await expect(twin.locator("#crew-exposure")).toBeVisible();
  await expect(page.locator("#demo-scenario")).toContainText("01 / 03");
  await expect(sana).toHaveAttribute("data-mood","Strained");
  await expect(sana).toHaveAttribute("title",/Cabin air alert/);
  await expect(cabin).toHaveText(/2001.33 ppm.*T\+02:30.*4 m³\/h/);
  const ground = page.getByRole("region",{name:"Ground relay"});
  async function showGround() {
    const parked = page.getByRole("button",{name:"Mission overview",exact:true});
    if (await parked.isVisible()) await parked.dispatchEvent("click");
    await page.locator('[data-map-view="ground"]').dispatchEvent("click");
    await expect(ground).toBeVisible();
  }
  await showGround();
  const groundField = name => ground.locator('[data-ground="'+name+'"]');
  await expect(groundField("source")).toHaveText(/Offline playback/);
  await expect(groundField("case")).toHaveText("Nominal cabin");
  await expect(groundField("co2")).toHaveText("2000.00 ppm");
  await expect(groundField("clock")).toHaveText("T+02:30");
  await expect(twin.locator("#region-reading")).toHaveText(/68 bpm.*held.*motion artifact/);
  await expect(twin.locator("#region-detail")).toContainText("Suspect sample received T+02:30");
  await advance(2);
  await expect(beat).toHaveText("Private Crew check · Noor checks on Sana");
  await expect(twin.locator("#peer-check-status")).toContainText("Noor is heading");
  await advance(2.5);
  await expect(beat).toHaveText("Ivo inspects the scrubber · operational alert in transit");
  await expect(page.locator("#routine-state")).toContainText("Travelling");
  const missionClock = page.locator("#hud-clock");
  await expect(missionClock).toHaveText("T+02:45");
  await page.getByRole("button",{name:"Pause demo"}).dispatchEvent("click");
  const pausedCabin = await cabin.textContent();
  await advance(7);
  await expect(missionClock).toHaveText("T+02:45");
  await expect(cabin).toHaveText(pausedCabin);
  await expect(page.locator("#routine-state")).toContainText("Travelling");
  await page.getByRole("button",{name:"Resume demo"}).dispatchEvent("click");

  // The real simulation advances on its own. No cue is scheduled between 41 and 43.
  await advance(3.7);
  await expect(missionClock).toHaveText("T+03:00");
  await expect(page.locator("#routine-state")).toContainText("Inspecting");
  await expect(twin.locator("#peer-check-status")).toContainText("Noor recorded a visual check");
  await expect(beat).toHaveText("Ivo inspects the scrubber · operational alert in transit");
  await advance(0.7);
  await expect(beat).toHaveText("Private Crew check · observation recorded");

  await advance(5.1);
  await expect(beat).toHaveText("Ground receives scrubber status · Crew accepts repeat wristband sample");
  await expect(twin.locator("#region-reading")).toHaveText(/70 bpm.*accepted/);
  await showGround();
  await expect(groundField("case")).toHaveText("Primary scrubber degraded · Crew responding");
  await expect(groundField("co2")).toHaveText("2001.33 ppm");
  await expect(groundField("observed")).toHaveText("T+02:30");
  await expect(groundField("received")).toHaveText("T+03:15");
  await expect(groundField("age")).toHaveText("00:45");
  await expect(ground).not.toContainText(/Sana|Noor|bpm|visual check/);
  await advance(6);
  await expect(beat).toHaveText("Scrubber repair · Ivo restores airflow");
  await expect(page.locator("#demo-scenario")).toContainText("02 / 03");
  await expect(twin.locator("#crew-exposure")).toBeHidden();
  await expect(sana).toHaveAttribute("data-mood","Settled");
  await expect(cabin).toHaveText(/2006.66 ppm.*T\+03:30.*20 m³\/h/);
  await expect(page.locator("#routine-state")).toContainText("Complete");
  await advance(11);
  await expect(beat).toHaveText("Crew confirms CO₂ is falling · recovery report in transit");
  await advance(8);
  await expect(page.locator("#map-ground")).toBeVisible();
  await expect(page.locator("#workflow-widget")).toBeVisible();
  await expect(groundField("case")).toHaveText("Primary scrubber degraded · Crew responding");
  await advance(9);
  await expect(beat).toHaveText("Ground receives the cabin recovery report");
  await expect(groundField("case")).toHaveText("Scrubber flow restored · CO₂ decline confirmed onboard");
  await expect(groundField("co2")).toHaveText("2006.65 ppm");
  await expect(groundField("received")).toHaveText("T+04:45");
  await expect(ground).not.toContainText(/Ivo|oxygen|battery|tether/);
  await advance(14);
  await expect(beat).toHaveText("Spacewalk · Ivo exits to service the antenna");
  await expect(page.locator("#demo-scenario")).toContainText("03 / 03");
  await expect(twin.locator("#personnel-name")).toHaveText("Ivo Reyes");
  await expect(twin.locator("#region-source")).toHaveText("Simulated suit telemetry");
  await expect(twin.locator("#region-detail")).toContainText("O₂ reserve 84% · battery 92%");
  await expect(twin.locator("#region-detail")).toContainText("tether secured");
  const beforeEvaTick = await missionClock.textContent();
  await advance(5);
  await expect(missionClock).not.toHaveText(beforeEvaTick);
  await expect(beat).toHaveText("Spacewalk · Ivo exits to service the antenna");
  await expect(page.locator('.pawn[data-exterior="true"]')).toBeVisible();
  await expect(page.locator("#eva-tether")).toBeVisible();
  await advance(11);
  await expect(beat).toHaveText("Mara verifies Ivo’s safe return");
  await expect(twin).toBeHidden();
  await advance(3);
  await expect(page.locator("#process-dialog")).toBeVisible();
  await advance(8);
  await expect(page.locator("#orbital-burn-scene")).toBeVisible();
  await advance(24);
  const exterior = page.getByRole("img",{name:"Exterior view of the ship and the International Space Station"});
  await expect(beat).toHaveText("ISS approach · closing range");
  await expect(exterior).toBeVisible();
  await advance(14);
  await expect(phase).toHaveText("Capture corridor clear");
  const captureWindow = await missionClock.textContent();
  await advance(3);
  await expect(missionClock).toHaveText(captureWindow);
  await advance(1);
  await expect(beat).toHaveText("Docking · mechanical capture");
  await expect(page.locator("#docking-caption")).toContainText("secured to ISS");
  await advance(6);
  await expect(beat).toHaveText("Docking · verify seal and pressure");
  await advance(13);
  await expect(beat).toHaveText("Sana collects paired research samples");
  await expect(page.locator("#crew-strip button").filter({hasText:"Sana"}))
    .toHaveAccessibleName(/Collect paired motion samples/);
  await advance(36.2);
  await expect(beat).toHaveText("Capsule landed");
  await expect(page.getByRole("figure",{name:"Command pod Earth return"})).toHaveAttribute("data-phase","splashdown");
  await expect(page.locator("#return-caption")).toContainText("4 crew aboard");
  await expect(page.locator("#return-sea-backdrop")).toBeInViewport({ratio:1});
  await expect(page.locator("#guide-next")).toHaveText("Confirm crew recovery");
  await advance(4);
  await expect(clock).toHaveText("3:43 / 3:43");
  await expect(beat).toHaveText("Crew recovered on Earth");
  await expect(page.locator("#return-scene")).toHaveAttribute("data-phase","recovered");
  await expect(page.locator("#mission-guide")).toHaveAttribute("data-state","complete");
  await expect(page.locator("#guide-count")).toHaveText("14 / 14 complete");
  await page.getByRole("button",{name:"Exit demo"}).dispatchEvent("click");
  await expect(page.locator("#campaign-save")).toHaveText("Launch held · T+0:15");
  await begin();
  // Wait for the deferred ascent and burn frames before inspecting the restarted twin.
  await advance(31);
  for (let i=0;i<4 && !(await twin.isVisible());i++) await advance(1);
  await expect(beat).toHaveText("Stable orbit · cabin and Crew baseline");
  await expect(twin.locator("#region-reading")).toHaveText(/68 bpm.*accepted/);
  await expect(twin.locator("#peer-check")).toBeHidden();
  await page.getByRole("button",{name:"Exit demo"}).dispatchEvent("click");
  await expect(page.locator("#campaign-save")).toHaveText("Launch held · T+0:15");
  expect(await page.evaluate(()=>({...localStorage}))).toEqual(saves);
  expect(await page.evaluate(()=>window.demoStorageWrites)).toEqual([]);
  expect(apiRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test("the timed beats and shared Crew twin fit on mobile with reduced motion", async ({ page }) => {
  await page.setViewportSize({width:390,height:844});
  await page.emulateMedia({reducedMotion:"reduce"});
  await page.clock.install({time:new Date("2026-01-01T00:00:00Z")});
  await page.clock.pauseAt(new Date("2026-01-01T00:00:10Z"));
  await page.route(url => url.pathname === "/flight", route =>
    route.fulfill({contentType:"text/html",body:flightHtml}));
  await page.goto("/flight");
  await page.getByRole("button",{name:"Run astronaut health demo"}).dispatchEvent("click");

  const guide = page.locator("#mission-guide");
  async function verifyGuideLayout(transport) {
    const bounds = await guide.boundingBox();
    const controls = await page.locator(transport).boundingBox();
    expect(bounds.x+bounds.width).toBeLessThanOrEqual(390);
    expect(bounds.y).toBeGreaterThanOrEqual(controls.y+controls.height);
    const instrument = await page.locator("#flight-instrument").boundingBox();
    if (instrument) expect(bounds.y+bounds.height).toBeLessThan(instrument.y);
  }

  await verifyGuideLayout("#pad-transport");
  await page.clock.runFor(37_000);
  let additional = 0;
  for (; additional<4000 && !(await page.locator("#personnel-widget").isVisible());additional+=1000) {
    await page.clock.runFor(1000);
  }
  await verifyGuideLayout(".flight-controls");
  await expect(page.locator("#personnel-widget")).toBeVisible();
  await expect(page.locator("#region-reading")).toBeInViewport();
  await expect(page.locator("#demo-status")).toBeInViewport();
  await page.clock.runFor(129_000-additional);
  await expect(page.locator("#docking-scene")).toBeInViewport();
  await expect(page.locator("#docking-caption")).toContainText("secured to ISS");
  await page.clock.runFor(58_000);
  await expect(page.locator("#demo-status")).toHaveText("Crew recovered on Earth");
});

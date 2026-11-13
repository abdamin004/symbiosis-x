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

test("the three-minute demo shows Crew evidence and returns without touching player saves", async ({ page }) => {
  test.setTimeout(60_000);
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
  const twin = page.locator("#personnel-widget");
  const advance = seconds => page.clock.runFor(seconds * 1000);
  const begin = () => page.getByRole("button",{name:"Run 3-minute mission demo"}).dispatchEvent("click");
  await expect(page.locator("#campaign-save")).toHaveText("Launch held · T+0:15");
  await begin();
  await expect(beat).toHaveText("Systems and crew checkout");
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
  await expect(clock).toHaveText("0:30 / 3:00");
  await expect(phase).toHaveText("Parking orbit · waiting for ISS window");
  await expect(beat).toHaveText("Stable orbit · Sana’s health baseline");
  await expect(twin).toBeVisible();
  await expect(twin.locator("#personnel-name")).toHaveText("Sana Kepler");
  await expect(twin.locator("#region-source")).toHaveText("Synthetic demo · optical wristband");
  await expect(twin.locator("#region-reading")).toHaveText(/68 bpm.*observed T\+02:10.*received T\+02:15.*accepted/);
  await expect(twin.getByRole("link",{name:"Open private health record"})).toBeHidden();
  await advance(7);
  await expect(beat).toHaveText("Wearable quality · motion artifact");
  await expect(twin.locator("#region-reading")).toHaveText(/68 bpm.*held.*motion artifact/);
  await expect(twin.locator("#region-detail")).toContainText("Suspect sample received T+02:30");
  await advance(8);
  await expect(beat).toHaveText("Crew response · Noor checks on Sana");
  await expect(twin.locator("#peer-check-status")).toContainText("Noor is heading");
  await advance(16);
  await expect(beat).toHaveText("Crew response · observation recorded");
  await expect(twin.locator("#peer-check-status")).toContainText("Noor recorded a visual check");
  await advance(8);
  await expect(beat).toHaveText("Wearable quality · repeat sample accepted");
  await expect(twin.locator("#region-reading")).toHaveText(/70 bpm.*accepted/);
  await advance(12);
  await expect(twin).toBeHidden();
  await expect(page.locator("#orbital-burn-scene")).toBeVisible();
  await advance(24);
  const exterior = page.getByRole("img",{name:"Exterior view of the ship and the International Space Station"});
  await expect(beat).toHaveText("ISS approach · closing range");
  await expect(exterior).toBeVisible();
  await advance(18);
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
  await advance(4);
  await expect(clock).toHaveText("3:00 / 3:00");
  await expect(beat).toHaveText("Crew recovered on Earth");
  await expect(page.locator("#mission-guide")).toHaveAttribute("data-state","complete");
  await expect(page.locator("#guide-count")).toHaveText("14 / 14 complete");
  await page.getByRole("button",{name:"Exit demo"}).dispatchEvent("click");
  await expect(page.locator("#campaign-save")).toHaveText("Launch held · T+0:15");
  await begin();
  await expect(beat).toHaveText("Systems and crew checkout");
  // Drive the second replay through the same visible checkpoints as the first.
  // One large fake-clock jump can starve sequential requestAnimationFrame cues.
  await advance(10);
  await expect(phase).toHaveText("Booster ascent");
  await advance(11);
  await expect(phase).toHaveText("Orbital insertion burn");
  await advance(10);
  await expect(beat).toHaveText("Stable orbit · Sana’s health baseline");
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
  await page.getByRole("button",{name:"Run 3-minute mission demo"}).dispatchEvent("click");

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
  await verifyGuideLayout(".flight-controls");
  await expect(page.locator("#personnel-widget")).toBeVisible();
  await expect(page.locator("#region-reading")).toBeInViewport();
  await expect(page.locator("#demo-status")).toBeInViewport();
  await page.clock.runFor(86_000);
  await expect(page.locator("#docking-scene")).toBeInViewport();
  await expect(page.locator("#docking-caption")).toContainText("secured to ISS");
  await page.clock.runFor(58_000);
  await expect(page.locator("#demo-status")).toHaveText("Crew recovered on Earth");
});

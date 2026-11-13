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
  outputDirectory = mkdtempSync(join(tmpdir(), "asteria-flight-"));
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

test("Asteria hands off to the crew canvas and returns to Earth in one saved mission", async ({ page }) => {
  test.setTimeout(45_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route(url => url.pathname === "/flight", route => route.fulfill({ contentType: "text/html", body: flightHtml }));
  await page.goto("/flight");
  const button = name => page.getByRole("button", { name, exact: true });

  await button("New run").click();
  await expect(page.locator("#launch-status")).toHaveText("Launchpad");

  await button("Briefing").click();
  await expect(page.getByRole("dialog", { name:"ISS Research and Return briefing" })).toBeVisible();
  await button("Close").click();
  for (const crew of ["Sana", "Ivo", "Noor"]) {
    await button("Assign " + crew).click();
    await expect(button("Assigned " + crew)).toHaveAttribute("aria-pressed", "true");
  }
  await expect(button("Arm countdown")).toBeDisabled();
  await button("Start ship systems").click();
  const advance = async count => {
    for (let i = 0; i < count; i++) await button("Advance 15 s").click();
  };
  const liftoff = page.getByRole("button", { name: /^(Commit liftoff|Launch)$/ });
  const transport = page.getByRole("group", { name:"Launch time controls" });
  await transport.getByRole("button", { name:"Cycle launch speed" }).click();
  await transport.getByRole("button", { name:"Cycle launch speed" }).click();
  await transport.getByRole("button", { name:"Play", exact:true }).click();
  await expect(button("Arm countdown")).toBeEnabled({ timeout:6000 });
  await expect(page.locator("#startup-status")).toHaveAttribute("data-online", "true");
  await expect(transport.getByRole("button", { name:"Play", exact:true })).toBeDisabled();
  await button("Arm countdown").click();
  await expect(liftoff).toBeDisabled();
  await advance(1);
  const missionUrl = page.url();
  await liftoff.click();
  await expect(button("Open orbit minimap")).toBeVisible();
  await expect(transport.getByRole("button", { name:"Pause", exact:true })).toBeVisible();
  await transport.getByRole("button", { name:"Pause", exact:true }).click();
  await transport.getByRole("button", { name:"Play", exact:true }).click();
  await expect(button("Separate booster")).toBeVisible();
  await expect(transport.getByRole("button", { name:"Play", exact:true })).toBeDisabled();
  await button("Separate booster").click();
  await expect(button("Commit orbital insertion")).toBeVisible();
  await expect(transport.getByRole("button", { name:"Play", exact:true })).toBeDisabled();
  await button("Commit orbital insertion").click();
  await expect(page.locator("#ship canvas")).toBeVisible();
  await expect(page.locator("#ship .pawn:visible")).toHaveCount(4);
  const flightPlayback = page.getByRole("group", { name:"Flight playback" });
  await expect(flightPlayback.getByRole("button", { name:"Cycle speed" })).toHaveText("4×");
  await expect(flightPlayback.getByRole("button", { name:"Advance one mission tick" })).toBeVisible();
  await button("Orbit map").click();
  const navigation = page.getByRole("dialog", { name:"Orbit map" });
  await expect(navigation).toContainText("175 km");
  await expect(navigation.locator("#navigation-speed")).toHaveText(/km\/s/);
  await button("Rotate +15°").click();
  await expect(navigation.locator("#navigation-attitude")).toContainText("15°");
  await expect(navigation.locator("#navigation-reserve")).toContainText("11 cold-gas pulses");
  await button("Close").click();
  await expect(page).toHaveURL(missionUrl);

  await page.locator("#crew-strip .crew-portrait").first().click();
  const twin = page.locator("#personnel-widget");
  await twin.getByRole("button", { name:"Head on body map" }).click();
  await expect(twin.locator("#crew-camera")).toContainText(/Moving|At station/);
  await expect(page.getByRole("group",{name:"Mission resources"})).toContainText("40 meals");
  await expect(page.locator("#ship .pawn .action-marker meter:visible").first()).toBeVisible();
  await page.getByRole("button", { name:"Orders", exact:true }).click();
  await button("Request crewmate check").click();
  await expect(twin.locator("#peer-check-status")).toContainText("due T+");
  const tick = flightPlayback.getByRole("button", { name:"Advance one mission tick" });
  await tick.click();
  await tick.click();
  await expect(twin.locator("#peer-check-status")).toContainText("recorded a visual check");
  await expect(twin.locator("#region-reading")).toHaveText("Normal · visual check");
  await button("Close orders").click();
  await twin.getByRole("button", { name:"Close Digital twin widget" }).click();

  const command = page.getByRole("region", { name: "Flight command" });
  await command.getByRole("button", { name: "Commit phasing", exact: true }).click();
  await expect(page.locator("#docking-view")).toBeVisible();
  await button("Hold approach").click();
  await expect(page.locator("#docking-caption")).toContainText("Approach held");
  await button("Resume approach").click();
  await expect(button("Capture station")).toBeDisabled();
  await advance(3);
  await button("Capture station").click();
  await expect(page.locator("#docking-caption")).toContainText("Docking contact");
  const authorize = button("Authorize hatch opening");
  await expect(authorize).toBeDisabled();
  await button("Check seal").click();
  await advance(2);
  await button("Compare pressure").click();
  await expect(authorize).toBeDisabled();
  await expect(page.locator("#launch-seal")).toHaveText(/Expired/);
  await button("Check seal").click();
  await authorize.click();

  await button("Hand off research kit").click();
  await button("Assign Sana to station research").click();
  await advance(2);
  await expect(button("Seal hatch and board return capsule")).toBeHidden();
  await button("Verify and archive research").click();
  await expect(page.locator("#station-research-status")).toContainText("Paired sample archived");
  await button("Seal hatch and board return capsule").click();
  await expect(page.locator("#docking-caption")).toContainText("Undocking");
  await button("Commit deorbit").click();
  await advance(4);
  await button("Confirm landing").click();
  await button("Confirm crew recovery").click();

  await page.reload();
  await expect(page.locator("#launch-status")).toHaveText("Crew recovered on Earth");
  await expect(page.locator("#ship canvas")).toBeVisible();
  await expect(page).toHaveURL(missionUrl);
  await button("Open orbit minimap").click();
  await expect(navigation.locator("#navigation-reserve")).toContainText("11 cold-gas pulses");
});

test("ISS replay portraits and pawns open crew anatomy with evidence for the selected region", async ({ page }) => {
  await page.setViewportSize({ width: 620, height: 820 });
  await page.route(url => url.pathname === "/flight", route => route.fulfill({ contentType: "text/html", body: flightHtml }));
  await page.goto("/flight");
  await page.getByRole("button", { name: "Open replay", exact: true }).click();

  await page.locator("#crew-strip .crew-portrait").first().click();
  const twin = page.locator("#personnel-widget");
  await expect(twin).toBeVisible();
  const firstMember = await twin.locator("#personnel-name").innerText();
  await twin.getByRole("tab", { name: "Anatomy", exact: true }).press("ArrowRight");
  await expect(twin.getByRole("tab", { name: "Skeleton" })).toBeFocused();
  await expect(twin.locator("#region-reading")).toHaveText("Unobserved");

  await twin.getByRole("button", { name: "Wristband · left wrist" }).click();
  await expect(twin.locator("#wrist-bpm")).toHaveText(/\d+ bpm/);
  await expect(twin.locator("#region-source")).toHaveText("Simulated optical wristband");
  await expect(twin.locator("#region-reading")).toHaveText(/\d+ bpm/);
  await expect(twin.locator("#region-time")).toHaveText(/Observed T\+/);
  await twin.getByRole("button", { name: "Back pod · upper back" }).click();
  await expect(twin.locator("#region-source")).toHaveText("Simulated back pod");
  await expect(twin.locator("#region-detail")).toContainText("synthetic EMG");
  await twin.getByRole("tab", { name: "Suit", exact: true }).click();
  await expect(twin.locator("[data-anatomy-suit]")).toBeVisible();
  await expect(twin.locator("#region-reading")).toHaveText("Suit status unavailable");
  await expect(twin.locator("#region-time")).toBeEmpty();
  await twin.getByRole("button", { name: "Close Digital twin widget" }).click();

  await page.locator("#ship .pawn").nth(1).click();
  await expect(twin).toBeVisible();
  await expect(twin.locator("#personnel-name")).not.toHaveText(firstMember);
  await expect(twin.getByRole("tab", { name: "Anatomy", exact: true })).toHaveAttribute("aria-selected", "true");
  const resources = page.getByRole("group", {name:"Mission resources"});
  await expect(resources).toContainText("40 meals");
  await page.getByRole("button", {name:"Skip one mission hour"}).click();
  await page.getByRole("button", {name:"Skip one mission hour"}).click();
  await expect(resources).not.toContainText("40 meals");
});

test("Flight resumes independent campaigns and preserves the legacy Asteria save", async ({ page, context }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await context.route(url => url.pathname === "/flight", route => route.fulfill({ contentType: "text/html", body: flightHtml }));
  await page.goto("/flight");
  await page.evaluate(() => localStorage.setItem("sx:launch-checkout:v1",
    JSON.stringify({time:15, jobs:{engine:{due:45}},startupAt:0,hold:true})));
  await page.reload();
  const button = name => page.getByRole("button", { name, exact: true });
  await expect(page.getByRole("heading", { name:"Choose a mission" })).toBeVisible();
  await expect(page.locator("#campaign-save")).toHaveText("Launch held · T+0:15");
  await button("Resume").click();
  await expect(page.locator("#launch-status")).toHaveText("Launch held");
  await expect(button("Assigned Ivo")).toBeDisabled();
  await button("Save and exit").click();

  await page.getByRole("radio", { name:"Orbital Systems Checkout" }).check();
  await expect(page.locator("#campaign-ship")).toContainText("Kestrel");
  await expect(page.locator("#campaign-save")).toHaveText("Available · no saved run");
  await button("Briefing").click();
  await expect(page.getByRole("dialog", { name:"Orbital Systems Checkout briefing" })).toContainText("4–6 minutes");
  await button("Close").click();
  await button("New run").click();
  await expect(page.locator("#launch-mission-name")).toHaveText("Orbital Systems Checkout");
  for (const crew of ["Sana", "Ivo", "Noor"]) await button("Assign " + crew).click();
  await button("Start ship systems").click();
  const step = button("Advance 15 s");
  for (let i = 0; i < 3; i++) await step.click();
  await button("Arm countdown").click();
  await step.click();
  await button("Launch").click();
  await expect(button("Separate booster")).toBeVisible();
  await button("Save and exit").click();

  const reopened = await context.newPage();
  await page.close();
  await reopened.emulateMedia({ reducedMotion: "reduce" });
  await reopened.goto("/flight");
  const reopenedButton = name => reopened.getByRole("button", { name, exact: true });
  await expect(reopened.locator("#campaign-save")).toHaveText("Launch held · T+0:15");
  await reopened.getByRole("radio", { name:"Orbital Systems Checkout" }).check();
  await expect(reopened.locator("#campaign-save")).toHaveText("Booster burnout · T+1:30");
  await reopenedButton("Resume").click();
  await expect(reopened.locator("#pad-clock")).toHaveText("T+1:30");
  await reopenedButton("Separate booster").click();
  await reopenedButton("Commit orbital insertion").click();
  await expect(reopened.locator("#flight-mission-name")).toHaveText("Orbital Systems Checkout");
  await expect(reopenedButton("Commit phasing")).toBeHidden();
  await reopenedButton("Orbit map").click();
  await expect(reopened.locator("#navigation-pe")).toHaveText("160 km");
  await expect(reopened.locator("#navigation-approach")).toHaveText("Orbital checkout");
  await reopenedButton("Close").click();
  await reopenedButton("Assign Ivo to orbital systems check").click();
  const orbitStep = reopenedButton("Advance one mission tick");
  await orbitStep.click();
  await orbitStep.click();
  await expect(reopened.locator("#resource-phase")).toContainText("Orbital systems verified");
  await reopenedButton("Commit deorbit").click();
  for (let i = 0; i < 3; i++) await orbitStep.click();
  await reopenedButton("Confirm landing").click();
  await reopenedButton("Confirm crew recovery").click();
  await reopenedButton("Save and exit").click();
  await reopenedButton("New run").click();
  await reopenedButton("Keep saved run").click();
  await expect(reopened.locator("#campaign-save")).toContainText("Crew recovered on Earth");
  await reopenedButton("New run").click();
  await reopenedButton("Replace saved run").click();
  await expect(reopened.locator("#pad-clock")).toHaveText("T+0:00");
  await reopenedButton("Save and exit").click();
  await reopened.getByRole("radio", { name:"ISS Research and Return" }).check();
  await expect(reopened.locator("#campaign-save")).toHaveText("Launch held · T+0:15");
});

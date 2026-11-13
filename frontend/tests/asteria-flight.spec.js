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

  const start = button("Start mission");
  if (await start.isVisible()) await start.click();
  await expect(page.locator("#launch-status")).toHaveText("Launchpad");

  await button("Briefing").click();
  await expect(page.getByRole("dialog", { name:"Asteria mission briefing" })).toBeVisible();
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
  await transport.getByRole("button", { name:"Pause", exact:true }).click();
  await button("Arm countdown").click();
  await expect(liftoff).toBeDisabled();
  await advance(1);
  const missionUrl = page.url();
  await liftoff.click();
  await expect(transport.getByRole("button", { name:"Pause", exact:true })).toBeVisible();
  await transport.getByRole("button", { name:"Pause", exact:true }).click();
  await transport.getByRole("button", { name:"Play", exact:true }).click();
  await expect(page.locator("#ship canvas")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("#ship .pawn:visible")).toHaveCount(4);
  const flightPlayback = page.getByRole("group", { name:"Flight playback" });
  await expect(flightPlayback.getByRole("button", { name:"Cycle speed" })).toHaveText("4×");
  await expect(flightPlayback.getByRole("button", { name:"Advance one mission tick" })).toBeVisible();
  await button("Orbit map").click();
  await expect(page.getByRole("dialog", { name:"Orbit map" })).toContainText("175 km");
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
  const resume = button("Resume mission");
  if (await resume.isVisible()) await resume.click();
  await expect(page.locator("#launch-status")).toHaveText("Crew recovered on Earth");
  await expect(page.locator("#ship canvas")).toBeVisible();
  await expect(page).toHaveURL(missionUrl);
});

test("ISS replay portraits and pawns open crew anatomy with evidence for the selected region", async ({ page }) => {
  await page.setViewportSize({ width: 620, height: 820 });
  await page.route(url => url.pathname === "/flight", route => route.fulfill({ contentType: "text/html", body: flightHtml }));
  await page.goto("/flight");
  await page.getByRole("button", { name: "ISS research replay", exact: true }).click();

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

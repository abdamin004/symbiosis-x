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

  for (const crew of ["Sana", "Ivo", "Noor"]) await button("Assign " + crew).click();
  const advance = async count => {
    for (let i = 0; i < count; i++) await button("Advance 15 s").click();
  };
  const liftoff = page.getByRole("button", { name: /^(Commit liftoff|Launch)$/ });
  await advance(3);
  await button("Arm countdown").click();
  await expect(liftoff).toBeDisabled();
  await advance(1);
  const missionUrl = page.url();
  await liftoff.click();
  await expect(page.locator("#ship canvas")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("#ship .pawn:visible")).toHaveCount(4);
  await expect(page).toHaveURL(missionUrl);

  const command = page.getByRole("region", { name: "Flight command" });
  await command.getByRole("button", { name: "Commit phasing", exact: true }).click();
  await expect(button("Capture station")).toBeDisabled();
  await advance(3);
  await button("Capture station").click();
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
  await button("Seal hatch and board return capsule").click();
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

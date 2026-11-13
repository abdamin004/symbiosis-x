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
  outputDirectory = mkdtempSync(join(tmpdir(), "launch-checkout-"));
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

test("checkout explains the crew and countdown gates and tracks the attached stages", async ({ page }) => {
  await page.setViewportSize({width:1024,height:600});
  await page.emulateMedia({reducedMotion:"reduce"});
  const start = new Date("2026-01-01T00:00:00Z");
  await page.clock.install({time:start});
  await page.clock.pauseAt(new Date(start.getTime()+10_000));
  await page.route(url => url.pathname === "/flight", route =>
    route.fulfill({contentType:"text/html",body:flightHtml}));
  await page.goto("/flight?view=launch");

  const stack = page.getByRole("list", {name:"Rocket stage stack"});
  const stages = stack.getByRole("listitem");
  await expect(stack).toBeInViewport({ratio:1});
  await expect(stages).toHaveCount(3);
  for (const [index,name] of ["Crew capsule","Orbital stage","Ascent booster"].entries()) {
    await expect(stages.nth(index)).toContainText(name);
    await expect(stages.nth(index)).toContainText("Attached");
    if (index > 0) {
      const previous = await stages.nth(index-1).boundingBox();
      const current = await stages.nth(index).boundingBox();
      expect(current.x).toBe(previous.x);
      expect(current.y).toBeGreaterThanOrEqual(previous.y+previous.height);
    }
  }
  await expect(stack.getByRole("button")).toHaveCount(0);

  const summary = page.locator("#launch-checkout-progress");
  const arm = page.locator("#launch-arm");
  const launch = page.locator("#launch-go");
  const step = page.locator("#launch-step");
  await expect(summary).toBeInViewport();
  await expect(summary).toContainText("0 of 3 checks done · 3 remaining");
  await expect(summary).toContainText("Arm blocked · start ship systems · assign remaining checks");
  await expect(arm).toBeDisabled();
  await expect(launch).toBeDisabled();
  const taskIcons = page.locator("#launch-jobs strong svg");
  for (const [index,icon] of ["users","activity","radio"].entries()) {
    await expect(taskIcons.nth(index)).toBeVisible();
    await expect(taskIcons.nth(index).locator("use")).toHaveAttribute("href","#hud-"+icon);
  }

  await page.locator("#startup").click();
  for (const name of ["Sana","Ivo","Noor"]) {
    await page.getByRole("button", {name:"Assign "+name,exact:true}).click();
  }
  await expect(summary).toContainText("finish ship startup · finish crew checks");
  await page.locator("#launch-hold").click();
  await expect(summary).toContainText("release launch hold");
  await expect(step).toBeDisabled();
  await page.locator("#launch-hold").click();
  await step.click();
  await step.click();
  await expect(summary).toContainText("2 of 3 checks done · 1 remaining");
  await expect(arm).toBeDisabled();
  await step.click();
  await expect(summary).toContainText("3 of 3 checks done · 0 remaining");
  await expect(summary).toContainText("Ready to arm");
  await expect(summary).toBeInViewport();
  await page.locator("#pad-command").evaluate(panel=>panel.scrollTop=panel.scrollHeight);
  await expect(summary).toBeInViewport({ratio:1});
  await arm.click();
  await expect(summary).toContainText(/Launch blocked · \d+ s left in countdown/);
  await expect(launch).toBeDisabled();
  await step.click();
  await expect(summary).toContainText("Ready for liftoff");
  await launch.click();
  await expect(summary).toBeHidden();
  await expect(stages.last()).toContainText("Firing");
  await page.clock.runFor(2800);
  await expect(stages.last()).toContainText("Burnout");
  await page.locator("#launch-separate").click();
  await expect(stages.last()).toContainText("Separated");
  await expect(stages.nth(1)).toContainText("Coasting");

  await page.setViewportSize({width:390,height:844});
  await page.goto("/flight?view=launch&mission=orbital-systems-checkout");
  await expect(summary).toBeInViewport({ratio:1});
  await expect(stages).toHaveCount(2);
  await expect(stages.first()).toContainText("Kestrel crew vehicle");
  await expect(stages.last()).toContainText("Light ascent booster");
});

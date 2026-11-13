import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const root = fileURLToPath(new URL("../../",import.meta.url));
let flightHtml;

test.use({hasTouch:true});

test.beforeAll(()=>{
  const dir = mkdtempSync(join(tmpdir(),"flight-deck-systems-"));
  try {
    const output = join(dir,"flight.html");
    execFileSync(process.env.SX_TEST_PYTHON || "python3",["scripts/build_flight_canvas.py",output],{cwd:root,stdio:"inherit"});
    flightHtml = readFileSync(output,"utf8");
  } finally {
    rmSync(dir,{recursive:true,force:true});
  }
});

test("Deck identifies rooms and current jobs, and Systems reports modeled samples and missing evidence",async ({page})=>{
  const errors = [];
  page.on("pageerror",error=>errors.push(error.message));
  await page.route(url=>url.pathname === "/flight",route=>route.fulfill({contentType:"text/html",body:flightHtml}));
  await page.goto("/flight?view=replay");
  const overview = page.getByRole("region",{name:"Mission Overview"});
  const select = name=>overview.getByRole("button",{name,exact:true});
  const step = select("Next event");
  await select("Deck").focus();
  await page.keyboard.press("Enter");
  const deck = overview.getByRole("region",{name:"Deck and crew jobs"});
  await expect(deck.getByRole("img",{name:"Ship rooms and crew positions"})).toBeVisible();
  await expect(deck.locator("svg text.deck-room-label")).toHaveCount(7);
  const crew = deck.getByRole("list",{name:"Crew positions and jobs"}).getByRole("listitem");
  await expect(crew).toHaveCount(4);
  await expect(crew.nth(2)).toContainText(/Ivo.*Engineering.*Heading to Galley/);
  await expect(crew.nth(2).getByRole("meter",{name:"Ivo job progress"})).toBeVisible();
  await step.click();
  await expect(crew.nth(2)).not.toContainText("Heading to Galley");

  await select("Systems").click();
  const systems = overview.getByRole("region",{name:"Ship systems"});
  const reading = id=>systems.locator('[data-system="'+id+'"]');
  await expect(systems).toContainText("Modeled outbound cabin · Replay sample T+01:00");
  await expect(reading("co2")).toContainText("ppm");
  await expect(reading("co2").locator("svg path")).toHaveAttribute("d",/^M.+ L/);
  await expect(reading("flow")).toContainText(/4 m³\/h.*Degraded.*−16 m³\/h/);
  await expect(reading("power")).toContainText("0.60 kW");

  await step.click();
  await step.click();
  await expect(reading("power")).toContainText(/0.20 kW.*Low headroom/);
  for (let i=0;i<4;i++) await step.click();
  await expect(systems).toContainText("Scripted station environment");
  await expect(reading("power")).toContainText("Unavailable");
  await expect(reading("power").locator("svg")).toBeHidden();

  await page.setViewportSize({width:390,height:660});
  await select("Deck").tap();
  await expect(deck.getByRole("list",{name:"Ship rooms"})).toContainText("Life support");
  await expect(deck).toBeInViewport();
  await expect(crew).toHaveCount(4);
  expect(errors).toEqual([]);
});

test("Systems follows the timed health drill from degraded flow to confirmed decline",async ({page})=>{
  await page.setViewportSize({width:1200,height:674});
  await page.emulateMedia({reducedMotion:"reduce"});
  await page.clock.install({time:new Date("2026-01-01T00:00:00Z")});
  await page.clock.pauseAt(new Date("2026-01-01T00:00:10Z"));
  await page.route(url=>url.pathname === "/flight",route=>route.fulfill({contentType:"text/html",body:flightHtml}));
  await page.goto("/flight");
  await page.getByRole("button",{name:"Run astronaut health demo"}).dispatchEvent("click");
  await page.clock.runFor(42_400);

  const systems = page.getByRole("region",{name:"Ship systems"});
  const reading = id=>systems.locator('[data-system="'+id+'"]');
  await expect(systems).toBeVisible();
  await expect(systems).toContainText(/Synthetic cabin model · cabin-1 · Sample T\+.* · Power from replay/);
  await expect(reading("co2")).toContainText(/Exposure drill active.*\+[\d.]+ ppm/);
  await expect(reading("flow")).toContainText(/4 m³\/h.*Degraded/);

  await page.clock.runFor(23_600);
  await expect(reading("co2")).toContainText(/2006.6\d ppm/);
  await expect(reading("co2").locator("svg path")).toHaveAttribute("d",/^M.+L/);
  await expect(reading("flow")).toContainText(/20 m³\/h.*Nominal/);
});

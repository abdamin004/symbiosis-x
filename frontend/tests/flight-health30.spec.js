import {execFileSync} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {expect, test} from "@playwright/test";

const root = fileURLToPath(new URL("../../", import.meta.url));

test("health30 plays to its end card in exactly 30 seconds of browser time", async ({page}) => {
  const dir = mkdtempSync(join(tmpdir(),"sx-health30-test-"));
  const file = join(dir,"flight.html");
  try {
    execFileSync(process.env.SX_TEST_PYTHON || "python3",["scripts/build_flight_canvas.py",file],{cwd:root});
    const html = readFileSync(file,"utf8");
    const errors = [];
    page.on("pageerror", error=>errors.push(error.message));
    await page.setViewportSize({width:1600,height:900});
    const start = new Date("2026-11-14T08:00:00Z");
    await page.clock.install({time:start});
    await page.clock.pauseAt(new Date(+start + 1000));
    await page.route(url=>url.pathname === "/flight",route=>route.fulfill({contentType:"text/html",body:html}));
    await page.goto("/flight?demo=health30");
    const cut = page.locator("#health30");
    const slots = [[0,"launch"],[3,"astronaut"],[7,"deck"],[11,"fault"],[15,"emergency"],[19,"repair"],[22,"relay"],[26,"eva"],[26.5,"dock"],[27,"research"],[27.5,"land"],[28,"end"]];
    let elapsed = 0;
    for (const [at, beat] of slots) {
      if (at) {
        const until = at * 1000 + 50;
        await page.clock.runFor(until - elapsed);
        elapsed = until;
      }
      await expect(cut).toHaveAttribute("data-beat",beat);
      if (beat === "astronaut") await expect(cut.locator(".health30-readings>div")).toHaveCount(8);
      if (beat === "deck") await expect(cut.locator(".health30-deck>div")).toHaveCount(7);
      if (beat === "relay") await expect(cut.locator(".health30-chips span")).toHaveText(["Heart rate","Wearable samples","Check-in notes","Medical history"]);
    }
    await expect(cut.locator(".health30-end")).toBeVisible();
    await page.clock.runFor(30050 - elapsed);
    await expect(cut).toHaveAttribute("data-complete","true");
    await expect(cut).toHaveAttribute("data-elapsed","30.00");
    expect(errors).toEqual([]);
    await page.goto("/flight?demo=health30&t=20");
    await expect(cut).toHaveAttribute("data-beat","repair");
  } finally {
    rmSync(dir,{recursive:true,force:true});
  }
});

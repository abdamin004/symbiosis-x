import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { startBackend, stopBackend, useBackend } from "./support/backend.js";

const timeTo = (page, time) => page.locator("#timeline").evaluate((input, seconds) => {
  input.value = seconds;
  input.dispatchEvent(new Event("input", {bubbles:true}));
}, time);

test("avatar reflects task state, mood report and worn devices", async ({ page, request }) => {
  test.setTimeout(60_000);
  const backend = await startBackend("flight-crew-status");
  try {
    await useBackend(page, backend.origin);
    const directory = mkdtempSync(join(tmpdir(),"sx-avatar-flight-"));
    try {
      const output = join(directory,"flight.html");
      execFileSync(process.env.SX_TEST_PYTHON || "python3",["scripts/build_flight_canvas.py",output],{
        cwd:fileURLToPath(new URL("../../",import.meta.url)),
      });
      const body = readFileSync(output,"utf8");
      await page.route(url => url.pathname === "/flight",route=>route.fulfill({contentType:"text/html",body}));
    } finally {
      rmSync(directory,{recursive:true,force:true});
    }
    const session = await request.post(backend.origin + "/api/v1/demo/session");
    expect(session.ok()).toBeTruthy();
    const tokens = await session.json();
    const headers = role => ({Authorization:"Bearer " + tokens[role]});
    const start = await request.post(backend.origin + "/api/v1/runs", {
      headers:headers("facilitator"),
      data:{start_id:"avatar-status",scenario_id:"crew-wearables",scenario_version:"1",seed:4242},
    });
    expect(start.ok()).toBeTruthy();
    const {run_id:runId} = await start.json();
    const url = backend.origin + "/api/v1/runs/" + runId;
    async function advance(from, to) {
      for (let step = from; step < to; step++) {
        const response = await request.post(url + "/advance", {
          headers:headers("facilitator"),data:{advance_id:"avatar-step-" + step,expected_step:step},
        });
        expect(response.ok()).toBeTruthy();
      }
    }
    await advance(0, 6);
    const flight = "/flight?view=replay&run_id=" + runId;
    await page.goto(flight);
    const sana = page.getByRole("button", {name:/^Inspect Sana Kepler/});
    const ivo = page.getByRole("button", {name:/^Inspect Ivo Reyes/});
    await sana.dispatchEvent("click");
    await expect(sana).toHaveAccessibleName(/Mood unreported/);
    await expect(ivo).toHaveAccessibleName(/Mood unreported/);

    // An actual authored equipment job goes through the normal assignment control.
    await timeTo(page, 31);
    await page.getByRole("button",{name:"Scrubber rack",exact:true}).dispatchEvent("click");
    await page.locator("#assign-asset").dispatchEvent("click");
    await expect(ivo).toHaveAccessibleName(/Inspect scrubber.*Assigned/);
    await timeTo(page, 45);
    await expect(ivo).toHaveAccessibleName(/Walking to Scrubber rack.*Travelling/i);
    await timeTo(page, 66);
    await expect(ivo).toHaveAccessibleName(/Inspect scrubber.*Working/);
    await ivo.dispatchEvent("click");
    await expect(page.locator("#personnel-duty-progress")).toHaveJSProperty("value", (66-45)/(90-45));
    await timeTo(page, 91);
    await page.getByRole("button",{name:"Scrubber rack",exact:true}).dispatchEvent("click");
    await page.locator("#assign-asset").dispatchEvent("click");
    await timeTo(page, 126);
    await expect(ivo).toHaveAccessibleName(/Inspect scrubber.*Working.*Strained.*Relief requested/);
    await ivo.dispatchEvent("click");
    await page.locator('#personnel-widget [data-personnel-view="needs"]').dispatchEvent("click");
    const needs = page.locator("#needs-widget");
    await expect(needs).toContainText("Assigned duty continues until Commander handoff");
    await needs.getByLabel("Qualified replacement").selectOption("0");
    await needs.getByRole("button",{name:"Commander · Transfer scrubber duty"}).click();
    await expect(ivo).not.toHaveAccessibleName(/Inspect scrubber/);
    const mara = page.getByRole("button",{name:/^Inspect Mara Vale/});
    await expect(mara).toHaveAccessibleName(/Inspect scrubber.*Assigned/);
    await timeTo(page, 151);
    await expect(mara).toHaveAccessibleName(/Inspect scrubber.*Working/);
    await needs.getByRole("button",{name:"Close Needs widget"}).dispatchEvent("click");
    await timeTo(page, 360);
    await expect(ivo).toHaveAccessibleName(/Resting.*Strained.*Relief requested/);
    await expect(sana).toHaveAccessibleName(/Strained.*Relief requested/);
    await timeTo(page, 18045);
    await expect(sana).toHaveAccessibleName(/Relief requested/);
    await timeTo(page, 18060);
    await expect(sana).not.toHaveAccessibleName(/Relief requested/);

    await timeTo(page, 105);
    await sana.dispatchEvent("click");
    const twin = page.locator("#personnel-widget");
    await twin.getByRole("button",{name:"Report mood privately"}).click();
    const dialog = page.getByRole("dialog",{name:"Private mood report"});
    await dialog.getByLabel("Mood score (1–5)").selectOption("4");
    await dialog.getByRole("button",{name:"Save private check-in"}).click();
    await expect(dialog).toBeHidden();
    await expect(sana).toHaveAccessibleName(/Simulated mood: Strained.*Self-report 4\/5 · T\+01:12/);
    await expect(ivo).toHaveAccessibleName(/Mood unreported/);
    await expect(twin.locator("#personnel-private-mood")).toHaveText("Self-report 4/5 · T+01:12 · Crew only");

    // Enter and Space use the same distinct native buttons as mouse selection.
    const wrist = page.getByRole("button",{name:/Open Sana Kepler’s wristband sensors/});
    const pod = page.getByRole("button",{name:/Open Sana Kepler’s back pod sensors/});
    await wrist.focus();
    await expect(wrist).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(twin.getByRole("tab",{name:"Sensors"})).toHaveAttribute("aria-selected","true");
    await expect(twin.locator("#region-source")).toHaveText("sim.crew.wristband");
    await expect(twin.locator("#region-reading")).toContainText("age");
    await pod.focus();
    await expect(pod).toBeFocused();
    await page.keyboard.press("Space");
    await expect(twin.locator("#region-source")).toHaveText("sim.crew.back_pod");
    await expect(twin.locator("#region-reading")).toContainText("0.8 m/s");
    await expect(twin.locator("#region-reading")).toContainText("age");

    await advance(6, 7);
    const recheck = twin.locator("#wearable-recheck");
    await recheck.getByLabel("Crewmate observer").selectOption("SIM-03");
    await recheck.getByRole("button",{name:"Assign wearable recheck"}).click();
    await advance(7, 8);
    await recheck.getByRole("button",{name:"Record simulated repeat"}).click();
    await wrist.focus();
    await page.keyboard.press("Enter");
    await expect(twin.locator("#region-reading")).toContainText("96 bpm");
    await expect(sana).toHaveAccessibleName(/Self-report 4\/5 · T\+01:12/);
    await page.reload();
    await sana.dispatchEvent("click");
    await expect(sana).toHaveAccessibleName(/Self-report 4\/5 · T\+01:12/);
    await expect(ivo).toHaveAccessibleName(/Mood unreported/);

    const ground = await request.get(url + "/ground",{headers:headers("ground")});
    expect(ground.ok()).toBeTruthy();
    expect(await ground.text()).not.toMatch(/SIM-02|mood_score|back_pod|wristband|heart_rate/);
    for (const path of ["/crew/check-ins","/crew/wearables?crew_id=SIM-02"]) {
      expect((await request.get(url + path,{headers:headers("ground")})).status()).toBe(403);
    }

    await page.setViewportSize({width:390,height:844});
    await page.emulateMedia({reducedMotion:"reduce"});
    await expect(sana.locator(".crew-activity")).toBeInViewport();
    await expect(sana.locator(".crew-self-report")).toBeInViewport();
    await expect(sana.locator(".crew-self-report")).toHaveText("Self-report 4/5");
  } finally {
    stopBackend(backend);
  }
});

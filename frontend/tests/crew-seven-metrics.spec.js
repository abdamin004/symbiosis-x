import {expect, test} from "@playwright/test";
import {startBackend, stopBackend, useBackend} from "./support/backend.js";

test("Crew saves and explains all seven metrics on one live run", async ({page, request}) => {
  test.setTimeout(90_000);
  const backend = await startBackend("kan160");
  try {
    await useBackend(page,backend.origin);
    const session = await (await request.post(backend.origin + "/api/v1/demo/session")).json();
    const headers = role => ({Authorization:"Bearer " + session[role]});
    const runs = backend.origin + "/api/v1/runs";
    const initial = await request.post(runs, {headers:headers("facilitator"),data:{
      start_id:"seven-metric-run", scenario_id:"health-story", scenario_version:"1", seed:4242,
    }});
    expect(initial.ok()).toBe(true);
    const {run_id:runId} = await initial.json();
    const run = `${runs}/${runId}`;
    const cases = [
      {metric:"heart_rate", guide:"Heart rate", fill:{value:"76"}, reading:"76 bpm", reference:"Within reference"},
      {metric:"blood_pressure", guide:"Blood pressure", fill:{systolic:"110",diastolic:"72"}, pick:{cuff_method:"automatic_upper_arm_cuff",posture:"seated_rested"}, reading:"110/72 mmHg",reference:"Within reference"},
      {metric:"glucose", guide:"Blood glucose", fill:{value:"90"}, pick:{method:"lab_plasma"}, reading:"90 mg/dL",reference:"Within reference"},
      {metric:"temperature", guide:"Body temperature", fill:{value:"36.8"}, reading:"36.8 °C",reference:"Within reference"},
      {metric:"sleep", guide:"Sleep", fill:{duration_min:"430"}, reading:"430 min",reference:"Context only"},
      {metric:"mood", guide:"Mood self-report", fill:{score:"4"}, reading:"4/5",reference:"Context only"},
      {metric:"symptoms", guide:"Symptoms", fill:{symptoms:"Tiredness",private_text:"Only onboard"}, reading:"Tiredness",reference:"Context only"},
    ];
    // Sana is deliberately selected to verify that saving and returning retains the subject.
    const subject = "SIM-02";
    const crew = `/runs/${runId}/crew?crew_id=${subject}`;
    await page.goto(crew);
    for (const [index, item] of cases.entries()) {
      const target = index + 1;
      const advance = await request.post(run + "/advance", {headers:headers("facilitator"),data:{
        advance_id:"kan160-" + target,expected_step:index,target_mission_s:target,
      }});
      expect(advance.ok()).toBe(true);
      await page.getByRole("link",{name:"Take a measurement"}).click();
      await expect(page.locator("#observed_at_s")).toHaveValue(String(target));
      await page.getByLabel("Indicator").selectOption(item.metric);
      await expect(page.getByRole("heading",{name:item.guide + " guide"})).toBeVisible();
      for (const [id,value] of Object.entries(item.fill)) await page.locator("#" + id).fill(value);
      for (const [id,value] of Object.entries(item.pick ?? {})) await page.locator("#" + id).selectOption(value);
      await page.getByRole("button",{name:"Validate measurement"}).click();
      const saved = page.waitForResponse(response=>response.url().endsWith("/crew/measurements") && response.request().method() === "POST");
      await page.getByRole("button",{name:"Save to private Crew record"}).click();
      const receipt = await (await saved).json();
      expect(receipt).toMatchObject({crew_id:subject,received_at_s:target,measurement:{metric:item.metric,observed_at_s:target,source_id:"synthetic.manual.sim-02"}});
      const persisted = await request.get(run + "/crew/measurements/" + encodeURIComponent(receipt.measurement_id),{headers:headers("crew")});
      expect(await persisted.json()).toEqual(receipt);
      await page.getByRole("link",{name:"See the assessment in Crew Health"}).click();
      await expect(page).toHaveURL(new RegExp("crew\\?crew_id=" + subject + "$"));
      await expect(page.getByTestId("crew-health-reading")).toHaveText(item.reading);
      await expect(page.getByTestId("comparison-reference-status")).toHaveText(item.reference);
      await expect(page.getByTestId("crew-health-assessment")).toContainText("source synthetic.manual.sim-02");
    }
    const ground = await request.get(run + "/ground",{headers:headers("ground")});
    expect(ground.ok()).toBe(true);
    const delivered = await ground.text();
    for (const marker of ["Tiredness","Only onboard","synthetic.manual.sim-02","health_assessment"]) {
      expect(delivered).not.toContain(marker);
    }
  } finally {
    stopBackend(backend);
  }
});

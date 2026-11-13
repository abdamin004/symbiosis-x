import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

test("selected portrait keeps its own reading after reload", async ({ page }) => {
  const output = mkdtempSync(join(tmpdir(),"sx-crew-flight-"));
  let html;
  try {
    const path = join(output,"flight.html");
    execFileSync(process.env.SX_TEST_PYTHON || "python3",["scripts/build_flight_canvas.py",path],{
      cwd:fileURLToPath(new URL("../../",import.meta.url)),
    });
    html = readFileSync(path,"utf8");
  } finally {
    rmSync(output,{recursive:true,force:true});
  }
  await page.route("**/flight?*",route=>route.fulfill({contentType:"text/html",body:html}));
  await page.route("**/api/v1/demo/session",route=>route.fulfill({
    json:{crew:"crew-token",facilitator:"fac-token",ground:"ground-token"},
  }));
  let saved;
  await page.route("**/api/v1/runs/run-flight-crew/**",async route=>{
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/measurements")) {
      saved = route.request().postDataJSON();
      return route.fulfill({status:201,json:{...saved,run_id:"run-flight-crew",received_at_s:60}});
    }
    if (!url.pathname.endsWith("/crew")) return route.fulfill({status:404,json:{detail:"UNAVAILABLE"}});
    const crewId = url.searchParams.get("crew_id");
    const sana = crewId === "SIM-02";
    const profile = {crew_id:crewId,display_name:sana ? "Sana Kepler" : "Ivo Reyes",
      baselines:[{metric:"heart_rate",value:sana ? 68 : 76,unit:"bpm"}],history:{status:"unknown",entries:[]}};
    const assessment = saved && saved.crew_id === crewId ? {
      metric:"heart_rate",observed_at_s:60,rules_version:"1",
      personal:{status:"within_personal_range",reason:"Comparable synthetic baseline"},
      reference:{status:"within_reference",reason:"Comparable synthetic reference"},
      evidence:{...saved.measurement,context:saved.context},
    } : null;
    return route.fulfill({json:{run_id:"run-flight-crew",mission_s:60,status:"open",scenario_id:"nominal",
      scenario_version:"1",health_profile:profile,health_assessment:assessment,trace:[]}});
  });
  await page.goto("/flight?view=replay&run_id=run-flight-crew");
  await page.getByRole("button",{name:/Inspect Sana Kepler/}).click();
  await page.getByRole("link",{name:"Open private health record"}).click();
  await expect(page).toHaveURL(/run-flight-crew\/crew\?crew_id=SIM-02$/);
  await page.getByRole("link",{name:"Take a measurement"}).click();
  await expect(page.locator("#observed_at_s")).toHaveValue("60");
  await page.locator("#value").fill("73");
  await page.getByRole("button",{name:"Validate measurement"}).click();
  await page.getByRole("button",{name:"Save to private Crew record"}).click();
  await expect(page.getByTestId("measurement-saved")).toContainText("SIM-02");
  expect(saved).toMatchObject({crew_id:"SIM-02",measurement:{value:73,observed_at_s:60},context:{activity:"rest"}});
  await page.reload();
  await expect(page.getByText("Sana Kepler",{exact:true})).toBeVisible();
  await page.getByRole("link",{name:"Back to Crew Health"}).click();
  await expect(page.getByTestId("crew-health-reading")).toHaveText("73 bpm");
  await page.goto("/flight?view=replay&run_id=run-flight-crew");
  await page.getByRole("button",{name:/Inspect Ivo Reyes/}).click();
  await page.getByRole("link",{name:"Open private health record"}).click();
  await expect(page).toHaveURL(/run-flight-crew\/crew\?crew_id=SIM-03$/);
  await expect(page.getByText(/Ivo Reyes · SIM-03/)).toBeVisible();
  await expect(page.getByTestId("indicator-heart_rate")).toContainText("Baseline 76 bpm");
  await expect(page.getByTestId("crew-health-assessment")).toHaveCount(0);
});

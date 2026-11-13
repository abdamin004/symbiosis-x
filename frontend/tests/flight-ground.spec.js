import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const root = fileURLToPath(new URL("../../", import.meta.url));
const python = process.env.SX_TEST_PYTHON || "python3";
let directory, flightHtml;

test.beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), "flight-ground-"));
  const output = join(directory, "flight.html");
  execFileSync(python, ["scripts/build_flight_canvas.py", output], {cwd:root, stdio:"inherit"});
  flightHtml = readFileSync(output, "utf8");
});

test.afterAll(() => {
  if (directory) rmSync(directory, {recursive:true, force:true});
});

function groundTab(page) {
  return page.getByRole("region", {name:"Mission overview"}).getByRole("button", {name:"Ground", exact:true});
}

function groundField(panel, name) {
  return panel.locator('[data-ground="' + name + '"]');
}

test("offline ISS replay keeps Ground telemetry delayed and uses the existing inspection save", async ({ page }) => {
  const requests = [];
  await page.route("**/api/**", route => { requests.push(route.request().url()); return route.abort(); });
  await page.route(url => url.pathname === "/flight", route =>
    route.fulfill({contentType:"text/html", body:flightHtml}));
  await page.goto("/flight?view=replay");
  const overview = page.getByRole("region", {name:"Mission overview"});
  const ground = overview.getByRole("region", {name:"Ground relay"});
  await groundTab(page).click();
  await expect(groundField(ground, "link")).toHaveText("Awaiting first delivery");
  await expect(ground.getByRole("button", {name:"Request inspection"})).toBeDisabled();
  await page.locator("#timeline").fill("480");
  await expect(groundField(ground, "clock")).toHaveText("T+08:00");
  await expect(groundField(ground, "received")).toHaveText("T+06:00");
  await ground.getByRole("button", {name:"Request inspection"}).click();
  await expect(groundField(ground, "advice")).toHaveAttribute("data-state", "pending");
  await expect(groundField(ground, "advice")).toContainText("Uplink due 13:00");
  await page.locator("#timeline").fill("780");
  await expect(groundField(ground, "power")).toHaveText("0.60 kW");
  await overview.getByRole("button", {name:"Systems"}).click();
  await expect(overview.locator("#map-power")).toHaveText("0.20 kW");
  await page.getByRole("button", {name:"Orders", exact:true}).click();
  await page.getByRole("button", {name:"Commander · Assign Ivo"}).click();
  await page.locator("#timeline").fill("825");
  await page.getByRole("button", {name:"Ivo · Send inspection report"}).click();
  await groundTab(page).click();
  await page.locator("#timeline").fill("1124");
  await expect(groundField(ground, "advice")).toHaveAttribute("data-state", "pending");
  await page.locator("#timeline").fill("1125");
  await expect(groundField(ground, "advice")).toHaveAttribute("data-state", "received");
  await expect(groundField(ground, "advice")).toContainText("Ground received 18:45");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("sx:iss-research-v1:inspection")).sent)).toBe(480);
  expect(requests).toEqual([]);
});

test("an untethered campaign keeps its clock and shows the relay unavailable", async ({ page }) => {
  const requests = [];
  await page.route("**/api/**", route => { requests.push(route.request().url()); return route.abort(); });
  await page.route(url => url.pathname === "/flight", route =>
    route.fulfill({contentType:"text/html", body:flightHtml}));
  const saved = JSON.stringify({time:135, jobs:{}, ignition:60, separation:105, insertion:135});
  await page.addInitScript(save => localStorage.setItem("sx:launch-checkout:v1", save), saved);
  await page.goto("/flight?view=launch&run_id=unrelated-replay");
  const ground = page.getByRole("region", {name:"Ground relay"});
  await groundTab(page).click();
  await expect(groundField(ground, "clock")).toHaveText("T+02:15");
  await expect(groundField(ground, "link")).toHaveText("Relay unavailable for this run");
  await expect(groundField(ground, "telemetry")).toBeHidden();
  await expect(ground.getByRole("button", {name:"Queue advice"})).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem("sx:launch-checkout:v1"))).toBe(saved);
  expect(requests).toEqual([]);
});

async function startBackend() {
  const port = await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
  const origin = "http://127.0.0.1:" + port;
  const child = spawn(python, ["-m", "uvicorn", "symbiosis_x.main:app", "--host", "127.0.0.1", "--port", String(port),
    "--no-proxy-headers"], {
    cwd:root,
    env:{...process.env, SYMBIOSIS_X_DB_PATH:join(directory, "ground.sqlite3"),
      SYMBIOSIS_X_MISSION_CANVAS:join(directory, "mission.html")},
    stdio:["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk; });
  try {
    await expect.poll(async () => {
      if (child.exitCode !== null) throw new Error("Backend exited: " + stderr);
      return fetch(origin + "/health/ready").then(response => response.ok).catch(() => false);
    }, {timeout:10_000}).toBe(true);
    return {origin, child};
  } catch (error) {
    child.kill();
    throw error;
  }
}

test("Flight shows Ground pending at 13:00 while the same-run Crew receipt is held stale", async ({ page, request }) => {
  const {origin, child} = await startBackend();
  try {
    const tokens = await (await request.post(origin + "/api/v1/demo/session")).json();
    const post = async (path, role, data) => {
      const response = await request.post(origin + "/api/v1/runs" + path, {
        data, headers:{Authorization:"Bearer " + tokens[role]},
      });
      expect(response.ok(), await response.text()).toBe(true);
      return response.json();
    };
    const {run_id:run} = await post("", "facilitator",
      {start_id:"flight-ground", scenario_id:"sx01-golden", scenario_version:"1", seed:4242});
    const step = (second, previous) => post("/" + run + "/advance", "facilitator",
      {advance_id:"flight-ground-" + second, expected_step:previous, target_mission_s:second});
    const privateNote = "KAN148_CREW_PRIVATE synthetic check-in";
    await post("/" + run + "/crew/check-ins", "crew", {
      check_in_id:"kan148-private", crew_id:"SIM-01", note:privateNote, synthetic:true,
    });
    const {step:at480} = await step(480, 0);
    const roleRequests = [];
    page.on("request", req => {
      if (req.url().includes("/api/v1/runs/")) roleRequests.push([new URL(req.url()).pathname, req.headers().authorization]);
    });
    await page.goto(origin + "/flight?view=replay&run_id=" + run);
    const ground = page.getByRole("region", {name:"Ground relay"});
    await groundTab(page).click();
    await expect(groundField(ground, "source")).toHaveText("Run " + run);
    await expect(groundField(ground, "power")).toHaveText("0.60 kW");
    expect(roleRequests.length).toBeGreaterThan(0);
    expect(roleRequests.every(([path, header]) => path === "/api/v1/runs/" + run + "/ground" &&
      header === "Bearer " + tokens.ground)).toBe(true);

    await ground.getByLabel("Candidate").selectOption("hold_course");
    const posted = page.waitForResponse(response => response.url().endsWith("/ground/advisories"));
    await ground.getByRole("button", {name:"Queue advice"}).click();
    const advisory = await (await posted).json();
    expect(advisory.basis_snapshot_id).toBe("ground-v102");
    await expect(groundField(ground, "advice")).toHaveText("Pending confirmation · issued T+08:00 · due onboard T+13:00");

    const {step:at780} = await step(780, at480);
    await expect(groundField(ground, "clock")).toHaveText("T+13:00");
    await expect(groundField(ground, "observed")).toHaveText("T+01:00");
    await expect(groundField(ground, "received")).toHaveText("T+06:00");
    await expect(groundField(ground, "age")).toHaveText("12:00");
    await expect(groundField(ground, "power")).toHaveText("0.60 kW");
    await expect(groundField(ground, "advice")).toHaveAttribute("data-state", "pending");

    await page.getByRole("button", {name:"Orders", exact:true}).click();
    const receipt = page.locator("#flight-crew-receipt");
    await expect(receipt).toHaveText("Stale · held onboard at T+13:00 · Crew clock T+13:00");
    await expect(receipt).toHaveAttribute("data-state", "stale");
    await expect(groundField(ground, "advice")).toHaveAttribute("data-state", "pending");
    expect(roleRequests).toContainEqual(["/api/v1/runs/" + run + "/crew", "Bearer " + tokens.crew]);
    await expect(ground).not.toContainText(/heart rate|blood oxygen|bpm|Sana/i);
    await expect(ground).not.toContainText(privateNote);
    await expect(groundField(ground, "case")).toContainText(/inc-.+ · incident opened · observed T\+01:00/);

    await step(900, at780);
    await expect(groundField(ground, "power")).toHaveText("0.20 kW");
    await expect(groundField(ground, "received")).toHaveText("T+15:00");
    // The v103 packet was observed at 10:00; the 13:00 onboard receipt
    // still has not reached Ground's role-filtered trace.
    await expect(groundField(ground, "advice")).toHaveAttribute("data-state", "pending");
  } finally {
    child.kill();
  }
});

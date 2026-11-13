import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const example = (name) =>
  JSON.parse(readFileSync(new URL(`../../contracts/examples/${name}.json`, import.meta.url)));
const crew = example("crew-v103");
const ground = example("ground-v102");

test("launch links keep the same run ID", async ({ page }) => {
  const runId = crew.run_id;
  expect(ground.run_id).toBe(runId);

  for (const [role, snapshot, title] of [
    ["crew", crew, "Crew console"],
    ["ground", ground, "Ground console"],
  ]) {
    await page.goto("/");
    await expect(page.getByTestId("launcher-run-id")).toHaveText(runId);

    const link = page.getByRole("link", { name: new RegExp(title, "i") });
    await expect(link).toHaveAttribute("href", `/runs/${runId}/${role}`);
    await link.click();

    await expect(page).toHaveURL(new RegExp(`/runs/${runId}/${role}$`));
    const shell = page.getByTestId("console-shell");
    await expect(shell).toHaveAttribute("data-role", role);
    await expect(shell).toHaveAttribute("data-run-id", runId);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page.getByTestId("console-run-id")).toHaveText(runId);
    await expect(page.getByTestId("console-snapshot-id")).toHaveText(snapshot.snapshot_id);
  }

  await expect(page.getByRole("heading", { name: "Delivered snapshot" })).toBeVisible();
  await expect(page.getByText(crew.crew.check_in.text)).toHaveCount(0);
});

test("an unknown run shows the missing fixture state", async ({ page }) => {
  await page.route("**/api/v1/demo/session", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ facilitator: "fac-token", crew: "crew-token", ground: "ground-token" }),
  }));
  await page.route("**/api/v1/runs/run-unknown/ground", (route) => route.fulfill({
    status: 404, contentType: "application/json", body: JSON.stringify({ detail: "RUN_NOT_FOUND" }),
  }));
  await page.goto("/runs/run-unknown/ground");

  await expect(page.getByRole("status")).toHaveText("No fixture is available for run run-unknown.");
  await expect(page.getByTestId("console-shell")).toHaveCount(0);
});

test("service health is separate from simulated relay", async ({ page }) => {
  const readiness = { mode: "down" };
  await page.route("**/health/ready", (route) => {
    if (readiness.mode === "down") return route.abort("connectionrefused");
    if (readiness.mode === "starting") {
      return route.fulfill({
        status: 503,
        json: {
          status: "not_ready",
          reason: "SCHEMA_MISMATCH",
          checks: { store: "ok", schema: "mismatch", manifest: "ok" },
        },
      });
    }
    return route.fulfill({
      status: 200,
      json: { status: "ready", reason: null, checks: { store: "ok", schema: "ok", manifest: "ok" } },
    });
  });

  // A failed probe shows Unreachable on the launcher and console alike.
  await page.goto("/");
  const badge = page.getByTestId("service-status");
  await expect(badge).toHaveAttribute("data-state", "unreachable");
  await expect(badge).toContainText("Unreachable");

  // A readiness failure the service reports is Starting, not Unreachable.
  readiness.mode = "starting";
  await page.reload();
  await expect(badge).toHaveAttribute("data-state", "starting");
  await expect(badge).toContainText("Starting");

  // The Ground relay is simulated as delayed; the service itself stays Ready.
  readiness.mode = "ready";
  await page.goto(`/runs/${ground.run_id}/ground`);
  await expect(badge).toHaveAttribute("data-state", "ready");
  await expect(badge).toContainText("Ready");
  await expect(page.getByTestId("relay-link-status")).toHaveText("Delayed");
  await expect(badge).not.toContainText("Delayed");
});

// SX-08D: one stateful mock of the run API, shared by three separate browser
// sessions. It enforces each role's token the way the backend does, so the test
// checks both the clock each session sees and the access response it gets.
function mockRunApi() {
  const tokens = { facilitator: "fac-token", crew: "crew-token", ground: "ground-token" };
  const roleFor = (request) =>
    Object.keys(tokens).find((role) => request.headers().authorization === "Bearer " + tokens[role]);
  const state = { runs: {}, receipts: {}, calls: [], failNextAdvance: false, nextRun: 1 };

  const json = (route, status, body) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  const receiptFor = (run, extra = {}) => ({
    run_id: run.run_id, scenario_id: run.scenario_id, scenario_version: "1", seed: run.seed,
    mission_s: run.mission_s, step: run.step, ...extra,
  });
  const newRun = (scenarioId, seed) => {
    const run = { run_id: "run-shared-" + state.nextRun++, scenario_id: scenarioId, seed, mission_s: 0, step: 0 };
    state.runs[run.run_id] = run;
    return run;
  };

  async function handle(route) {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/v1/demo/session") return json(route, 200, tokens);
    const role = roleFor(request);
    const body = request.method() === "POST" ? request.postDataJSON() : null;
    state.calls.push({ path, method: request.method(), role, body });

    if (request.method() === "POST") {
      if (role !== "facilitator") return json(route, 403, { detail: "ROLE_FORBIDDEN" });
      if (path === "/api/v1/runs") {
        state.receipts["start:" + body.start_id] ??= receiptFor(newRun(body.scenario_id, body.seed));
        return json(route, 200, state.receipts["start:" + body.start_id]);
      }
      const [, , , , runId, action] = path.split("/");
      const run = state.runs[runId];
      if (!run) return json(route, 404, { detail: "RUN_NOT_FOUND" });
      if (action === "advance") {
        if (state.failNextAdvance) {
          state.failNextAdvance = false;
          return route.abort("connectionreset");
        }
        const key = "advance:" + runId + ":" + body.advance_id;
        if (!state.receipts[key]) {
          if (body.expected_step !== run.step) return json(route, 409, { detail: "STALE_STEP" });
          run.step += 1;
          run.mission_s = 60 * run.step;
          state.receipts[key] = receiptFor(run, { advance_id: body.advance_id });
        }
        return json(route, 200, state.receipts[key]);
      }
      if (action === "reset") {
        const key = "reset:" + runId + ":" + body.reset_id;
        state.receipts[key] ??= receiptFor(newRun(run.scenario_id, run.seed),
          { reset_id: body.reset_id, reset_from_run_id: runId });
        return json(route, 200, state.receipts[key]);
      }
    }

    const match = path.match(/^\/api\/v1\/runs\/([^/]+)\/(crew|ground)$/);
    if (match) {
      const [, runId, view] = match;
      if (role !== view) return json(route, 403, { detail: "ROLE_FORBIDDEN" });
      const run = state.runs[runId];
      if (!run) return json(route, 404, { detail: "RUN_NOT_FOUND" });
      const base = { run_id: run.run_id, scenario_id: run.scenario_id, scenario_version: "1",
        mission_s: run.mission_s, trace: [] };
      return json(route, 200, view === "crew"
        ? { ...base, health_profile: { crew_id: "SIM-01", simulated: true }, health_assessment: null }
        : { ...base, packet: null });
    }
    return json(route, 404, { detail: "NOT_MOCKED" });
  }

  return {
    state,
    async attach(page) {
      await page.route("**/api/v1/**", handle);
      await page.route("**/health/ready", (route) => json(route, 200,
        { status: "ready", reason: null, checks: { store: "ok", schema: "ok", manifest: "ok" } }));
    },
  };
}

/** Try to step the run with this session's own role credential. */
async function tryToStep(page, runId) {
  return page.evaluate(async (id) => {
    const tokens = await (await fetch("/api/v1/demo/session", { method: "POST" })).json();
    const role = location.pathname.endsWith("/ground") ? "ground" : "crew";
    const response = await fetch("/api/v1/runs/" + id + "/advance", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + tokens[role] },
      body: JSON.stringify({ advance_id: "not-allowed", expected_step: 1 }),
    });
    return { status: response.status, body: await response.json() };
  }, runId);
}

test("facilitator starts and steps one shared run", async ({ browser, baseURL }) => {
  const api = mockRunApi();
  const contexts = await Promise.all([0, 1, 2].map(() => browser.newContext({ baseURL })));
  const [facilitator, crew, ground] = await Promise.all(contexts.map((context) => context.newPage()));
  try {
    await Promise.all([facilitator, crew, ground].map((page) => api.attach(page)));

    // Start once; the returned run ID drives both console links.
    await facilitator.goto("/");
    await facilitator.getByRole("button", { name: "Start run" }).click();
    await expect(facilitator.getByTestId("launcher-run-id")).toHaveText("run-shared-1");
    for (const role of ["crew", "ground"]) {
      await expect(facilitator.getByRole("link", { name: new RegExp("Open " + role, "i") }))
        .toHaveAttribute("href", "/runs/run-shared-1/" + role);
    }

    // The first step is lost in transit; the retry reuses the same advance_id.
    api.state.failNextAdvance = true;
    await facilitator.getByRole("button", { name: "Advance one step" }).click();
    await expect(facilitator.getByRole("alert")).toBeVisible();
    await expect(facilitator.getByTestId("launcher-mission-time")).toHaveText("0");
    await facilitator.getByRole("button", { name: "Advance one step" }).click();
    await expect(facilitator.getByTestId("launcher-mission-time")).toHaveText("60");
    const advances = api.state.calls.filter((call) => call.path.endsWith("/advance") && call.role === "facilitator");
    expect(advances).toHaveLength(2);
    expect(advances[1].body.advance_id).toBe(advances[0].body.advance_id);
    expect(api.state.runs["run-shared-1"].step).toBe(1);

    // A reload keeps the facilitator's run.
    await facilitator.reload();
    await expect(facilitator.getByTestId("launcher-run-id")).toHaveText("run-shared-1");
    await expect(facilitator.getByTestId("launcher-mission-time")).toHaveText("60");

    // Crew and Ground, each in its own browser session, load and reload the same run and clock.
    for (const [page, role] of [[crew, "crew"], [ground, "ground"]]) {
      await page.goto("/runs/run-shared-1/" + role);
      await page.reload();
      const shell = page.getByTestId("console-shell");
      await expect(shell).toHaveAttribute("data-role", role);
      await expect(shell).toHaveAttribute("data-run-id", "run-shared-1");
      await expect(page.getByText(/Mission time 01:00/)).toBeVisible();
      await expect(page.getByRole("button", { name: /Advance|Start run|Reset run/ })).toHaveCount(0);

      // Their sessions cannot step it: the API refuses their credential and the clock stays put.
      expect(await tryToStep(page, "run-shared-1")).toEqual({ status: 403, body: { detail: "ROLE_FORBIDDEN" } });
    }
    expect(api.state.runs["run-shared-1"]).toMatchObject({ step: 1, mission_s: 60 });
    const reads = (view) => api.state.calls.filter((call) => call.path.endsWith("/" + view));
    expect(reads("crew").length).toBeGreaterThan(0);
    expect(reads("crew").every((call) => call.role === "crew")).toBe(true);
    expect(reads("ground").every((call) => call.role === "ground")).toBe(true);

    // Reset gives a new run ID and relinks both screens.
    await facilitator.getByRole("button", { name: "Reset run" }).click();
    await expect(facilitator.getByTestId("launcher-run-id")).toHaveText("run-shared-2");
    await expect(facilitator.getByTestId("launcher-mission-time")).toHaveText("0");
    for (const role of ["crew", "ground"]) {
      await expect(facilitator.getByRole("link", { name: new RegExp("Open " + role, "i") }))
        .toHaveAttribute("href", "/runs/run-shared-2/" + role);
    }
    await crew.goto("/runs/run-shared-2/crew");
    await expect(crew.getByTestId("console-shell")).toHaveAttribute("data-run-id", "run-shared-2");
    await expect(crew.getByText(/Mission time 00:00/)).toBeVisible();
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

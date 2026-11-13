import { expect, test } from "@playwright/test";

const tokens = { facilitator: "fac-token", crew: "crew-token", ground: "ground-token" };

async function mockRoleSession(page, role) {
  await page.route("**/api/v1/demo/session", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify(tokens),
  }));
  await page.route("**/health/ready", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ status: "ready", reason: null, checks: { store: "ok", schema: "ok", manifest: "ok" } }),
  }));
  return role;
}

test("facilitator controls one run while independent Crew and Ground sessions only read it", async ({ browser, baseURL }) => {
  const facilitatorContext = await browser.newContext({ baseURL });
  const crewContext = await browser.newContext({ baseURL });
  const groundContext = await browser.newContext({ baseURL });
  const facilitator = await facilitatorContext.newPage();
  const crew = await crewContext.newPage();
  const ground = await groundContext.newPage();
  let runId;
  let missionSeconds = 0;
  const requests = [];

  try {
    await Promise.all([
      mockRoleSession(facilitator, "facilitator"),
      mockRoleSession(crew, "crew"),
      mockRoleSession(ground, "ground"),
    ]);

    await facilitator.route("**/api/v1/runs", (route) => {
      const request = route.request();
      requests.push({ path: "/runs", authorization: request.headers().authorization, body: request.postDataJSON() });
      runId = "run-independent-01";
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        run_id: runId, scenario_id: "sx01-golden", scenario_version: "1", seed: 4242, mission_s: 0, step: 0,
      }) });
    });
    await facilitator.route("**/api/v1/runs/run-independent-01/advance", (route) => {
      const request = route.request();
      const body = request.postDataJSON();
      requests.push({ path: "/runs/" + runId + "/advance", authorization: request.headers().authorization, body });
      missionSeconds = 60;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        run_id: runId, scenario_id: "sx01-golden", scenario_version: "1", seed: 4242,
        mission_s: missionSeconds, step: 1, advance_id: body.advance_id,
      }) });
    });

    await facilitator.goto("/");
    await facilitator.getByRole("button", { name: "Start run" }).click();
    await expect(facilitator.getByTestId("launcher-run-id")).toHaveText("run-independent-01");
    await facilitator.getByRole("button", { name: "Advance one step" }).click();
    await expect(facilitator.getByTestId("launcher-mission-time")).toHaveText("60");

    const projection = (role) => ({
      run_id: runId, scenario_id: "sx01-golden", scenario_version: "1", mission_s: missionSeconds,
      ...(role === "crew" ? { health_profile: { crew_id: "SIM-01", simulated: true }, health_assessment: null, trace: [] } :
        { packet: { snapshot_id: "ground-v1", co2: { value: 2000, unit: "ppm" }, delivery: {
          observed_at_s: 60, received_at_s: 360, age_s: 720, link_status: "delayed",
        } }, trace: [] }),
    });
    for (const [page, role] of [[crew, "crew"], [ground, "ground"]]) {
      await page.route("**/api/v1/runs/run-independent-01/" + role, (route) => {
        const authorization = route.request().headers().authorization;
        requests.push({ path: "/" + role, authorization });
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(projection(role)) });
      });
    }

    // These are fresh browser contexts: no launcher sessionStorage is shared with either role.
    await crew.goto("/runs/run-independent-01/crew");
    await ground.goto("/runs/run-independent-01/ground");
    await expect(crew.getByTestId("console-shell")).toHaveAttribute("data-run-id", runId);
    await expect(ground.getByTestId("console-shell")).toHaveAttribute("data-run-id", runId);
    await expect(crew.getByText(/Mission time 01:00/)).toBeVisible();
    await expect(ground.getByText(/Mission time 01:00/)).toBeVisible();
    await expect(crew.getByText("SIM-01")).toBeVisible();
    // The advisory form repeats the basis ID, so read it from the delivered snapshot panel.
    await expect(ground.getByTestId("ground-basis-snapshot")).toHaveText("ground-v1");
    await expect(crew.getByRole("button", { name: "Advance one step" })).toHaveCount(0);
    await expect(ground.getByRole("button", { name: "Advance one step" })).toHaveCount(0);

    // A forged command from a Crew credential is rejected by the API boundary.
    await crew.route("**/api/v1/runs/run-independent-01/advance", (route) => {
      requests.push({ path: "/advance-denied", authorization: route.request().headers().authorization });
      return route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ detail: "ROLE_FORBIDDEN" }) });
    });
    const denied = await crew.evaluate(async () => {
      const response = await fetch("/api/v1/runs/run-independent-01/advance", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer crew-token" },
        body: JSON.stringify({ advance_id: "forbidden", expected_step: 1 }),
      });
      return { status: response.status, body: await response.json() };
    });
    expect(denied).toEqual({ status: 403, body: { detail: "ROLE_FORBIDDEN" } });

    expect(requests.find((item) => item.path === "/runs")?.authorization).toBe("Bearer fac-token");
    expect(requests.find((item) => item.path.endsWith("/advance"))?.authorization).toBe("Bearer fac-token");
    expect(requests.find((item) => item.path === "/crew")?.authorization).toBe("Bearer crew-token");
    expect(requests.find((item) => item.path === "/ground")?.authorization).toBe("Bearer ground-token");
    expect(requests.find((item) => item.path === "/advance-denied")?.authorization).toBe("Bearer crew-token");
  } finally {
    await Promise.all([facilitatorContext.close(), crewContext.close(), groundContext.close()]);
  }
});

import { expect, test } from "@playwright/test";

test("live Crew Health shows private profile, comparisons and supporting context", async ({ page }) => {
  await page.route("**/api/v1/demo/session", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ facilitator: "fac", crew: "crew-token", ground: "ground" }),
  }));
  await page.route("**/api/v1/runs/run-live/crew", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({
      run_id: "run-live", scenario_id: "sx01-golden", scenario_version: "1", mission_s: 600,
      decision_rev: 103, co2: { value: 2100, unit: "ppm", observed_at_s: 600, source_id: "synthetic.cabin" },
      health_profile: {
        crew_id: "SIM-01", display_name: "SIM-01 (fictional)", simulated: true,
        baselines: [{ metric: "heart_rate", value: 72, unit: "bpm", context: "rest", source_id: "synthetic.baseline" }],
        history: { status: "unknown", entries: [] },
      },
      health_assessment: {
        metric: "heart_rate", crew_id: "SIM-01", observed_at_s: 540,
        rules_version: "health-reference-rules-v1", synthetic: true, visibility: "onboard_private",
        personal: { status: "outside_personal_range", reason: "95 bpm is above the personal range 57–87 bpm around the 72 bpm resting baseline.", rule_id: "personal-hr-rest-v1" },
        reference: { status: "within_reference", reason: "95 bpm is within the Earth-based reference 60–100 bpm.", earth_based: true, label: "Earth-based adult reference. Not validated for spaceflight.", source: { title: "Pulse", publisher: "MedlinePlus", url: "https://medlineplus.gov/ency/article/003399.htm" } },
        evidence: { source_id: "synthetic.watch.sim-01", observed_at_s: 540, quality: "valid", context: { activity: "rest" }, value: 95, unit: "bpm" },
      },
      trace: [],
    }),
  }));
  await page.goto("/runs/run-live/crew");
  const dashboard = page.getByTestId("crew-health-dashboard");
  await expect(dashboard.getByRole("heading", { name: "Crew Health" })).toBeVisible();
  await expect(dashboard.getByTestId("latest-health-assessment")).toContainText("outside the personal range");
  await expect(dashboard.getByTestId("latest-health-assessment")).toContainText("within the Earth-based reference");
  await expect(dashboard.getByTestId("latest-health-assessment")).toContainText("Earth-based adult reference");
  await expect(dashboard.getByTestId("live-cabin-context")).toContainText("2100 ppm");
  await expect(dashboard.getByTestId("radlab-context")).toBeVisible();
  await expect(page.getByRole("link", { name: "Take a measurement" })).toHaveAttribute("href", "/runs/run-live/crew/measure");
  await expect(page.getByRole("link", { name: "Emergency Assist" })).toHaveAttribute("href", "/runs/run-live/crew/emergency");
  await page.goto("/runs/run-live/ground");
  await expect(page.getByTestId("crew-health-dashboard")).toHaveCount(0);
});

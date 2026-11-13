import healthContext from "@contracts/examples/crew-health-context-v1.json";

export const CREW_HEALTH_FIXTURE = healthContext;

export const CREW_HEALTH_UNKNOWN_FIXTURE = {
  ...healthContext,
  latest_observation: {
    ...healthContext.latest_observation,
    value: null,
    observed_at_s: 840,
    quality: "unavailable",
  },
  baseline_alert: {
    signal: "unknown",
    reason_code: "LATEST_SAMPLE_MISSING",
    reason: "The latest reading at 840 s is missing.",
    quality: "unavailable",
    evidence_count: 0,
    threshold: { value: 92, unit: "bpm" },
  },
};

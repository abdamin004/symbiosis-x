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
  trend: {
    status: "insufficient_history",
    direction: "unknown",
    reason_code: "INSUFFICIENT_COMPARABLE_SAMPLES",
    reason: "Need 3 comparable valid samples within 3600 seconds; found 2.",
    metric: "heart_rate",
    unit: "bpm",
    sample_count: 2,
    minimum_samples: 3,
    window_s: 3600,
  },
};

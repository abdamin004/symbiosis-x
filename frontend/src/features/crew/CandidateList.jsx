import { useCallback, useEffect, useState } from "react";
import { evaluatePlan } from "../../api/client.js";

export const CANDIDATE_LABELS = {
  hold_course: "Hold course",
  start_standby: "Start the standby scrubber",
  reduce_activity: "Reduce crew activity",
};
const RESULT_LABELS = { feasible: "Available", rejected: "Not available", unknown: "Unknown" };
const RESULT_STYLES = {
  feasible: "bg-emerald-50 text-emerald-800",
  rejected: "bg-red-50 text-red-800",
  unknown: "bg-amber-50 text-amber-900",
};
export const REASON_TEXT = {
  CO2_PEAK_LIMIT: "Peak CO₂ would pass the 3,200 ppm demo rule.",
  POWER_LIMIT: "The bus does not have enough power headroom.",
  FEEDER_DISCONNECTED: "The standby feeder is disconnected.",
  ACTIVITY_RESTRICTED: "Crew activity cannot be reduced now.",
  CO2_EVIDENCE_MISSING: "No accepted CO₂ reading is available.",
  HEADROOM_UNKNOWN: "Power headroom has not been measured.",
  FEEDER_UNKNOWN: "Feeder status is unknown.",
  STANDBY_RATE_UNKNOWN: "The standby scrubber rate is unknown.",
  ACTIVITY_PERMISSION_UNKNOWN: "Permission to reduce activity is unknown.",
  ACTIVITY_RATE_UNKNOWN: "The reduced activity rate is unknown.",
  STALE_DECISION_REV: "The approval was based on an older decision revision.",
  ACTION_EXPIRED: "The approval expired before it reached the gate.",
  POLICY_VERSION_MISMATCH: "The plan used a different policy version.",
  BASIS_SNAPSHOT_MISMATCH: "The plan cited a different Crew snapshot.",
};

function kw(value) {
  return value == null ? "unknown" : value.toFixed(2) + " kW";
}

/**
 * SX-09F: read-only candidate checks from the planner. Shows each option's
 * availability, reason and the values it was compared on. Selecting a
 * feasible option only prepares an approval; nothing here changes the plant.
 */
export default function CandidateList({ runId, selected, onSelect, onPlan, refreshKey = 0 }) {
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    return evaluatePlan(runId)
      .then((result) => { setPlan(result); onPlan?.(result); })
      .catch((e) => setError(e.code ?? e.message))
      .finally(() => setLoading(false));
  }, [runId, onPlan]);

  useEffect(() => { load(); }, [load, refreshKey]);

  return (
    <section aria-labelledby="candidates-heading" className="mt-6 rounded-lg border border-slate-200 bg-white p-4" data-testid="candidate-list">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="candidates-heading" className="font-semibold">Response options</h2>
        <button type="button" onClick={load} disabled={loading} className="text-sm font-semibold text-selection underline disabled:opacity-50">
          {loading ? "Checking…" : "Check again"}
        </button>
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-red-800">Could not check the options: {error}</p>}
      {plan && <>
        <p className="mt-1 text-xs text-slate-500" data-testid="candidate-basis">
          {plan.status.replaceAll("_", " ").toLowerCase()} · basis {plan.basis_snapshot_id} (v{plan.decision_rev}) · policy {plan.policy_version} · {plan.horizon_s / 3600} h horizon · advisory only
        </p>
        <ul className="mt-3 grid gap-3">
          {plan.candidates.map((candidate) => {
            const isSelected = selected === candidate.candidate_id;
            return (
              <li key={candidate.candidate_id} data-testid={"candidate-" + candidate.candidate_id}
                className={"rounded-md border p-3 " + (isSelected ? "border-selection" : "border-slate-200")}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-slate-900">{CANDIDATE_LABELS[candidate.candidate_id] ?? candidate.candidate_id}</p>
                  <span className={"rounded px-2 py-0.5 text-xs font-semibold " + RESULT_STYLES[candidate.result]}>{RESULT_LABELS[candidate.result]}</span>
                </div>
                {candidate.reason_code && <p className="mt-1 text-sm text-slate-700">
                  <span className="font-mono text-xs">{candidate.reason_code}</span> · {REASON_TEXT[candidate.reason_code] ?? ""}
                </p>}
                <dl className="mt-1 flex flex-wrap gap-x-5 text-xs text-slate-600">
                  {candidate.peak_co2_ppm != null && <div>
                    <dt className="inline">Peak CO₂ </dt><dd className="inline">{Math.round(candidate.peak_co2_ppm)} ppm (limit 3,200)</dd>
                  </div>}
                  {(candidate.required_kw != null || candidate.available_kw != null) && <div data-testid="candidate-power">
                    <dt className="inline">Power </dt><dd className="inline">{kw(candidate.required_kw)} required · {kw(candidate.available_kw)} available</dd>
                  </div>}
                </dl>
                {candidate.result === "feasible" && onSelect && <button type="button" onClick={() => onSelect(candidate.candidate_id)}
                  className="mt-2 rounded-md border px-3 py-1 text-sm font-semibold" aria-pressed={isSelected}>
                  {isSelected ? "Selected for approval" : "Select for approval"}
                </button>}
              </li>
            );
          })}
        </ul>
      </>}
    </section>
  );
}

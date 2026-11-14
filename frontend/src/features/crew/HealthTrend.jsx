function missionTime(seconds) {
  const minutes = String(Math.floor(seconds / 60)).padStart(2, "0");
  const remainder = String(seconds % 60).padStart(2, "0");
  return `T+${minutes}:${remainder}`;
}

function displayMetric(metric) {
  return (metric ?? "health measurement").replaceAll("_", " ");
}

export default function HealthTrend({ trend }) {
  const sufficient = trend?.status === "review" || trend?.status === "steady";
  const direction = trend?.direction;
  const status = !sufficient
    ? "Insufficient history"
    : trend.status === "steady"
      ? trend.reason_code === "DAILY_CHANGE_BELOW_THRESHOLD" ? "Within demo trend threshold" : "No directional change"
      : `${direction === "rising" ? "Rising" : "Falling"} trend · review with Crew`;

  return (
    <section
      aria-labelledby="health-trend-heading"
      className="mt-4 rounded-md border border-slate-200 bg-white p-3"
      data-testid="health-trend"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="health-trend-heading" className="text-sm font-semibold text-slate-800">
          Health trend · {trend?.metric === "blood_pressure" ? "systolic blood pressure" : displayMetric(trend?.metric)}
        </h3>
        <span className="text-xs font-semibold text-slate-600" data-testid="health-trend-status">
          {status}
        </span>
      </div>

      <p className="mt-1 text-sm text-slate-700" data-testid="health-trend-reason">
        {trend?.reason ?? "Trend status is unknown because no assessment is available."}
      </p>

      {sufficient && Number.isFinite(trend.start_value) && Number.isFinite(trend.end_value) && (
        <svg className="mt-3 h-24 w-full rounded-lg border border-slate-600 bg-slate-900/40" viewBox="0 0 360 88" role="img"
          aria-label={"Endpoint comparison from " + trend.start_value + " to " + trend.end_value + " " + trend.unit}>
          <line x1="24" y1="70" x2="336" y2="70" stroke="#8393b6" opacity=".4" />
          <path d={trend.start_value === trend.end_value ? "M 25 43 L 335 43" :
            trend.end_value > trend.start_value ? "M 25 65 L 335 22" : "M 25 22 L 335 65"}
            stroke="#55d7ff" strokeWidth="4" fill="none" strokeLinecap="round" />
          <circle cx="25" cy={trend.end_value > trend.start_value ? 65 : trend.end_value < trend.start_value ? 22 : 43} r="5" fill="#a78bfa" />
          <circle cx="335" cy={trend.end_value > trend.start_value ? 22 : trend.end_value < trend.start_value ? 65 : 43} r="5" fill="#4adebc" />
        </svg>
      )}
      {sufficient && <p className="mt-1 text-xs text-slate-500">Endpoint visualization only; intermediate samples are not available and have not been invented.</p>}
      {sufficient ? (
        <p className="mt-2 text-xs text-slate-600" data-testid="health-trend-support">
          {trend.sample_count} comparable samples · mission times {missionTime(trend.start_observed_at_s)}
          {" – "}
          {missionTime(trend.end_observed_at_s)} · {trend.start_value} to {trend.end_value} {trend.unit}
        </p>
      ) : (
        <p className="mt-2 text-xs text-slate-600" data-testid="health-trend-support">
          {trend?.sample_count ?? 0} of {trend?.minimum_samples ?? 3} required comparable samples in the window.
        </p>
      )}
      <p className="mt-2 text-xs text-slate-500">
        Synthetic trend for onboard review; it is descriptive and not a diagnosis.
      </p>
    </section>
  );
}

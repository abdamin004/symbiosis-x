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
      ? "No directional change"
      : `${direction === "rising" ? "Rising" : "Falling"} trend · review with Crew`;

  return (
    <section
      aria-labelledby="health-trend-heading"
      className="mt-4 rounded-md border border-slate-200 bg-white p-3"
      data-testid="health-trend"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="health-trend-heading" className="text-sm font-semibold text-slate-800">
          Health trend · {displayMetric(trend?.metric)}
        </h3>
        <span className="text-xs font-semibold text-slate-600" data-testid="health-trend-status">
          {status}
        </span>
      </div>

      <p className="mt-1 text-sm text-slate-700" data-testid="health-trend-reason">
        {trend?.reason ?? "Trend status is unknown because no assessment is available."}
      </p>

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

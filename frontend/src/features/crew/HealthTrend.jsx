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

  const endpoints = sufficient && Number.isFinite(trend?.start_value) && Number.isFinite(trend?.end_value)
    && Number.isFinite(trend?.start_observed_at_s) && Number.isFinite(trend?.end_observed_at_s)
    ? [{t:trend.start_observed_at_s,v:trend.start_value},{t:trend.end_observed_at_s,v:trend.end_value}] : [];
  const low = endpoints.length ? Math.min(...endpoints.map(point => point.v)) : 0;
  const high = endpoints.length ? Math.max(...endpoints.map(point => point.v)) : 1;
  const spread = Math.max(Math.abs(high-low),1);
  const ypos = value => 105 - ((value-low+spread*.2)/(spread*1.4))*76;
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

      {endpoints.length === 2 && <figure className="mt-3 rounded-lg border border-slate-600 bg-slate-900 p-3" data-testid="health-trend-graph">
        <svg viewBox="0 0 360 135" role="img" aria-label={"Trend endpoints: "+trend.start_value+" at "+missionTime(trend.start_observed_at_s)+" and "+trend.end_value+" at "+missionTime(trend.end_observed_at_s)} className="h-36 w-full">
          <path d="M32 20 V108 H340" fill="none" stroke="#657b9e" strokeWidth="1.5"/>
          <line x1="42" y1={ypos(endpoints[0].v)} x2="328" y2={ypos(endpoints[1].v)} stroke={trend.status==="review"?"#ffc977":"#4ce7bd"} strokeWidth="3"/>
          {endpoints.map((point,index)=><circle key={index} cx={index===0?42:328} cy={ypos(point.v)} r="5" fill={trend.status==="review"?"#ffc977":"#4ce7bd"}/>)}
          <text x="42" y="125" fill="#d3e7fa" fontSize="11" textAnchor="middle">{missionTime(endpoints[0].t)}</text>
          <text x="328" y="125" fill="#d3e7fa" fontSize="11" textAnchor="middle">{missionTime(endpoints[1].t)}</text>
          <text x="42" y={Math.max(15,ypos(endpoints[0].v)-10)} fill="#f7fbff" fontSize="12">{endpoints[0].v}</text>
          <text x="328" y={Math.max(15,ypos(endpoints[1].v)-10)} fill="#f7fbff" fontSize="12" textAnchor="end">{endpoints[1].v}</text>
        </svg>
        <figcaption className="mt-1 text-xs text-slate-300">Summary endpoints only: no intermediate observations are invented.</figcaption>
      </figure>}
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

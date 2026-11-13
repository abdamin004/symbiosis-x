import HealthTrend from "./HealthTrend.jsx";

function missionTime(seconds) {
  const minutes = String(Math.floor(seconds / 60)).padStart(2, "0");
  const remainder = String(seconds % 60).padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function formatValue(value) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);
}

function ObservationCard({ observation }) {
  const isKnown = observation?.quality === "valid" && Number.isFinite(observation.value);
  return (
    <div className="rounded-md bg-slate-50 p-3" data-testid="health-observation">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Latest resting heart rate</p>
      <p className="mt-1 text-xl font-semibold text-slate-900">
        {isKnown ? `${formatValue(observation.value)} ${observation.unit}` : "Unknown"}
      </p>
      <p className="mt-1 text-xs text-slate-600">
        {isKnown
          ? `Observed at mission time ${missionTime(observation.observed_at_s)} · ${observation.quality} · ${observation.activity}`
          : "No valid measurement is available; the last known value is not presented as current."}
      </p>
    </div>
  );
}

export default function CrewHealthPanel({ health, cabin }) {
  const alert = health?.baseline_alert;
  const observation = health?.latest_observation;
  const signal = alert?.signal ?? "unknown";
  const isAlert = signal === "alert";
  const isKnown = observation?.quality === "valid" && Number.isFinite(observation.value);
  const evidenceQuality = alert?.quality ?? observation?.quality ?? "unavailable";

  return (
    <section
      aria-labelledby="crew-health-heading"
      className="mt-6 rounded-lg border border-slate-200 bg-white p-4"
      data-testid="crew-health-panel"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Private · synthetic health demonstration
          </p>
          <h2 id="crew-health-heading" className="mt-1 text-lg font-semibold text-slate-900">
            Crew health context
          </h2>
          <p className="mt-1 text-sm text-slate-600">{health?.subject?.display_name ?? "Crew member"}</p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-sm font-semibold ${
            isAlert ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-700"
          }`}
          data-testid="health-alert-status"
        >
          {isAlert ? "Review alert" : signal === "within_baseline" ? "Within demo baseline" : "Unknown"}
        </span>
      </header>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <ObservationCard observation={observation} />
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-slate-500">Personal resting baseline</dt>
            <dd className="font-medium text-slate-800">
              {health?.baseline?.value ?? "Unknown"} {health?.baseline?.unit ?? ""}
            </dd>
            <dt className="text-slate-500">Evidence quality</dt>
            <dd className="font-medium text-slate-800" data-testid="health-evidence-quality">
              {evidenceQuality}{alert?.evidence_count ? ` · ${alert.evidence_count} samples` : ""}
            </dd>
          </dl>
        </div>

        <div className="rounded-md border border-slate-200 p-3" aria-labelledby="health-reason-heading">
          <h3 id="health-reason-heading" className="text-sm font-semibold text-slate-800">
            Why this status?
          </h3>
          <p className="mt-1 text-sm text-slate-700" data-testid="health-alert-reason">
            {alert?.reason ?? "No assessment reason is available; status remains unknown."}
          </p>
          <p className="mt-2 text-xs text-slate-500">
            {health?.baseline_alert?.reason_code ?? "NO_ASSESSMENT"}
            {isKnown ? ` · latest sample ${missionTime(observation.observed_at_s)}` : " · current reading unavailable"}
          </p>
        </div>
      </div>

      <section
        className="mt-4 rounded-md border border-sky-200 bg-sky-50 p-3"
        aria-labelledby="cabin-context-heading"
        data-testid="cabin-context"
      >
        <h3 id="cabin-context-heading" className="text-sm font-semibold text-slate-800">
          Separate cabin context
        </h3>
        {cabin && Number.isFinite(cabin.value) ? (
          <p className="mt-1 text-sm text-slate-700">
            CO₂: <strong>{formatValue(cabin.value)} {cabin.unit}</strong>
            {cabin.kind ? ` · ${cabin.kind.replaceAll("_", " ")}` : ""}
            {Number.isFinite(cabin.observed_at_s) ? ` · observed at ${missionTime(cabin.observed_at_s)}` : ""}
          </p>
        ) : (
          <p className="mt-1 text-sm text-slate-600">Cabin CO₂ is unknown; no valid context reading is available.</p>
        )}
        <p className="mt-1 text-xs text-slate-500">
          Environmental context is shown separately and does not establish a cause for the health status.
        </p>
      </section>

      <HealthTrend trend={health?.trend} />

      <p className="mt-3 text-xs text-slate-500">
        Fictional crew data and demo assessment; not a diagnosis or medical advice.
      </p>
    </section>
  );
}

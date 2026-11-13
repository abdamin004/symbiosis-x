import { Link } from "react-router-dom";
import { HEALTH_METRICS } from "../../api/healthCatalog.js";
import RadiationContext from "./RadiationContext.jsx";

function comparisonLabel(comparison) {
  if (!comparison) return "Not assessed";
  return comparison.status.replaceAll("_", " ");
}

export default function CrewHealthDashboard({ runId, view }) {
  const profile = view.health_profile;
  const assessment = view.health_assessment;
  const evidence = assessment?.evidence ?? {};
  const selectedMetric = assessment?.metric;
  const baseline = profile?.baselines?.find((item) => item.metric === selectedMetric);
  const reference = assessment?.reference;
  const personal = assessment?.personal;
  const latestQuality = evidence.quality ?? "unavailable";
  const latestObserved = assessment?.observed_at_s;
  const source = reference?.source;

  return (
    <div className="mt-6 space-y-6" data-testid="crew-health-dashboard">
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Private · synthetic health profile</p>
            <h2 className="mt-1 text-xl font-semibold">Crew Health</h2>
            <p className="mt-1 text-sm text-slate-600">{profile?.display_name ?? profile?.crew_id ?? "Crew member"} · {profile?.simulated ? "Simulated crew" : "Profile status unknown"}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link className="text-sm font-semibold text-selection underline" to={"/runs/" + encodeURIComponent(runId) + "/crew/measure"}>Take a measurement</Link>
            <Link className="text-sm font-semibold text-red-700 underline" to={"/runs/" + encodeURIComponent(runId) + "/crew/emergency"}>Emergency Assist</Link>
          </div>
        </header>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {HEALTH_METRICS.map((metric) => {
            const active = metric.id === selectedMetric;
            return <article key={metric.id} className={"rounded-md border p-3 " + (active ? "border-selection bg-violet-50" : "border-slate-200 bg-slate-50")}>
              <p className="text-xs text-slate-500">{metric.label}</p>
              <p className="mt-1 text-sm font-semibold">{active ? comparisonLabel(personal) : "No saved reading"}</p>
              {active && <p className="mt-1 text-xs text-slate-600">{latestQuality} · {latestObserved}s</p>}
              {!active && <p className="mt-1 text-xs text-slate-500">Awaiting a Crew entry</p>}
            </article>;
          })}
        </div>
        {assessment ? <section className="mt-5 rounded-md border border-slate-200 p-4" data-testid="latest-health-assessment">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">Latest assessment · {HEALTH_METRICS.find((m) => m.id === selectedMetric)?.label ?? selectedMetric}</h3>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold">{latestQuality} evidence</span>
          </div>
          <p className="mt-2 text-sm text-slate-700">{personal?.reason ?? "Personal comparison unavailable."}</p>
          <p className="mt-2 text-sm text-slate-700">{reference?.reason ?? "Sourced reference comparison unavailable."}</p>
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <div><dt className="text-slate-500">Personal baseline</dt><dd className="font-medium">{baseline ? baseline.value + " " + baseline.unit + " · " + baseline.context : "Not available for this metric"}</dd></div>
            <div><dt className="text-slate-500">Sourced comparison</dt><dd className="font-medium">{reference?.label ?? (reference?.earth_based ? "Earth-based reference" : "No applicable reference")}</dd></div>
            <div><dt className="text-slate-500">Source ID</dt><dd className="font-medium break-all">{evidence.source_id ?? "Unknown"}</dd></div>
            <div><dt className="text-slate-500">Rules version</dt><dd className="font-medium">{assessment.rules_version ?? "Unknown"}</dd></div>
          </dl>
          {source?.url && <a className="mt-3 inline-block text-sm text-selection underline" href={source.url} target="_blank" rel="noreferrer">{source.title} — {source.publisher}</a>}
          {reference?.earth_based && <p className="mt-2 text-xs text-amber-800">Earth-based adult reference. Not validated for spaceflight.</p>}
          <p className="mt-2 text-xs text-slate-500">Comparisons are separate explanations, not diagnoses or medical advice. Unsupported or missing context remains unknown.</p>
        </section> : <p className="mt-4 rounded-md bg-slate-50 p-3 text-sm text-slate-600" role="status">No saved health measurement has been assessed yet. Save a synthetic reading to populate the private assessment.</p>}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4" data-testid="live-cabin-context">
        <h2 className="font-semibold">Supporting cabin context</h2>
        {view.co2 ? <p className="mt-2 text-sm text-slate-700">CO₂: <strong>{view.co2.value} {view.co2.unit}</strong> · observed at mission time {view.co2.observed_at_s}s · source {view.co2.source_id}</p> : <p className="mt-2 text-sm text-slate-600">Cabin CO₂ is unknown; no valid observation is available.</p>}
        <p className="mt-1 text-xs text-slate-500">Environmental context is separate and does not establish a cause for a health assessment.</p>
      </section>
      <RadiationContext />
    </div>
  );
}

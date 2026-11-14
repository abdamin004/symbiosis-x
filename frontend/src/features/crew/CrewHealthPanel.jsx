import { Link } from "react-router-dom";
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

const COMPARISON_LABELS = {
  within_personal_range: "Within personal range",
  outside_personal_range: "Outside personal range",
  within_reference: "Within reference",
  outside_reference: "Outside reference",
  unknown: "Unknown",
  baseline_unavailable: "No personal baseline",
  reference_unavailable: "No applicable reference",
  contextual: "Context only",
};

function readingText(evidence) {
  if (evidence?.quality === "unavailable") return "Unavailable";
  if (evidence?.systolic != null) return `${evidence.systolic}/${evidence.diastolic} ${evidence.unit ?? "mmHg"}`;
  if (evidence?.value != null) return `${formatValue(evidence.value)} ${evidence.unit ?? ""}`.trim();
  if (evidence?.duration_min != null) return `${evidence.duration_min} min`;
  if (evidence?.score != null) return `${evidence.score}/5`;
  if (evidence?.symptoms?.length) return evidence.symptoms.join(", ");
  return "Recorded (no numeric value)";
}

function contextText(context = {}) {
  const pairs = Object.entries(context).map(([key, value]) => `${key.replaceAll("_", " ")} ${value}`);
  return pairs.length ? pairs.join(" · ") : "no context recorded";
}

function Comparison({ title, comparison, testId }) {
  const outside = comparison.status.startsWith("outside_");
  const hasRange = comparison.range_low != null && comparison.range_high != null;
  return (
    <div className={`rounded-md border p-3 ${outside ? "border-amber-300 bg-amber-50" : "border-slate-200"}`} data-testid={testId}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      <p className="mt-1 font-semibold text-slate-900" data-testid={testId + "-status"}>{COMPARISON_LABELS[comparison.status] ?? comparison.status}</p>
      <p className="mt-1 text-sm text-slate-700">{comparison.reason}</p>
      {hasRange && <p className="mt-1 text-sm text-slate-600">Range {formatValue(comparison.range_low)}–{formatValue(comparison.range_high)} {comparison.unit}</p>}
      {comparison.label && <p className="mt-1 text-xs font-medium text-amber-800">{comparison.label}</p>}
      {comparison.source?.url && <p className="mt-1 text-xs text-slate-600">
        Source: <a className="underline" href={comparison.source.url} target="_blank" rel="noreferrer">{comparison.source.title}</a> · {comparison.source.publisher}
      </p>}
      <p className="mt-1 font-mono text-xs text-slate-500">{comparison.reason_code}{comparison.rule_id ? ` · ${comparison.rule_id}` : ""}</p>
    </div>
  );
}

const FOLLOWUP = {
  heart_rate:"Repeat the reading after an appropriate rest period; record activity context, and request review if concerns persist.",
  blood_pressure:"Recheck with the assigned device and documented posture; share concerning symptoms with the designated onboard responder.",
  sleep:"Complete the sleep log, review scheduling and fatigue with the crew medical officer.",
  sleep_quality:"Record sleep quality and context; discuss ongoing sleep disruption with the onboard responder.",
  mood:"Use the private check-in and discuss concerns with the designated onboard support role.",
  glucose:"Check the measurement method and meal context; request assessment rather than inferring a diagnosis from one value.",
  temperature:"Repeat a measurement using the appropriate device/site and document symptoms or environmental context.",
  symptoms:"Describe location, onset and severity clearly; use the approved onboard emergency procedure when required.",
};
function HealthNextStep({ assessment, flagged }) {
  const text = FOLLOWUP[assessment.metric] ?? "Review the accepted observation, source quality and personal comparison with the onboard responder.";
  return <aside className={"mt-4 rounded-lg border p-4 " + (flagged ? "border-amber-300 bg-amber-950/20" : "border-slate-500 bg-slate-800/50")}
    data-testid="health-next-step">
    <h3 className="font-bold">What to do next</h3>
    <p className="mt-2 text-sm">{text}</p>
    <p className="mt-2 text-xs">General monitoring guidance only; not a diagnosis or substitute for the mission-approved medical protocol.</p>
    <a className="mt-2 inline-block text-sm font-semibold underline" href="https://www.nasa.gov/hrp/risks/" target="_blank" rel="noreferrer">NASA Human Spaceflight Risks · research context</a>
  </aside>;
}

/**
 * SX-24B: Crew Health as the first thing on the live Crew console. Shows the
 * fictional profile, all seven indicators with any personal baseline, and the
 * latest assessment's personal and sourced comparisons kept apart, with the
 * reading's quality and context. Private to the Crew projection.
 */
export function CrewHealthDashboard({ profile, assessment, metrics, measureHref, emergencyHref }) {
  const baselines = new Map((profile?.baselines ?? []).map((baseline) => [baseline.metric, baseline]));
  const flagged = assessment && [assessment.personal.status, assessment.reference.status].some((s) => s.startsWith("outside_"));
  const selected = metrics.find((metric) => metric.id === assessment?.metric);
  return (
    <section aria-labelledby="crew-health-dashboard-heading" className="mt-6 rounded-lg border border-slate-200 bg-white p-4" data-testid="crew-health-dashboard">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Private · synthetic health demonstration</p>
          <h2 id="crew-health-dashboard-heading" className="mt-1 text-lg font-semibold text-slate-900">Crew Health</h2>
          <p className="mt-1 text-sm text-slate-600" data-testid="crew-health-profile">
            {profile?.display_name ?? "Crew member"} · {profile?.crew_id ?? "Unknown"} · history {profile?.history?.status ?? "unknown"}
          </p>
        </div>
        <span data-testid="crew-health-flag" className={`rounded-full px-3 py-1 text-sm font-semibold ${
          flagged ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-700"}`}>
          {!assessment ? "No reading yet" : flagged ? "Flagged for review"
            : assessment.evidence?.quality === "unavailable" ? "Reading unavailable" : "Not flagged"}
        </span>
      </header>

      <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7" aria-label="Health indicators">
        {metrics.map((metric) => {
          const baseline = baselines.get(metric.id);
          const isSelected = metric.id === assessment?.metric;
          return (
            <li key={metric.id} data-testid={"indicator-" + metric.id} aria-current={isSelected ? "true" : undefined}
              className={`rounded-md border p-3 text-sm ${isSelected ? "border-selection bg-sky-50" : "border-slate-200"}`}>
              <p className="font-medium text-slate-900">{metric.label}</p>
              {isSelected ? <>
                <p className="mt-2 text-xl font-bold text-telemetry" data-testid={"indicator-value-" + metric.id}>{readingText(assessment.evidence)}</p>
                <p className="mt-1 text-xs font-semibold text-amber-700">{flagged ? "● Review" : "● Latest accepted / assessed"}</p>
              </> : <>
                <p className="mt-2 text-xl font-semibold text-slate-900">{baseline
                  ? `${formatValue(baseline.value)}${baseline.diastolic == null ? "" : "/" + formatValue(baseline.diastolic)}`
                  : "—"}</p>
                <p className="mt-1 text-xs text-slate-600">{baseline ? baseline.unit : "Unavailable"} · personal baseline, not live</p>
              </>}
            </li>
          );
        })}
      </ul>
      {profile?.history?.entries?.length > 0 && <details className="mt-3 rounded-md border border-slate-200 p-3 text-sm">
        <summary className="cursor-pointer font-semibold">Fictional medical history</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-700">
          {profile.history.entries.map((entry,index) =>
            <li key={entry.date + entry.category + index}><time dateTime={entry.date}>{entry.date}</time> · {entry.note}</li>)}
        </ul>
      </details>}

      {assessment ? <div className="mt-4" data-testid="crew-health-assessment">
        <p className="text-sm text-slate-800">
          <strong>{selected?.label ?? assessment.metric}</strong>: <span data-testid="crew-health-reading">{readingText(assessment.evidence)}</span>
          <span className="text-slate-600"> · observed {missionTime(assessment.observed_at_s)} · quality <span data-testid="crew-health-quality">{assessment.evidence?.quality ?? "unknown"}</span> · {contextText(assessment.evidence?.context)}{assessment.evidence?.source_id && <> · source {assessment.evidence.source_id}</>}</span>
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <Comparison title="Personal baseline" comparison={assessment.personal} testId="comparison-personal" />
          <Comparison title="Sourced reference" comparison={assessment.reference} testId="comparison-reference" />
        </div>
        <p className="mt-2 text-xs text-slate-500">The two comparisons are evaluated separately and never merged into one verdict. Rules {assessment.rules_version}.</p>
        <HealthNextStep assessment={assessment} flagged={flagged} />
      </div> : <p className="mt-4 text-sm text-slate-600">No reading has been saved in this run. Take a measurement to see an assessment.</p>}

      <div className="mt-4 flex flex-wrap gap-4">
        <Link className="text-sm font-semibold text-selection underline" to={measureHref}>Take a measurement</Link>
        <Link className="text-sm font-semibold text-red-700 underline" to={emergencyHref}>Open Emergency Assist</Link>
      </div>
      <p className="mt-3 text-xs text-slate-500">Fictional crew data and demo assessment; not a diagnosis or medical advice.</p>
    </section>
  );
}

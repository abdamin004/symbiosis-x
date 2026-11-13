import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import storyboard from "../../../../scenarios/expected/sx01-golden-storyboard.json";

const PLAY_MS = 2500;

function formatMissionTime(seconds) {
  const sign = seconds < 0 ? "−" : "";
  const total = Math.abs(seconds);
  const minutes = String(Math.floor(total / 60)).padStart(2, "0");
  return `${sign}${minutes}:${String(total % 60).padStart(2, "0")}`;
}

function quantity(q) {
  if (!q) return "Unknown";
  return `${q.unit === "kW" ? q.value.toFixed(2) : q.value} ${q.unit}`;
}

function Trace({ records, testId }) {
  if (!records.length) return <p className="text-xs text-slate-500">No milestones yet.</p>;
  return (
    <ol className="space-y-1 text-xs text-slate-700" data-testid={testId}>
      {records.map((r, i) => (
        <li key={i}>{formatMissionTime(r.mission_s)} · {r.actor} · {r.step} · {r.result}{r.reason_code ? ` (${r.reason_code})` : ""}</li>
      ))}
    </ol>
  );
}

/**
 * Offline backup: plays the five saved golden frames with no service running.
 * Crew and Ground each show only their own saved projection.
 */
export default function BackupReplay({ frames = storyboard.frames }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const frame = frames[index];
  const last = frames.length - 1;

  useEffect(() => {
    if (!playing) return undefined;
    if (index >= last) { setPlaying(false); return undefined; }
    const timer = setTimeout(() => setIndex((i) => Math.min(i + 1, last)), PLAY_MS);
    return () => clearTimeout(timer);
  }, [playing, index, last]);

  const { crew, ground } = frame;
  return (
    <main className="mx-auto max-w-5xl px-4 py-8" data-testid="backup-replay" data-beat={frame.beat_id}>
      <header className="border-b border-slate-200 pb-4">
        <Link className="text-sm text-slate-500 underline" to="/">SYMBIOSIS X</Link>
        <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-amber-700">Offline backup · saved frames · no live service</p>
        <h1 className="text-2xl font-semibold">Golden replay backup</h1>
        <p className="mt-1 text-sm text-slate-600" data-testid="backup-provenance">
          {storyboard.scenario_id} v{storyboard.scenario_version} · seed {storyboard.seed} · model {storyboard.model_version}
          {" · "}policy {storyboard.policy_version} · synthetic fixture
        </p>
      </header>

      <nav aria-label="Beats" className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setIndex((i) => Math.max(i - 1, 0))} disabled={index === 0}
          className="rounded-md border px-3 py-1.5 text-sm font-semibold disabled:opacity-40">Previous</button>
        <button type="button" onClick={() => { if (index >= last) setIndex(0); setPlaying((p) => !p); }}
          className="rounded-md bg-selection px-3 py-1.5 text-sm font-semibold text-white">{playing ? "Pause" : "Play"}</button>
        <button type="button" onClick={() => setIndex((i) => Math.min(i + 1, last))} disabled={index === last}
          className="rounded-md border px-3 py-1.5 text-sm font-semibold disabled:opacity-40">Next</button>
        <ol className="ml-2 flex flex-wrap gap-1">
          {frames.map((f, i) => (
            <li key={f.beat_id}>
              <button type="button" onClick={() => { setPlaying(false); setIndex(i); }} aria-current={i === index ? "step" : undefined}
                className={`rounded px-2 py-1 text-xs ${i === index ? "bg-slate-900 text-white" : "border text-slate-700"}`}>
                {formatMissionTime(f.mission_s)}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <h2 className="mt-5 text-lg font-semibold">
        Beat {index + 1} of {frames.length}: <span data-testid="backup-beat-label">{frame.label}</span>
        {" · "}<span data-testid="backup-mission-time">{formatMissionTime(frame.mission_s)}</span>
      </h2>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <section aria-labelledby="backup-crew" className="rounded-lg border border-sky-200 bg-white p-4" data-testid="backup-crew">
          <h3 id="backup-crew" className="font-semibold">Crew view (onboard)</h3>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt className="text-slate-500">Decision revision</dt><dd data-testid="backup-crew-revision">v{crew.decision_rev}</dd>
            <dt className="text-slate-500">Cabin CO₂ (modeled)</dt><dd data-testid="backup-crew-co2">{quantity(crew.co2)}</dd>
            <dt className="text-slate-500">Standby power check</dt>
            <dd data-testid="backup-crew-standby">
              {crew.standby.result}{crew.standby.reason_code ? ` · ${crew.standby.reason_code}` : ""}
              {crew.standby.available_kw != null && ` · ${crew.standby.required_kw.toFixed(2)} kW needed, ${crew.standby.available_kw.toFixed(2)} kW available`}
            </dd>
          </dl>
          <h4 className="mt-3 text-xs font-semibold uppercase text-slate-500">Trace</h4>
          <Trace records={crew.trace} testId="backup-crew-trace" />
        </section>

        <section aria-labelledby="backup-ground" className="rounded-lg border border-amber-300 bg-white p-4" data-testid="backup-ground">
          <h3 id="backup-ground" className="font-semibold">Ground view (delivered)</h3>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt className="text-slate-500">Basis</dt><dd data-testid="backup-ground-basis">{ground.snapshot_id} · v{ground.decision_rev}</dd>
            <dt className="text-slate-500">Cabin CO₂</dt><dd>{quantity(ground.co2)}</dd>
            <dt className="text-slate-500">Power headroom</dt><dd data-testid="backup-ground-power">{quantity(ground.power_headroom)}</dd>
            <dt className="text-slate-500">Observed / received</dt>
            <dd>{formatMissionTime(ground.delivery.observed_at_s)} / {formatMissionTime(ground.delivery.received_at_s)}</dd>
            <dt className="text-slate-500">Sample age</dt><dd data-testid="backup-ground-age">{formatMissionTime(ground.delivery.age_s)}</dd>
          </dl>
          <h4 className="mt-3 text-xs font-semibold uppercase text-slate-500">Trace</h4>
          <Trace records={ground.trace} testId="backup-ground-trace" />
        </section>
      </div>

      <p className="mt-4 text-xs text-slate-500">{storyboard.note} Generated by {storyboard.generated_by}.</p>
    </main>
  );
}

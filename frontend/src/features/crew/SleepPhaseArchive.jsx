const PHASES = [
  ["preflight", "Before flight"],
  ["inflight", "During flight"],
  ["postflight", "After flight"],
];

function SleepDuration({minutes, sampleCount}) {
  if (!sampleCount || minutes == null) return <p className="mt-2 text-sm text-slate-500">Duration unobserved</p>;
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  return <p className="mt-2 text-sm text-slate-700">
    Mean duration <strong className="text-lg text-slate-900">{hours} h {rounded % 60} min</strong>
    <span className="block text-xs text-slate-600">{sampleCount} {sampleCount === 1 ? "observation" : "observations"}</span>
  </p>;
}

export default function SleepPhaseArchive({phases}) {
  const byPhase = new Map(phases.map(phase => [phase.phase, phase]));
  return <section className="mt-5 rounded-lg border border-slate-200 bg-white p-4" aria-labelledby="sleep-archive-heading">
    <h2 id="sleep-archive-heading" className="font-semibold">Sleep before, during and after flight</h2>
    <p className="mt-1 text-sm text-slate-600">Synthetic 30-day mission archive · Reported quality on a 1–5 scale</p>
    <div className="mt-3 grid gap-2 sm:grid-cols-3">
      {PHASES.map(([phase, label]) => {
        const summary = byPhase.get(phase);
        const score = summary?.mean_quality_score;
        const count = summary?.quality_samples;
        return <section key={phase} className="rounded-md bg-slate-50 p-3" aria-label={label}>
          <h3 className="font-semibold">{label}</h3>
          <SleepDuration minutes={summary?.mean_duration_min} sampleCount={summary?.duration_samples} />
          {!count || score == null
            ? <p className="mt-2 text-sm text-slate-500">Quality unobserved</p>
            : <p className="mt-2 text-sm text-slate-700">Mean quality <strong>{score.toFixed(1)}/5</strong>
              <span className="block text-xs text-slate-600">{count} {count === 1 ? "report" : "reports"}</span>
            </p>}
        </section>;
      })}
    </div>
  </section>;
}

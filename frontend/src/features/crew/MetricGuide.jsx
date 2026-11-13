export default function MetricGuide({ guide }) {
  if (!guide) return null;
  return (
    <aside className="rounded-lg border border-sky-200 bg-sky-50 p-4" aria-labelledby="metric-guide-title">
      <h2 id="metric-guide-title" className="text-base font-semibold text-slate-900">{guide.title} guide</h2>
      <p className="mt-2 text-sm text-slate-700">{guide.what}</p>
      <p className="mt-2 text-sm text-slate-700"><strong>Why it matters:</strong> {guide.why}</p>
      {guide.assigned_device && <p className="mt-2 text-sm text-slate-700"><strong>Capture:</strong> {guide.assigned_device}</p>}
      <h3 className="mt-3 text-sm font-semibold text-slate-800">How to record</h3>
      <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm text-slate-700">
        {guide.how.map((step) => <li key={step}>{step}</li>)}
      </ol>
      <p className="mt-3 text-sm text-slate-700">{guide.context_note}</p>
      <p className="mt-2 text-xs text-amber-800">{guide.procedure_label}</p>
      <ul className="mt-2 space-y-1 text-xs text-slate-600">
        {guide.sources.map((source) => (
          <li key={source.url}><a className="underline" href={source.url} target="_blank" rel="noreferrer">{source.title} — {source.publisher}</a></li>
        ))}
      </ul>
    </aside>
  );
}

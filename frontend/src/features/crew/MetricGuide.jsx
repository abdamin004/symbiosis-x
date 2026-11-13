
export default function MetricGuide({ guide }) {
  if (!guide) {
    return <p role="status">No guide available for this metric.</p>;
  }

  return (
    <aside
      aria-label={`${guide.title ?? "Measurement"} guide`}
      className="rounded-lg border border-slate-200 bg-slate-50 p-4"
    >
      <h2 className="text-lg font-semibold">
        {guide.title} — Measurement guide
      </h2>

      <p className="mt-2">{guide.what}</p>
      <p className="mt-2 text-sm text-slate-600">{guide.why}</p>

      <h3 className="mt-4 font-medium">How to record</h3>
      <ol className="mt-2 list-decimal pl-5">
        {(guide.how ?? []).map((step, index) => (
          <li key={index} className="mb-2">{step}</li>
        ))}
      </ol>

      {guide.context_note && (
        <p className="mt-3 text-sm">{guide.context_note}</p>
      )}

      {guide.procedure_label && (
        <p className="mt-3 text-xs text-slate-500">
          {guide.procedure_label}
        </p>
      )}
    </aside>
  );
}

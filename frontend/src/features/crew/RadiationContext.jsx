import archiveSeries from "@contracts/examples/radlab-instrument-series.json";

const CHART = { width: 720, height: 220, padX: 44, padY: 28 };

function buildSegments(points) {
  const values = points.filter((point) => point.value !== null).map((point) => point.value);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const span = max - min || Math.max(Math.abs(max) * 0.1, 1);
  const plotWidth = CHART.width - CHART.padX * 2;
  const plotHeight = CHART.height - CHART.padY * 2;
  const coordinates = points.map((point, index) => ({
    x: CHART.padX + (index / Math.max(points.length - 1, 1)) * plotWidth,
    y:
      CHART.height -
      CHART.padY -
      ((point.value ?? min) - min) / span * plotHeight,
    value: point.value,
    timestamp: point.timestamp_utc,
  }));

  const segments = [];
  let segment = [];
  coordinates.forEach((point) => {
    if (point.value === null) {
      if (segment.length) segments.push(segment);
      segment = [];
      return;
    }
    segment.push(point);
  });
  if (segment.length) segments.push(segment);
  return { coordinates, segments, min, max };
}

function formatValue(value) {
  return new Intl.NumberFormat(undefined, { maximumSignificantDigits: 6 }).format(value);
}

function RadiationChart({ series }) {
  const { coordinates, segments, min, max } = buildSegments(series.points);
  const pathFor = (segment) =>
    segment.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");

  return (
    <svg
      className="mt-4 block h-auto w-full"
      viewBox={`0 0 ${CHART.width} ${CHART.height}`}
      role="img"
      aria-label={`${series.instrument_id} ${series.quantity.replaceAll("_", " ")} chart in ${series.unit}`}
      data-testid="radlab-chart"
    >
      <line
        x1={CHART.padX}
        y1={CHART.height - CHART.padY}
        x2={CHART.width - CHART.padX}
        y2={CHART.height - CHART.padY}
        stroke="currentColor"
        opacity="0.25"
      />
      <line
        x1={CHART.padX}
        y1={CHART.padY}
        x2={CHART.padX}
        y2={CHART.height - CHART.padY}
        stroke="currentColor"
        opacity="0.25"
      />
      <text x={CHART.padX} y="17" className="fill-slate-600 text-[12px]">
        {formatValue(min)}–{formatValue(max)} {series.unit}
      </text>
      {segments.map((segment, index) => (
        <path
          key={`segment-${index}`}
          d={pathFor(segment)}
          fill="none"
          stroke="#2563eb"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          data-testid="radlab-segment"
        />
      ))}
      {coordinates.map((point, index) =>
        point.value === null ? (
          <g key={`${point.timestamp}-${index}`} data-testid="radlab-gap">
            <line
              x1={point.x}
              y1={CHART.padY}
              x2={point.x}
              y2={CHART.height - CHART.padY}
              stroke="#d97706"
              strokeDasharray="4 4"
              opacity="0.8"
            />
            <title>No reading at {point.timestamp}; gap retained</title>
          </g>
        ) : (
          <circle
            key={`${point.timestamp}-${index}`}
            cx={point.x}
            cy={point.y}
            r="4"
            fill="#2563eb"
          >
            <title>{point.timestamp}: {formatValue(point.value)} {series.unit}</title>
          </circle>
        ),
      )}
      <text x={CHART.padX} y={CHART.height - 5} className="fill-slate-500 text-[11px]">
        {series.coverage_utc.start}
      </text>
      <text
        x={CHART.width - CHART.padX}
        y={CHART.height - 5}
        textAnchor="end"
        className="fill-slate-500 text-[11px]"
      >
        {series.coverage_utc.end}
      </text>
    </svg>
  );
}

/** Crew-only presentation for archived spacecraft radiation instrument data. */
export default function RadiationContext({ series = archiveSeries }) {
  if (!series || !Array.isArray(series.points) || series.points.length === 0) {
    return (
      <section
        aria-labelledby="radiation-context-title"
        className="rounded-lg border border-slate-200 bg-white p-4"
        data-testid="radlab-context"
      >
        <h2 id="radiation-context-title" className="text-lg font-semibold text-slate-900">
          Archived radiation context
        </h2>
        <p className="mt-2 text-sm text-slate-600" role="status">
          No archive readings are available.
        </p>
      </section>
    );
  }

  const gapCount = series.points.filter((point) => point.value === null).length;
  return (
    <section
      aria-labelledby="radiation-context-title"
      className="rounded-lg border border-slate-200 bg-white p-4"
      data-testid="radlab-context"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Archive · instrument context
          </p>
          <h2 id="radiation-context-title" className="mt-1 text-lg font-semibold text-slate-900">
            Archived radiation context
          </h2>
          <p className="mt-1 text-sm text-slate-700">
            {series.spacecraft} · {series.instrument_id} · {series.quantity.replaceAll("_", " ")}
          </p>
        </div>
        <span className="rounded-full bg-blue-50 px-3 py-1 text-sm font-semibold text-blue-800">
          {series.unit}
        </span>
      </header>

      <p className="mt-3 text-sm text-slate-600">
        UTC coverage: <time>{series.coverage_utc.start}</time> to{" "}
        <time>{series.coverage_utc.end}</time>
      </p>

      <RadiationChart series={series} />
      <aside className="mt-3 rounded-md border border-amber-400 bg-slate-800 p-3 text-sm" data-testid="neutron-context-note">
        <strong>Neutron radiation requires a separate detector.</strong> This archived chart is not a neutron-specific measurement or an individual astronaut dose.
        The Canadian Space Agency describes CANS as an autonomous neutron monitor.
        {" "}<a className="underline" href="https://www.asc-csa.gc.ca/eng/news/articles/2026/2026-02-26-monitoring-radiation-astronaut-health.asp" rel="noreferrer" target="_blank">CSA research source</a>.
      </aside>

      <p className="mt-2 text-sm text-slate-600">
        ISS instrument archive for mission context; separate from the fictional astronaut health readings.
      </p>
      <p className="mt-1 text-sm text-slate-600" data-testid="radlab-gap-summary">
        {gapCount === 0
          ? "No missing readings in this selected archive slice."
          : `${gapCount} missing reading(s) shown as gaps; values are not interpolated.`}
      </p>

      <details className="mt-3">
        <summary className="cursor-pointer text-sm font-medium text-selection">
          Readings ({series.row_count})
        </summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200">
                <th scope="col" className="p-2">UTC timestamp</th>
                <th scope="col" className="p-2">Reading ({series.unit})</th>
              </tr>
            </thead>
            <tbody>
              {series.points.map((point, index) => (
                <tr key={`${point.timestamp_utc}-${index}`} className="border-b border-slate-100">
                  <td className="p-2">{point.timestamp_utc}</td>
                  <td className="p-2">
                    {point.value === null ? "No reading (gap)" : formatValue(point.value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <a
        className="mt-3 inline-block text-sm text-selection underline"
        href={series.source.export_url}
        target="_blank"
        rel="noreferrer"
      >
        NASA OSDR RadLab source query
      </a>
      <p className="mt-1 text-xs text-slate-500">
        {series.time_basis}. This chart is not a personal astronaut health measurement.
      </p>
    </section>
  );
}

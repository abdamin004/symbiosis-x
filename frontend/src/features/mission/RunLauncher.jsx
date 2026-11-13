import { Link } from "react-router-dom";
import ServiceStatus from "./ServiceStatus.jsx";

const ROLE_LINKS = [
  { role: "crew", label: "Open Crew console", detail: "Onboard view with the current modeled state." },
  { role: "ground", label: "Open Ground console", detail: "Delayed view built from delivered snapshots." },
];

export default function RunLauncher({ run }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium uppercase tracking-wide text-slate-500">SYMBIOSIS X</p>
        <ServiceStatus />
      </div>
      <h1 className="mt-1 text-3xl font-semibold text-slate-900">Run launcher</h1>

      <section aria-labelledby="run-heading" className="mt-8 rounded-lg border border-slate-200 bg-white p-5">
        <h2 id="run-heading" className="text-lg font-semibold">
          Run <span data-testid="launcher-run-id">{run.runId}</span>
        </h2>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-slate-700">
          <dt className="text-slate-500">Scenario</dt>
          <dd>{run.scenarioId}</dd>
          <dt className="text-slate-500">Seed</dt>
          <dd>{run.seed}</dd>
          <dt className="text-slate-500">Data</dt>
          <dd>Synthetic fixture</dd>
        </dl>
      </section>

      <ul className="mt-6 grid gap-4 sm:grid-cols-2">
        {ROLE_LINKS.map(({ role, label, detail }) => (
          <li key={role}>
            <Link
              to={`/runs/${encodeURIComponent(run.runId)}/${role}`}
              className="block rounded-lg border border-slate-200 bg-white p-5 hover:border-selection focus-visible:outline-2 focus-visible:outline-selection"
            >
              <span className="font-semibold text-slate-900">{label}</span>
              <span className="mt-1 block text-sm text-slate-600">{detail}</span>
            </Link>
          </li>
        ))}
      </ul>

      <p className="mt-6 text-sm text-slate-500">
        These links choose a view. The server decides what each role may read.
      </p>
    </main>
  );
}

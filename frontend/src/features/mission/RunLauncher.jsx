import { useState } from "react";
import { Link } from "react-router-dom";
import { loadFacilitatorRun, saveFacilitatorRun } from "../../api/client.js";
import FacilitatorControls from "./FacilitatorControls.jsx";
import ServiceStatus from "./ServiceStatus.jsx";

const ROLE_LINKS = [
  { role: "crew", label: "Open Crew console", detail: "Onboard view with the current modeled state." },
  { role: "ground", label: "Open Ground console", detail: "Delayed view built from delivered snapshots." },
];

export default function RunLauncher({ run: fixtureRun }) {
  // A live run this facilitator started survives a reload; otherwise show the fixture run.
  const [run, setRun] = useState(() => loadFacilitatorRun() ?? fixtureRun);

  function handleRunChange(next) {
    saveFacilitatorRun(next);
    setRun(next);
  }

  return (
    <main className="sx-shell mx-auto max-w-3xl px-4 py-12">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium uppercase tracking-wide text-slate-500">SYMBIOSIS X</p>
        <ServiceStatus />
      </div>
      <h1 className="mt-1 text-3xl font-semibold text-slate-900">Run launcher</h1>

      <FacilitatorControls run={run} onRunChange={handleRunChange} />

      {run && (
        <section aria-labelledby="run-heading" className="mt-5 rounded-lg border border-slate-200 bg-white p-5">
          <h2 id="run-heading" className="text-lg font-semibold">
            {run.live ? "Current run" : "Example run"} <span data-testid="launcher-run-id">{run.runId}</span>
          </h2>
          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-slate-700">
            <dt className="text-slate-500">Scenario</dt><dd>{run.scenarioId}</dd>
            <dt className="text-slate-500">Seed</dt><dd>{run.seed}</dd>
            <dt className="text-slate-500">Mission seconds</dt>
            <dd data-testid="launcher-mission-time">{run.mission_s ?? 0}</dd>
            <dt className="text-slate-500">Step</dt><dd>{run.step ?? 0}</dd>
            <dt className="text-slate-500">Data</dt><dd>{run.live ? "Live synthetic run" : "Synthetic fixture"}</dd>
          </dl>
        </section>
      )}

      {run && (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2">
          {ROLE_LINKS.map(({ role, label, detail }) => (
            <li key={role}>
              <Link
                to={"/runs/" + encodeURIComponent(run.runId) + "/" + role}
                className="block rounded-lg border border-slate-200 bg-white p-5 hover:border-selection focus-visible:outline-2 focus-visible:outline-selection"
              >
                <span className="font-semibold text-slate-900">{label}</span>
                <span className="mt-1 block text-sm text-slate-600">{detail}</span>
              </Link>
            </li>
          ))}
        <li><a href={"/flight?view=replay&run_id=" + encodeURIComponent(run.runId)}
          className="block rounded-lg border border-slate-200 bg-white p-5 hover:border-selection">
          <span className="font-semibold text-slate-900">Open Flight crew portraits</span>
          <span className="mt-1 block text-sm text-slate-600">Use the deck to open a private health record for this run.</span>
        </a></li>
        </ul>
      )}

      <p className="mt-6 text-sm text-slate-500">
        Only the facilitator can start, advance, reset or end a run. Crew and Ground links open role-scoped views,
        and the server decides what each role may read.
      </p>
    </main>
  );
}

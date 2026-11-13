import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { advanceRun, createOperationId, resetRun, setActiveRunId, startRun } from "../../api/client.js";
import ServiceStatus from "./ServiceStatus.jsx";

const ROLE_LINKS = [
  { role: "crew", label: "Open Crew console", detail: "Onboard view with the current modeled state." },
  { role: "ground", label: "Open Ground console", detail: "Delayed view built from delivered snapshots." },
];

export default function RunLauncher({ run: initialRun }) {
  const [run, setRun] = useState(initialRun);
  const [scenarioId, setScenarioId] = useState("sx01-golden");
  const [scenarioVersion, setScenarioVersion] = useState("1");
  const [seed, setSeed] = useState("4242");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pending = useRef({ start: null, advance: null, reset: null });

  async function handleStart(event) {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    pending.current.start ??= createOperationId("start");
    try {
      const receipt = await startRun({ start_id: pending.current.start, scenario_id: scenarioId, scenario_version: scenarioVersion, seed: Number(seed) });
      setRun({ runId: receipt.run_id, scenarioId: receipt.scenario_id, seed: receipt.seed, mission_s: receipt.mission_s, step: receipt.step });
      setActiveRunId(receipt.run_id);
      setActiveRunId(receipt.run_id);
      pending.current.start = null;
      setNotice("Run started. Crew and Ground now share this run ID.");
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  async function handleAdvance() {
    if (!run?.runId) return;
    setBusy(true); setError(""); setNotice("");
    pending.current.advance ??= createOperationId("advance");
    try {
      const receipt = await advanceRun(run.runId, { advance_id: pending.current.advance, expected_step: run.step });
      setRun((old) => ({ ...old, mission_s: receipt.mission_s, step: receipt.step }));
      pending.current.advance = null;
      setNotice("Mission advanced to " + receipt.mission_s + " seconds.");
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  async function handleReset() {
    if (!run?.runId) return;
    setBusy(true); setError(""); setNotice("");
    pending.current.reset ??= createOperationId("reset");
    try {
      const receipt = await resetRun(run.runId, { reset_id: pending.current.reset });
      setRun({ runId: receipt.run_id, scenarioId: receipt.scenario_id, seed: receipt.seed, mission_s: receipt.mission_s, step: receipt.step });
      setActiveRunId(receipt.run_id);
      pending.current.reset = null;
      pending.current.advance = null;
      setNotice("A new run has started. Both role links now point to the replacement run.");
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium uppercase tracking-wide text-slate-500">SYMBIOSIS X</p>
        <ServiceStatus />
      </div>
      <h1 className="mt-1 text-3xl font-semibold text-slate-900">Run launcher</h1>
      <section className="mt-8 rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold">Start a mission run</h2>
        <form className="mt-3 grid gap-3 sm:grid-cols-3" onSubmit={handleStart}>
          <label className="text-sm text-slate-700">Scenario ID<input className="mt-1 w-full rounded border p-2" value={scenarioId} onChange={(e) => setScenarioId(e.target.value)} required /></label>
          <label className="text-sm text-slate-700">Version<input className="mt-1 w-full rounded border p-2" value={scenarioVersion} onChange={(e) => setScenarioVersion(e.target.value)} required /></label>
          <label className="text-sm text-slate-700">Seed<input className="mt-1 w-full rounded border p-2" type="number" value={seed} onChange={(e) => setSeed(e.target.value)} required /></label>
          <button disabled={busy} className="rounded-md bg-selection px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 sm:col-span-3" type="submit">{busy ? "Working…" : "Start run"}</button>
        </form>
      </section>
      {run && <section aria-labelledby="run-heading" className="mt-5 rounded-lg border border-slate-200 bg-white p-5">
        <h2 id="run-heading" className="text-lg font-semibold">Current run <span data-testid="launcher-run-id">{run.runId}</span></h2>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-slate-700">
          <dt className="text-slate-500">Scenario</dt><dd>{run.scenarioId}</dd>
          <dt className="text-slate-500">Seed</dt><dd>{run.seed}</dd>
          <dt className="text-slate-500">Mission seconds</dt><dd data-testid="launcher-mission-time">{run.mission_s ?? 0}</dd>
          <dt className="text-slate-500">Step</dt><dd>{run.step ?? 0}</dd>
        </dl>
        <div className="mt-4 flex flex-wrap gap-2">
          <button disabled={busy} onClick={handleAdvance} className="rounded-md border px-4 py-2 text-sm font-semibold disabled:opacity-50">Advance one step</button>
          <button disabled={busy} onClick={handleReset} className="rounded-md border border-red-300 px-4 py-2 text-sm font-semibold text-red-800 disabled:opacity-50">Reset run</button>
        </div>
      </section>}
      {error && <p role="alert" className="mt-4 rounded bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {notice && <p role="status" className="mt-4 rounded bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
      {run && <ul className="mt-6 grid gap-4 sm:grid-cols-2">
        {ROLE_LINKS.map(({ role, label, detail }) => <li key={role}>
          <Link to={"/runs/" + encodeURIComponent(run.runId) + "/" + role} className="block rounded-lg border border-slate-200 bg-white p-5 hover:border-selection focus-visible:outline-2 focus-visible:outline-selection">
            <span className="font-semibold text-slate-900">{label}</span><span className="mt-1 block text-sm text-slate-600">{detail}</span>
          </Link>
        </li>)}
      </ul>}
      <p className="mt-6 text-sm text-slate-500">Only the facilitator can start, advance or reset a run. Crew and Ground links open role-scoped views.</p>
    </main>
  );
}

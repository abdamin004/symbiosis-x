import { useState } from "react";
import {
  advanceRun,
  clearPendingCommand,
  endRun,
  pendingCommandId,
  resetRun,
  startRun,
} from "../../api/client.js";

function runFromReceipt(receipt) {
  return {
    runId: receipt.run_id,
    scenarioId: receipt.scenario_id,
    scenarioVersion: receipt.scenario_version,
    seed: receipt.seed,
    mission_s: receipt.mission_s,
    step: receipt.step,
    status: receipt.status ?? "active",
    live: true,
  };
}

/**
 * Facilitator-only start, step and reset. Each command carries a stable ID:
 * a retry after an error or reload sends the same ID, so the server returns
 * the first receipt instead of starting, stepping or resetting twice.
 */
export default function FacilitatorControls({ run, onRunChange }) {
  const [scenarioId, setScenarioId] = useState(run?.scenarioId ?? "sx01-golden");
  const [scenarioVersion, setScenarioVersion] = useState(run?.scenarioVersion ?? "1");
  const [seed, setSeed] = useState(String(run?.seed ?? 4242));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const live = Boolean(run?.live);
  const ended = run?.status === "closed";

  async function send(kind, fingerprint, request, message) {
    setBusy(true); setError(""); setNotice("");
    const id = pendingCommandId(kind, fingerprint);
    try {
      const receipt = await request(id);
      clearPendingCommand(kind);
      setConfirmingEnd(false);
      onRunChange(runFromReceipt(receipt));
      setNotice(message(receipt));
    } catch (e) {
      // Keep the pending ID: retrying this same command reuses it.
      setError(e.code ?? e.message);
    } finally {
      setBusy(false);
    }
  }

  function handleStart(event) {
    event.preventDefault();
    const command = { scenario_id: scenarioId, scenario_version: scenarioVersion, seed: Number(seed) };
    send("start", command, (start_id) => startRun({ start_id, ...command }),
      () => "Run started. Crew and Ground now share this run ID.");
  }
  function handleAdvance() {
    const fingerprint = { runId: run.runId, expected_step: run.step };
    send("advance", fingerprint,
      (advance_id) => advanceRun(run.runId, { advance_id, expected_step: run.step }),
      (receipt) => "Mission advanced to " + receipt.mission_s + " seconds.");
  }
  function handleReset() {
    send("reset", { runId: run.runId },
      (reset_id) => resetRun(run.runId, { reset_id }),
      () => "A new run has started. Both role links now point to the replacement run.");
  }
  function handleEnd() {
    send("end", { runId: run.runId },
      (end_id) => endRun(run.runId, { end_id }),
      (receipt) => "Mission ended at " + receipt.mission_s
        + " seconds. Crew and Ground can still review it. Start a new run to fly again.");
  }

  return (
    <section aria-labelledby="facilitator-heading" className="mt-8 rounded-lg border border-slate-200 bg-white p-5"
      data-testid="facilitator-controls">
      <h2 id="facilitator-heading" className="text-lg font-semibold">Facilitator controls</h2>
      <form className="mt-3 grid gap-3 sm:grid-cols-3" onSubmit={handleStart}>
        <label className="text-sm text-slate-700">Scenario ID
          <input className="mt-1 w-full rounded border p-2" value={scenarioId}
            onChange={(e) => setScenarioId(e.target.value)} required />
        </label>
        <label className="text-sm text-slate-700">Version
          <input className="mt-1 w-full rounded border p-2" value={scenarioVersion}
            onChange={(e) => setScenarioVersion(e.target.value)} required />
        </label>
        <label className="text-sm text-slate-700">Seed
          <input className="mt-1 w-full rounded border p-2" type="number" value={seed}
            onChange={(e) => setSeed(e.target.value)} required />
        </label>
        <button disabled={busy} type="submit"
          className="rounded-md bg-selection px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 sm:col-span-3">
          {busy ? "Working…" : "Start run"}
        </button>
      </form>
      {live && ended && (
        <p className="mt-4 rounded bg-slate-100 p-3 text-sm text-slate-700" data-testid="launcher-run-status">
          Mission ended · read only
        </p>
      )}
      {live && !ended && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button disabled={busy} onClick={handleAdvance} type="button"
            className="rounded-md border px-4 py-2 text-sm font-semibold disabled:opacity-50">
            Advance one step
          </button>
          <button disabled={busy} onClick={handleReset} type="button"
            className="rounded-md border border-red-300 px-4 py-2 text-sm font-semibold text-red-800 disabled:opacity-50">
            Reset run
          </button>
          {confirmingEnd ? (
            <span className="flex flex-wrap items-center gap-2 rounded-md bg-red-50 px-3 py-1.5 text-sm text-red-900">
              End this mission? It cannot be resumed.
              <button disabled={busy} onClick={handleEnd} type="button"
                className="rounded-md bg-red-700 px-3 py-1 font-semibold text-white disabled:opacity-50">
                Confirm end
              </button>
              <button disabled={busy} onClick={() => setConfirmingEnd(false)} type="button"
                className="rounded-md border border-red-300 px-3 py-1 font-semibold">
                Keep flying
              </button>
            </span>
          ) : (
            <button disabled={busy} onClick={() => setConfirmingEnd(true)} type="button"
              className="rounded-md border border-red-300 px-4 py-2 text-sm font-semibold text-red-800 disabled:opacity-50">
              End mission
            </button>
          )}
        </div>
      )}
      {error && <p role="alert" className="mt-4 rounded bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {notice && <p role="status" className="mt-4 rounded bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    </section>
  );
}

import { useState } from "react";
import { clearPendingCommand, pendingCommandId, submitGroundAdvisory } from "../../api/client.js";

const CANDIDATES = [
  { id: "hold_course", label: "Hold course" },
  { id: "start_standby", label: "Start standby scrubber" },
  { id: "reduce_activity", label: "Reduce crew activity" },
];

const REJECTIONS = {
  BASIS_NOT_DELIVERED: "That snapshot has not been delivered to Ground, so it cannot be cited.",
  RUN_CLOSED: "The mission has ended. Advice can no longer be queued.",
  OPERATION_ID_REUSED: "This advice ID was already used for different advice.",
  RUN_NOT_FOUND: "This run is not available on the server.",
};

function formatMissionTime(seconds) {
  const minutes = String(Math.floor(seconds / 60)).padStart(2, "0");
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * Ground advice on one candidate, citing the delivered snapshot shown above it.
 * The basis is always the displayed packet's snapshot ID; Ground cannot type one.
 * The server queues the advice for the relay; approval stays in the Crew console.
 */
export default function AdvisoryForm({ runId, packet, closed = false }) {
  const [candidate, setCandidate] = useState(CANDIDATES[0].id);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [rejection, setRejection] = useState("");
  const basis = packet?.snapshot_id ?? null;

  async function handleSubmit(event) {
    event.preventDefault();
    if (!basis) return;
    setBusy(true); setRejection("");
    // A retry of the same advice on the same basis reuses its operation ID.
    const fingerprint = { runId, basis, candidate };
    const operation_id = pendingCommandId("ground-advisory", fingerprint);
    try {
      const result = await submitGroundAdvisory(runId, {
        operation_id, basis_snapshot_id: basis, candidate_id: candidate,
      });
      clearPendingCommand("ground-advisory");
      setReceipt(result);
    } catch (error) {
      setReceipt(null);
      setRejection(error.code ?? error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="advisory-heading" data-testid="advisory-form"
      className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
      <h2 id="advisory-heading" className="text-lg font-semibold">Send advice to Crew</h2>
      {!basis ? (
        <p className="mt-2 text-sm text-slate-600">Advice needs a delivered snapshot to cite. Wait for the first delivery.</p>
      ) : (
        <form className="mt-3 grid gap-3" onSubmit={handleSubmit}>
          <p className="text-sm text-slate-700">
            Basis <strong data-testid="advisory-basis">{basis}</strong>
            {packet.decision_rev != null && <> · revision v{packet.decision_rev}</>}
          </p>
          <fieldset className="grid gap-2 sm:grid-cols-3" disabled={busy || closed}>
            <legend className="sr-only">Candidate</legend>
            {CANDIDATES.map(({ id, label }) => (
              <label key={id} className="flex items-center gap-2 rounded border border-slate-200 p-2 text-sm">
                <input type="radio" name="candidate" value={id} checked={candidate === id}
                  onChange={() => setCandidate(id)} />
                {label}
              </label>
            ))}
          </fieldset>
          <button type="submit" disabled={busy || closed}
            className="justify-self-start rounded-md bg-selection px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? "Sending…" : "Queue advice"}
          </button>
        </form>
      )}

      {receipt && (
        <dl data-testid="advisory-receipt" data-status={receipt.status}
          className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 rounded bg-emerald-50 p-3 text-sm text-emerald-900 sm:grid-cols-4">
          <dt>Status</dt><dd data-testid="advisory-status">Queued</dd>
          <dt>Candidate</dt><dd>{CANDIDATES.find((c) => c.id === receipt.candidate_id)?.label ?? receipt.candidate_id}</dd>
          <dt>Basis</dt><dd data-testid="advisory-receipt-basis">{receipt.basis_snapshot_id} · v{receipt.basis_decision_rev}</dd>
          <dt>Issued</dt><dd>{formatMissionTime(receipt.issued_at_s)}</dd>
          <dt>Due onboard</dt><dd data-testid="advisory-due">{formatMissionTime(receipt.deliver_at_s)}</dd>
          <dt>Operation</dt><dd className="truncate">{receipt.operation_id}</dd>
        </dl>
      )}
      {rejection && (
        <p role="alert" data-testid="advisory-rejected" className="mt-4 rounded bg-red-50 p-3 text-sm text-red-800">
          Rejected: {REJECTIONS[rejection] ?? rejection} <span className="font-mono text-xs">({rejection})</span>
        </p>
      )}
      <p className="mt-3 text-xs text-slate-500">
        Advice is advisory. Crew reviews it onboard when it arrives, and any approval happens in the Crew console.
      </p>
    </section>
  );
}

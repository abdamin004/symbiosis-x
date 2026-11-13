import { useRef, useState } from "react";
import { commitAction, createOperationId, readActionReceipt } from "../../api/client.js";
import { CANDIDATE_LABELS, REASON_TEXT } from "./CandidateList.jsx";

// No HTTP status (network failure) or a server error means the outcome is unknown.
const uncertain = (error) => error.status == null || error.status >= 500;

/**
 * SX-09C: send one Crew approval through the commit gate and render the
 * server's receipt. One operation ID belongs to one approval attempt: a lost
 * response is resolved by looking up that ID, and a resend reuses it, so the
 * gate can never apply the same approval twice.
 */
export default function ApprovalPanel({ runId, plan, candidateId, onReceipt }) {
  const operation = useRef(null);
  const [state, setState] = useState({ phase: "idle" });

  function settle(receipt) {
    operation.current = null;
    setState({ phase: "receipt", receipt });
    onReceipt?.(receipt);
  }

  async function send() {
    operation.current ??= {
      operation_id: createOperationId("approve"),
      candidate_id: candidateId,
      basis_decision_rev: plan.decision_rev,
      policy_version: plan.policy_version,
      basis_snapshot_id: plan.basis_snapshot_id,
    };
    setState({ phase: "sending" });
    try {
      settle(await commitAction(runId, operation.current));
    } catch (error) {
      if (uncertain(error)) setState({ phase: "uncertain" });
      else {
        operation.current = null;
        setState({ phase: "error", message: error.code ?? error.message });
      }
    }
  }

  async function lookUp() {
    setState({ phase: "sending" });
    try {
      settle(await readActionReceipt(runId, operation.current.operation_id));
    } catch (error) {
      setState({
        phase: "uncertain",
        note: error.code === "ACTION_NOT_FOUND"
          ? "The gate has no record of this approval yet. Send it again with the same operation ID."
          : "The receipt could not be read. Try again.",
      });
    }
  }

  const busy = state.phase === "sending";
  const pending = operation.current;
  const receipt = state.receipt;
  return (
    <section aria-labelledby="approval-heading" className="mt-6 rounded-lg border border-slate-200 bg-white p-4" data-testid="approval-panel">
      <h2 id="approval-heading" className="font-semibold">Crew approval</h2>
      {!candidateId && !pending && <p className="mt-2 text-sm text-slate-600">
        Select an available option to approve it. The commit gate re-checks it before anything changes.
      </p>}
      {candidateId && state.phase !== "uncertain" && <div className="mt-2 flex flex-wrap items-center gap-3">
        <p className="text-sm">Approve <strong>{CANDIDATE_LABELS[candidateId] ?? candidateId}</strong> on {plan.basis_snapshot_id} (v{plan.decision_rev})</p>
        <button type="button" disabled={busy} onClick={send} className="rounded-md bg-selection px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {busy ? "Sending…" : "Approve"}
        </button>
      </div>}
      {state.phase === "uncertain" && pending && <div role="alert" className="mt-2 rounded bg-amber-50 p-3 text-sm text-amber-900" data-testid="approval-uncertain">
        <p>The response was lost, so the approval may or may not have been recorded. Operation <span className="font-mono">{pending.operation_id}</span>.</p>
        {state.note && <p className="mt-1">{state.note}</p>}
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" onClick={lookUp} className="rounded-md border border-amber-400 px-3 py-1 font-semibold">Look up receipt</button>
          <button type="button" onClick={send} className="rounded-md border border-amber-400 px-3 py-1 font-semibold">Send again</button>
        </div>
      </div>}
      {state.phase === "error" && <p role="alert" className="mt-2 text-sm text-red-800">Approval refused: {state.message}</p>}
      {receipt && <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 rounded bg-slate-50 p-3 text-sm" data-testid="approval-receipt">
        <dt className="text-slate-500">Decision</dt>
        <dd className="font-semibold" data-testid="approval-decision">{receipt.status === "accepted" ? "Accepted" : "Rejected"} · {receipt.applied ? "applied" : "not applied"}</dd>
        <dt className="text-slate-500">Option</dt><dd>{CANDIDATE_LABELS[receipt.candidate_id] ?? receipt.candidate_id}</dd>
        {receipt.reason_code && <><dt className="text-slate-500">Reason</dt>
          <dd><span className="font-mono text-xs">{receipt.reason_code}</span> · {REASON_TEXT[receipt.reason_code] ?? ""}</dd></>}
        <dt className="text-slate-500">Revision</dt><dd>v{receipt.basis_decision_rev} → v{receipt.current_decision_rev}</dd>
        <dt className="text-slate-500">Operation</dt><dd className="font-mono text-xs" data-testid="approval-operation-id">{receipt.operation_id}</dd>
      </dl>}
    </section>
  );
}

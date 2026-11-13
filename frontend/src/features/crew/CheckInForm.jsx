import { useRef, useState } from "react";
import { createOperationId, createPrivateCheckIn } from "../../api/client.js";

export default function CheckInForm({ runId, crewId = "SIM-01" }) {
  const [note, setNote] = useState("");
  const [receipt, setReceipt] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const requestId = useRef(null);

  async function submit(event) {
    event.preventDefault();
    setBusy(true); setError(""); setReceipt(null);
    requestId.current ??= createOperationId("checkin");
    try {
      const result = await createPrivateCheckIn(runId, {
        check_in_id: requestId.current,
        crew_id: crewId,
        note,
        synthetic: true,
      });
      setReceipt(result);
      setNote("");
      requestId.current = null;
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 rounded-lg border border-slate-200 bg-white p-4" data-testid="private-checkin">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Crew only · private lane</p>
      <h2 className="mt-1 text-lg font-semibold">Daily check-in</h2>
      <p className="mt-1 text-sm text-slate-600">Record a synthetic note for the onboard Crew record. It is not sent to Ground.</p>
      <form className="mt-3 space-y-3" onSubmit={submit}>
        <label className="block text-sm font-medium text-slate-700" htmlFor="crew-checkin-note">How are you feeling?</label>
        <textarea id="crew-checkin-note" value={note} maxLength={1000} required rows={3}
          onChange={(event) => setNote(event.target.value)}
          className="block w-full rounded-md border border-slate-300 px-3 py-2" />
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-slate-500">{note.length}/1000 characters</span>
          <button disabled={busy || !note.trim()} className="rounded-md bg-selection px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" type="submit">
            {busy ? "Saving…" : "Save private check-in"}
          </button>
        </div>
      </form>
      {error && <p role="alert" className="mt-3 rounded bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {receipt && <div role="status" className="mt-3 rounded border border-emerald-200 bg-emerald-50 p-3 text-sm" data-testid="checkin-receipt">
        <p className="font-semibold text-emerald-900">Private check-in saved</p>
        <p className="mt-1 text-emerald-900">{receipt.note}</p>
        <p className="mt-1 text-xs text-emerald-800">Mission time: {receipt.mission_s}s · {receipt.crew_id} · synthetic</p>
      </div>}
    </section>
  );
}

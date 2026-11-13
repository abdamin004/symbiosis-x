import { useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { acknowledgeEmergencyCase, createOperationId, openEmergencyCase } from "../../api/client.js";

const DRILLS = [
  { id: "drill-chest-pain-v1", title: "Chest pain drill", reporter: "SIM-01", subject: "SIM-01", responder: "SIM-02", kind: "chest_pain" },
  { id: "drill-collapse-v1", title: "Collapse drill", reporter: "SIM-04", subject: "SIM-03", responder: "SIM-04", kind: "collapse" },
];

export default function EmergencyAssist() {
  const { runId } = useParams();
  const [drillId, setDrillId] = useState(DRILLS[0].id);
  const [responsiveness, setResponsiveness] = useState("unknown");
  const [caseData, setCaseData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const operationId = useRef(null);
  const selected = DRILLS.find((drill) => drill.id === drillId);

  async function trigger(event) {
    event.preventDefault();
    setBusy(true); setError("");
    operationId.current ??= createOperationId("emergency");
    const command = { operation_id: operationId.current, drill_id: selected.id, reported_by: selected.reporter, synthetic: true };
    if (selected.kind === "collapse") command.responsiveness = responsiveness;
    try {
      const result = await openEmergencyCase(runId, command);
      setCaseData(result);
      operationId.current = null;
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  async function acknowledge() {
    if (!caseData) return;
    setBusy(true); setError("");
    try {
      const result = await acknowledgeEmergencyCase(runId, caseData.case_id, { acknowledged_by: caseData.owner });
      setCaseData(result);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8" data-testid="emergency-assist">
      <Link className="text-sm text-slate-500 underline" to={"/runs/" + encodeURIComponent(runId) + "/crew"}>Back to Crew Health</Link>
      <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-amber-800">Synthetic training simulation only</p>
      <h1 className="mt-1 text-2xl font-semibold">Emergency Assist</h1>
      <p className="mt-2 text-sm text-slate-600">The drill raises a local onboard alert. It does not wait for vital readings or Ground connectivity.</p>
      <form className="mt-6 rounded-lg border border-slate-200 bg-white p-4" onSubmit={trigger}>
        <label htmlFor="emergency-drill" className="block text-sm font-semibold">Choose scripted drill</label>
        <select id="emergency-drill" value={drillId} onChange={(event) => { setDrillId(event.target.value); setCaseData(null); operationId.current = null; }} className="mt-2 w-full rounded-md border border-slate-300 p-2">
          {DRILLS.map((drill) => <option key={drill.id} value={drill.id}>{drill.title}</option>)}
        </select>
        {selected.kind === "collapse" && <label htmlFor="responsiveness" className="mt-4 block text-sm font-medium">Responsiveness
          <select id="responsiveness" value={responsiveness} onChange={(event) => setResponsiveness(event.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 p-2">
            <option value="unknown">Unknown</option><option value="responsive">Responsive</option><option value="unresponsive">Unresponsive</option>
          </select>
        </label>}
        <p className="mt-3 text-xs text-slate-500">Reporter: {selected.reporter} · Subject: {selected.subject} · Local responder: {selected.responder}</p>
        <button type="submit" disabled={busy || !!caseData} className="mt-4 rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Opening…" : "Raise local drill alert"}</button>
      </form>
      {error && <p role="alert" className="mt-4 rounded bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {caseData && <section className="mt-6 rounded-lg border-2 border-amber-400 bg-amber-50 p-4" role="status" data-testid="emergency-case">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-amber-950">Local alert · {caseData.status}</h2>
          <span className="rounded-full bg-amber-200 px-3 py-1 text-xs font-semibold" data-testid="emergency-ground-link">
            {caseData.ground_link === "not_required" ? "Ground link not required" : "Ground link: " + String(caseData.ground_link ?? "unknown").replaceAll("_", " ")}
          </span>
        </div>
        <p className="mt-2 text-sm">{caseData.report}</p>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <dt>Case</dt><dd>{caseData.case_id}</dd>
          <dt>Opened</dt><dd>{caseData.opened_at_s}s mission time</dd>
          <dt>Assigned responder</dt><dd>{caseData.owner}</dd>
          <dt>Heart-rate data</dt><dd>{caseData.vitals.heart_rate}</dd>
          <dt>Responsiveness</dt><dd>{caseData.responsiveness ?? "Not applicable"}</dd>
          <dt>Escalation</dt><dd>{caseData.escalation.level}</dd>
        </dl>
        <p className="mt-4 rounded border border-amber-300 bg-white p-3 text-sm font-medium">{caseData.procedure.label}</p>
        <p className="mt-2 text-xs text-slate-600">This is a training placeholder, not an approved medical procedure. Follow the mission's approved onboard procedure.</p>
        {caseData.status === "open" ? <button disabled={busy} onClick={acknowledge} className="mt-4 rounded-md bg-selection px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Acknowledge local response</button> : <p className="mt-3 text-sm font-semibold text-emerald-800">Local responder acknowledged at {caseData.acknowledgment?.acknowledged_at_s}s.</p>}
      </section>}
    </main>
  );
}

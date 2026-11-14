import { useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { acknowledgeEmergencyCase, createOperationId, openEmergencyCase, shareEmergencyCase } from "../../api/client.js";
import drills from "../../../../scenarios/variants/health-emergency-drills.json";
import roster from "@catalogs/crew/synthetic-roster.json";
import { emergencyAssessment, resolveEmergencyGuidance } from "./emergencyGuidance.js";

const DRILLS = drills.drills;
const crewNames = new Map(roster.crew.map(member => [member.crew_id,member.display_name]));

export default function EmergencyAssist() {
  const { runId } = useParams();
  const [search] = useSearchParams();
  const [drillId, setDrillId] = useState(() => DRILLS.find(drill => drill.kind === search.get("drill"))?.drill_id ?? DRILLS[0].drill_id);
  const [answers, setAnswers] = useState({});
  const [caseData, setCaseData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const operationId = useRef(null);
  const shareId = useRef(null);
  const [share, setShare] = useState(null);
  const selected = DRILLS.find(drill => drill.drill_id === drillId);
  const procedure = caseData?.procedure?.questions?.length ? caseData.procedure : selected.procedure;
  const steps = resolveEmergencyGuidance(procedure,answers);

  // Sharing is optional and delayed: it queues only an alias, priority and status for Ground.
  async function shareWithGround() {
    if (!caseData) return;
    setBusy(true); setError("");
    shareId.current ??= createOperationId("share");
    try {
      setShare(await shareEmergencyCase(runId, caseData.case_id, { operation_id: shareId.current }));
      shareId.current = null;
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function trigger(event) {
    event.preventDefault();
    setBusy(true); setError("");
    operationId.current ??= createOperationId("emergency");
    const command = {operation_id:operationId.current, drill_id:selected.drill_id, reported_by:selected.reported_by,
      synthetic:true, ...emergencyAssessment(selected,answers)};
    try {
      const result = await openEmergencyCase(runId, command);
      setCaseData(result);
      if (result.assessment) setAnswers(result.assessment);
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
        <select id="emergency-drill" value={drillId} disabled={busy} onChange={(event) => {
          setDrillId(event.target.value); setCaseData(null); setShare(null); setAnswers({}); setError("");
          operationId.current = null; shareId.current = null;
        }} className="mt-2 w-full rounded-md border border-slate-300 p-2">
          {DRILLS.map(drill => <option key={drill.drill_id} value={drill.drill_id}>{drill.title}</option>)}
        </select>
        {procedure.questions.map(question => <label key={question.id} className="mt-3 block text-sm font-medium">
          {question.label}
          <select id={question.id === "responsive" ? "responsiveness" : "emergency-" + question.id} value={answers[question.id] ?? "unknown"} disabled={busy || Boolean(caseData?.assessment)} onChange={event => {
            setAnswers({...answers,[question.id]:event.target.value});
            if (!caseData) operationId.current = null;
          }} className="mt-1 block w-full rounded-md border border-slate-300 p-2">
            <option value="unknown">Unknown</option><option value="yes">Yes</option><option value="no">No</option>
          </select>
        </label>)}
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm" aria-label="Onboard training steps">
          {steps.map(step => <li key={step}>{step}</li>)}
        </ol>
        <p className="mt-2 text-xs text-slate-600">{procedure.label}</p>
        <ul className="mt-2 flex flex-wrap gap-2 text-xs text-slate-600">
          {procedure.sources.map(source => <li key={source.url}><a className="underline" href={source.url} target="_blank" rel="noreferrer">{source.title}</a></li>)}
        </ul>
        <p className="mt-3 text-xs text-slate-500">Reporter {crewNames.get(selected.reported_by)} · Subject {crewNames.get(selected.subject_crew_id)} · Local responder {crewNames.get(selected.responder_crew_id)}</p>
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
          <dt>Assigned responder</dt><dd data-testid="emergency-responder" data-crew-id={caseData.owner}>{crewNames.get(caseData.owner) ?? caseData.owner}</dd>
          <dt>Heart-rate data</dt><dd>{caseData.vitals.heart_rate}</dd>
          <dt>Responsiveness</dt><dd>{caseData.responsiveness ?? "Not applicable"}</dd>
          <dt>Escalation</dt><dd>{caseData.escalation.level}</dd>
        </dl>
        {caseData.status === "open" ? <button disabled={busy} onClick={acknowledge} className="mt-4 rounded-md bg-selection px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Acknowledge local response</button> : <p className="mt-3 text-sm font-semibold text-emerald-800">Local responder acknowledged at {caseData.acknowledgment?.acknowledged_at_s}s.</p>}
        <div className="mt-4 border-t border-amber-300 pt-3">
          <button type="button" disabled={busy} onClick={shareWithGround} className="rounded-md border border-slate-400 bg-white px-4 py-2 text-sm font-semibold disabled:opacity-50">Share case status with Ground</button>
          <p className="mt-1 text-xs text-slate-600">Optional. Ground receives only an opaque alias, a review priority and the status, after the relay delay. Local response never waits for it.</p>
          {share && <p className="mt-2 rounded bg-white p-2 text-sm" data-testid="emergency-share-receipt">
            Queued for Ground as <strong>{share.case_alias}</strong> · {share.status} · due at Ground {share.deliver_at_s}s mission time.
          </p>}
        </div>
      </section>}
    </main>
  );
}

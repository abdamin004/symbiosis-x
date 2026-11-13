import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { readRunView } from "../../api/client.js";
import ApprovalPanel from "../crew/ApprovalPanel.jsx";
import CandidateList from "../crew/CandidateList.jsx";
import CheckInForm from "../crew/CheckInForm.jsx";
import AgentStatusStrip from "../workflow/AgentStatusStrip.jsx";
import TraceTimeline from "../workflow/TraceTimeline.jsx";

function time(seconds) {
  const m = String(Math.floor(seconds / 60)).padStart(2, "0");
  const s = String(seconds % 60).padStart(2, "0");
  return m + ":" + s;
}

export default function LiveMissionConsole({ role, runId }) {
  const [view, setView] = useState(null);
  const [error, setError] = useState("");
  const [plan, setPlan] = useState(null);
  const [selected, setSelected] = useState(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    readRunView(runId, role).then((result) => {
      if (active) { setView(result); setError(""); }
    }).catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [runId, role, reload]);
  const onPlan = useCallback((result) => {
    setPlan(result);
    // A new evaluation may change which options are available.
    setSelected((current) => result.candidates.some((c) => c.candidate_id === current && c.result === "feasible") ? current : null);
  }, []);
  // After the gate answers, re-read the run and re-check the options on the new revision.
  const onReceipt = useCallback(() => { setSelected(null); setReload((n) => n + 1); }, []);

  if (error) return <main className="mx-auto max-w-4xl px-4 py-12"><h1 className="text-2xl font-semibold">{role === "crew" ? "Crew" : "Ground"} console</h1><p role="status" className="mt-3 text-slate-700">{error === "RUN_NOT_FOUND" ? "No fixture is available for run " + runId + "." : "Could not load this role projection: " + error}</p><Link className="mt-3 inline-block underline" to="/">Back to launcher</Link></main>;
  if (!view) return <main className="mx-auto max-w-4xl px-4 py-12" role="status">Loading live run…</main>;

  return (
    <main className="mx-auto max-w-4xl px-4 py-8" data-testid="console-shell" data-role={role} data-run-id={view.run_id}>
      <header className="border-b border-slate-200 pb-4">
        <Link className="text-sm text-slate-500 underline" to="/">SYMBIOSIS X</Link>
        <h1 className="mt-2 text-2xl font-semibold">{role === "crew" ? "Crew console" : "Ground console"}</h1>
        <p className="mt-2 text-sm">Run <strong data-testid="console-run-id">{view.run_id}</strong> · Mission time {time(view.mission_s)} · {view.scenario_id} v{view.scenario_version}</p>
      </header>
      {view.status === "closed" && <p role="status" data-testid="console-run-ended" className="mt-4 rounded bg-slate-100 p-3 text-sm text-slate-700">Mission ended at {time(view.mission_s)}. This view is read only.</p>}
      {role === "crew" ? <>
        <section className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">Private Crew health profile</h2>
          <p className="mt-2 text-sm">Crew ID: {view.health_profile?.crew_id ?? "Unknown"} · Synthetic data</p>
          <p className="mt-2 text-sm">Assessment: {view.health_assessment?.personal?.status ?? "No assessment available"}</p>
          <div className="mt-3 flex flex-wrap gap-4"><Link className="text-sm font-semibold text-selection underline" to={"/runs/" + encodeURIComponent(runId) + "/crew/measure"}>Take a measurement</Link><Link className="text-sm font-semibold text-red-700 underline" to={"/runs/" + encodeURIComponent(runId) + "/crew/emergency"}>Open Emergency Assist</Link></div>
        </section>
        <CandidateList runId={runId} selected={selected} onSelect={view.status === "closed" ? undefined : setSelected} onPlan={onPlan} refreshKey={reload} />
        {view.status !== "closed" && plan && <ApprovalPanel runId={runId} plan={plan} candidateId={selected} onReceipt={onReceipt} />}
        <CheckInForm runId={runId} crewId={view.health_profile?.crew_id ?? "SIM-01"} />
      </> : <section className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="font-semibold">Latest delivered snapshot</h2>
        {view.packet ? <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
          <dt>Snapshot</dt><dd>{view.packet.snapshot_id}</dd>
          <dt>CO₂</dt><dd>{view.packet.co2.value} {view.packet.co2.unit}</dd>
          <dt>Observed</dt><dd>{time(view.packet.delivery.observed_at_s)}</dd>
          <dt>Received</dt><dd>{time(view.packet.delivery.received_at_s)}</dd>
          <dt>Age</dt><dd>{time(view.packet.delivery.age_s)}</dd>
          <dt>Link</dt><dd>{view.packet.delivery.link_status}</dd>
        </dl> : <p className="mt-2 text-sm text-slate-600">No Ground packet has been delivered yet.</p>}
      </section>}
      <AgentStatusStrip trace={view.trace ?? []} />
      <TraceTimeline trace={view.trace ?? []} />
    </main>
  );
}

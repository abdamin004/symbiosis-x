import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { acknowledgeGroundHealthCase, readRunView } from "../../api/client.js";
import ApprovalPanel from "../crew/ApprovalPanel.jsx";
import CandidateList from "../crew/CandidateList.jsx";
import CheckInForm from "../crew/CheckInForm.jsx";
import { CrewHealthDashboard } from "../crew/CrewHealthPanel.jsx";
import SpaceflightHazards from "../crew/SpaceflightHazards.jsx";
import HealthReminders from "../crew/HealthReminders.jsx";
import HealthTrend from "../crew/HealthTrend.jsx";
import GroundHealthStatus from "../ground/GroundHealthStatus.jsx";
import RadiationContext from "../crew/RadiationContext.jsx";
import { HEALTH_METRICS } from "../../api/healthCatalog.js";
import AdvisoryForm from "../ground/AdvisoryForm.jsx";
import GroundSnapshot from "../ground/GroundSnapshot.jsx";
import AgentStatusStrip from "../workflow/AgentStatusStrip.jsx";
import TraceTimeline from "../workflow/TraceTimeline.jsx";
import DeckMap from "../deck/DeckMap.jsx";

function time(seconds) {
  const m = String(Math.floor(seconds / 60)).padStart(2, "0");
  const s = String(seconds % 60).padStart(2, "0");
  return m + ":" + s;
}

export default function LiveMissionConsole({ role, runId }) {
  const [query] = useSearchParams();
  const crewId = role === "crew" ? query.get("crew_id") : null;
  return <RunProjection key={JSON.stringify([role, runId, crewId])} role={role} runId={runId} crewId={crewId} />;
}

function RunProjection({ role, runId, crewId }) {
  const subjectQuery = crewId ? "?crew_id=" + encodeURIComponent(crewId) : "";
  const [view, setView] = useState(null);
  const [error, setError] = useState("");
  const [plan, setPlan] = useState(null);
  const [selected, setSelected] = useState(null);
  const [reload, setReload] = useState(0);
  const [busyAlias, setBusyAlias] = useState(null);
  useEffect(() => {
    let active = true;
    setError("");
    readRunView(runId, role, crewId).then((result) => {
      if (active) { setView(result); setError(""); }
    }).catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [runId, role, crewId, reload]);
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
    <main className="sx-shell mx-auto max-w-4xl px-4 py-8" data-testid="console-shell" data-role={role} data-run-id={view.run_id}>
      <header className="border-b border-slate-200 pb-4">
        <Link className="text-sm text-slate-500 underline" to="/">SYMBIOSIS X</Link>
        <h1 className="mt-2 text-2xl font-semibold">{role === "crew" ? "Crew console" : "Ground console"}</h1>
        <p className="mt-2 text-sm">Run <strong data-testid="console-run-id">{view.run_id}</strong> · Mission time {time(view.mission_s)} · {view.scenario_id} v{view.scenario_version}</p>
      </header>

      <nav className="sx-page-nav" aria-label="Mission sections"><Link to="/">Mission</Link>{role === "crew" ? <><Link to={"/runs/" + encodeURIComponent(runId) + "/crew" + subjectQuery}>Health</Link><Link to={"/runs/" + encodeURIComponent(runId) + "/crew/measure" + subjectQuery}>Measure</Link><Link to={"/runs/" + encodeURIComponent(runId) + "/crew/emergency"}>Emergency</Link><Link to={"/runs/" + encodeURIComponent(runId) + "/crew/medical" + subjectQuery}>Medical</Link></> : <span className="rounded-lg border border-sky-400 px-4 py-2 text-sm">Ground · delayed operational view</span>}</nav>
      {view.status === "closed" && <p role="status" data-testid="console-run-ended" className="mt-4 rounded bg-slate-100 p-3 text-sm text-slate-700">Mission ended at {time(view.mission_s)}. This view is read only.</p>}
      {role === "crew" ? <>
        <Link className="mt-4 inline-block text-sm font-semibold text-selection underline"
          to={"/runs/" + encodeURIComponent(runId) + "/crew/medical" + subjectQuery}>Open Medical</Link>
        <CrewHealthDashboard profile={view.health_profile} assessment={view.health_assessment} metrics={HEALTH_METRICS}
          measureHref={"/runs/" + encodeURIComponent(runId) + "/crew/measure" + subjectQuery}
          emergencyHref={"/runs/" + encodeURIComponent(runId) + "/crew/emergency"} />
        <SpaceflightHazards />
        <HealthReminders runId={runId} followup={view.health_followup}
          measureHref={"/runs/" + encodeURIComponent(runId) + "/crew/measure" + subjectQuery}
          emergencyHref={"/runs/" + encodeURIComponent(runId) + "/crew/emergency"}
          onChange={() => setReload((n) => n + 1)} />
        {view.health_trend && <HealthTrend trend={view.health_trend} />}
        <section className="mt-6 rounded-lg border border-sky-200 bg-sky-50 p-4" data-testid="live-cabin-context">
          <h2 className="font-semibold">Cabin context</h2>
          <p className="mt-1 text-sm text-slate-700">{view.co2
            ? <>CO₂ <strong>{Math.round(view.co2.value)} {view.co2.unit}</strong> · observed {time(view.co2.observed_at_s)}</>
            : "Cabin CO₂ is unknown; no accepted reading is available yet."}</p>
          <p className="mt-1 text-xs text-slate-500">Shown separately from Crew Health; it does not establish a cause for a health status.</p>
        </section>
        <CandidateList runId={runId} selected={selected} onSelect={view.status === "closed" ? undefined : setSelected} onPlan={onPlan} refreshKey={reload} />
        {view.status !== "closed" && plan && <ApprovalPanel runId={runId} plan={plan} candidateId={selected} onReceipt={onReceipt} />}
        <CheckInForm runId={runId} crewId={view.health_profile?.crew_id ?? "SIM-01"} />
        <details className="mt-6 rounded-lg border border-slate-200 bg-white p-4" data-testid="supporting-context">
          <summary className="cursor-pointer font-semibold">Supporting context: ship systems and archived radiation data</summary>
          <DeckMap role={role} equipment={view.equipment ?? null} />
          <section className="mt-3 rounded-md border border-slate-200 p-3" data-testid="supporting-ship-systems">
            <h3 className="text-sm font-semibold">Ship systems</h3>
            <p className="mt-1 text-sm text-slate-700">Mission control lists ship systems by room and plays the cabin replay.</p>
            <p className="mt-1 text-xs text-slate-500">It keeps its own run and replay, so it does not show run {view.run_id}. A drawn deck map is not available yet; the 2D deck (SX-08A) will be shown here once it is merged.</p>
            <a className="mt-2 inline-block text-sm font-semibold text-selection underline" href="/mission" target="_blank" rel="noreferrer">Open ship systems</a>
          </section>
          <RadiationContext />
        </details>
      </> : <>
        <GroundSnapshot packet={view.packet} missionS={view.mission_s} />
        <details className="mt-5 rounded-lg border border-slate-200 bg-white p-4"><summary className="font-semibold">Ship systems · delivered operational view</summary><DeckMap role={role} equipment={view.packet} /></details>
        <AdvisoryForm runId={runId} packet={view.packet} closed={view.status === "closed"} />
        <GroundHealthStatus cases={view.health_cases ?? []} busyAlias={busyAlias}
          onAcknowledge={async (alias) => {
            setBusyAlias(alias);
            try { await acknowledgeGroundHealthCase(runId, alias); setReload((n) => n + 1); }
            finally { setBusyAlias(null); }
          }} />
      </>}
      <AgentStatusStrip trace={view.trace ?? []} />
      <TraceTimeline trace={view.trace ?? []} />
    </main>
  );
}

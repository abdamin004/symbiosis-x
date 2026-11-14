import {useEffect, useState} from "react";
import {Link, useParams, useSearchParams} from "react-router-dom";
import {readCrewHealthTwin} from "../../api/client.js";
import SpaceflightEvidence from "./SpaceflightEvidence.jsx";
import SleepPhaseArchive from "./SleepPhaseArchive.jsx";

function missionTime(seconds) {
  return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
}

export default function MedicalTimeline() {
  const {runId} = useParams();
  const [query] = useSearchParams();
  const crewId = query.get("crew_id") ?? "SIM-01";
  return <MedicalRecord key={JSON.stringify([runId, crewId])} runId={runId} crewId={crewId} />;
}

function MedicalRecord({runId, crewId}) {
  const [response, setResponse] = useState(null);
  const [scenario, setScenario] = useState(null);
  const [refresh, setRefresh] = useState(0);
  const [failed, setFailed] = useState(false);
  const crewPath = "/runs/" + encodeURIComponent(runId) + "/crew";

  useEffect(() => {
    let active = true;
    setFailed(false);
    readCrewHealthTwin(runId, crewId).then(data => {
      if (!active) return;
      if (data.run_id !== runId || data.crew_id !== crewId || data.role !== "crew") throw new Error("Medical record mismatch");
      setResponse(data);
    }).catch(() => {
      if (active) {
        setResponse(null);
        setFailed(true);
      }
    });
    return () => { active = false; };
  }, [runId, crewId, refresh]);

  const timeline = response?.medical_timeline;
  const entry = timeline?.cases.find(item => item.id === scenario) ?? timeline?.cases[0];
  return (
    <main className="sx-shell mx-auto max-w-3xl px-4 py-8">
      <Link to={crewPath + "?crew_id=" + encodeURIComponent(crewId)} className="text-sm text-selection underline">Back to Crew console</Link>
      <header className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-600">Private Crew record · Synthetic training</p>
          <h1 className="mt-1 text-2xl font-semibold">Medical</h1>
          {response && <p className="mt-1 text-sm text-slate-700">Mission T+{missionTime(response.mission_s)} · {crewId}</p>}
        </div>
        <button type="button" className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm" onClick={() => setRefresh(n => n + 1)}>Refresh record</button>
      </header>
      {failed && <p role="alert" className="mt-4 text-sm text-red-800">Could not refresh the private Medical record.</p>}
      {!failed && !response && <p role="status" className="mt-4 text-sm">Loading Medical record…</p>}
      {response && !entry && <p role="status" className="mt-4 text-sm">No authored observations for this astronaut in this run.</p>}
      {entry && <section className="mt-5 rounded-lg border border-slate-200 bg-white p-4" aria-label="Private Medical timeline">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Training scenarios">
          {timeline.cases.map(item => <button key={item.id} type="button" aria-pressed={item.id === entry.id}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm aria-pressed:bg-sky-100" onClick={() => setScenario(item.id)}>{item.label}</button>)}
        </div>
        <h2 className="mt-4 font-semibold">Fictional history</h2>
        <ul className="mt-1 space-y-1 text-sm">{entry.history.map(note => <li key={note.kind}><strong>{note.kind === "allergy_note" ? "Allergy note" : "Medical history"}</strong> · {note.note}</li>)}</ul>
        <h2 className="mt-4 font-semibold">Case timeline</h2>
        {entry.events.length ? <ol className="mt-2 space-y-3 border-l border-sky-300 pl-3">{entry.events.map(event =>
          <li key={event.kind + event.at_s}>
            <p className="text-xs font-semibold text-slate-600">T+{missionTime(event.at_s)} · <span className="capitalize">{event.kind}</span> · <span className="capitalize">{event.quality}</span></p>
            <p className="mt-1 text-sm">{event.note}</p>
          </li>)}</ol> : <p className="mt-2 text-sm">Awaiting the first observation.</p>}
      </section>}
      {timeline?.genetics_note && <SpaceflightEvidence note={timeline.genetics_note} />}
      {Boolean(response?.sleep_archive?.length) && <SleepPhaseArchive phases={response.sleep_archive} />}
      {response && <section className="mt-5 rounded-lg border border-slate-200 bg-white p-4" aria-labelledby="medical-emergency-title">
        <h2 id="medical-emergency-title" className="font-semibold">Emergency training</h2>
        {response.emergency && <p className="mt-2 text-sm">Current case · {response.emergency.status} · Responder {response.emergency.owner}</p>}
        <div className="mt-2 flex flex-wrap gap-4 text-sm text-selection underline">
          <Link to={crewPath + "/emergency?drill=chest_pain"}>Open chest-pain drill</Link>
          <Link to={crewPath + "/emergency?drill=collapse"}>Open collapse drill</Link>
        </div>
      </section>}
    </main>
  );
}

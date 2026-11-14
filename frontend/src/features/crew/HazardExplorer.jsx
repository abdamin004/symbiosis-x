import { useState } from "react";

/**
 * NASA HRP evidence navigation, not a diagnostic classification.
 * Source links are official NASA / CSA resource pages; metrics are product
 * touchpoints, not validated proxies for exposure or disease.
 */
const HAZARDS = [
  { id:"radiation", name:"Space radiation", symbol:"☢", metrics:"Archived RadLab instrument context", risk:"Radiation health risks", action:"Review archive provenance; individual exposure is not measured here.", source:"https://www.nasa.gov/hrp/hazards/", details:"CSA's CANS project measures neutron exposure separately; the RadLab example is not a neutron-specific or personal dose monitor.", extra:"https://www.asc-csa.gc.ca/eng/news/articles/2026/2026-02-26-monitoring-radiation-astronaut-health.asp" },
  { id:"isolation", name:"Isolation & confinement", symbol:"◉", metrics:"Mood, sleep and check-ins", risk:"Inadequate sleep, behavioral health and teamwork", action:"Use scheduled self-reports and discuss patterns with the designated crew responder.", source:"https://www.nasa.gov/hrp/risks/" },
  { id:"distance", name:"Distance from Earth", symbol:"⌁", metrics:"Onboard local emergency + delayed Ground view", risk:"Delayed access to support and medical assistance", action:"Initiate local response without waiting for a Ground acknowledgment.", source:"https://www.csa-asc.gc.ca/eng/iss/science/why-do-we-conduct-science-experiments-in-space.asp" },
  { id:"gravity", name:"Altered gravity", symbol:"↕", metrics:"Blood pressure, heart rate and activity context", risk:"Cardiovascular and sensorimotor adaptation", action:"Compare accepted readings with personal baseline; do not infer adaptation from a single sample.", source:"https://www.nasa.gov/hrp/risks/" },
  { id:"environment", name:"Hostile / closed environment", symbol:"≈", metrics:"Cabin CO₂, scrubber and separate crew observations", risk:"Environmental exposure and health-performance risks", action:"Assess cabin readings separately from personal vitals and follow approved onboard procedure.", source:"https://www.nasa.gov/hrp/hazards/" },
];

export default function HazardExplorer() {
  const [selected,setSelected] = useState("environment");
  const hazard = HAZARDS.find(item=>item.id === selected) ?? HAZARDS[0];
  return <section className="mt-6 rounded-xl border border-cyan-500/50 bg-slate-900 p-5 text-slate-100" data-testid="nasa-hazards">
    <p className="text-xs font-bold uppercase tracking-widest text-cyan-300">NASA Human Research Program</p>
    <h2 className="mt-2 text-xl font-bold">Five spaceflight hazards · what our system monitors</h2>
    <p className="mt-2 text-sm text-slate-300">Explore the scientific context of our seven indicators, spacecraft twin and local-first workflow. Associations are educational, not diagnostic rules.</p>
    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5" role="group" aria-label="Five spaceflight hazards">
      {HAZARDS.map(item=><button key={item.id} type="button" onClick={()=>setSelected(item.id)}
        aria-pressed={selected===item.id} className={selected===item.id?"rounded-lg border-2 border-cyan-300 bg-indigo-700 p-3 text-left text-sm font-semibold text-white":"rounded-lg border border-slate-500 bg-slate-800 p-3 text-left text-sm font-semibold text-white"}>
        <span aria-hidden="true" className="mr-2 text-lg">{item.symbol}</span>{item.name}
      </button>)}
    </div>
    <div className="mt-4 rounded-lg border border-indigo-400/40 bg-slate-800 p-4" role="region" aria-live="polite" aria-label="Selected hazard details">
      <h3 className="text-lg font-bold">{hazard.name}</h3>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-[140px_1fr]">
        <dt className="font-semibold text-cyan-300">Project signals</dt><dd>{hazard.metrics}</dd>
        <dt className="font-semibold text-cyan-300">NASA risk context</dt><dd>{hazard.risk}</dd>
        <dt className="font-semibold text-cyan-300">Next step</dt><dd>{hazard.action}</dd>
      </dl>
      {hazard.details && <p className="mt-3 text-sm text-amber-200">{hazard.details}</p>}
      <div className="mt-3 flex flex-wrap gap-4 text-sm">
        <a className="font-bold text-cyan-200 underline" href={hazard.source} rel="noreferrer" target="_blank">Official research source</a>
        {hazard.extra && <a className="font-bold text-cyan-200 underline" href={hazard.extra} rel="noreferrer" target="_blank">CSA neutron monitoring</a>}
      </div>
    </div>
    <details className="mt-4 rounded-lg border border-slate-500 bg-slate-800 p-4">
      <summary className="cursor-pointer font-bold">NASA and CSA research behind the demo</summary>
      <ul className="mt-3 grid gap-3 text-sm">
        <li><strong>ARCHeR · Artemis II</strong> — astronaut movement, sleep, cognition and well-being. <a className="text-cyan-200 underline" href="https://www.nasa.gov/general/artemis-ii-crew-both-subjects-and-scientists-in-nasa-deep-space-research/" target="_blank" rel="noreferrer">NASA study overview</a></li>
        <li><strong>Artemis II Standard Measures</strong> — comparable physiological observations across multiple human systems. <a className="text-cyan-200 underline" href="https://www.nasa.gov/reference/artemis-ii-standard-measures/" target="_blank" rel="noreferrer">NASA study</a></li>
        <li><strong>Tempus Pro</strong> — a historical NASA investigation of telemedicine devices in space, relevant to remote medical support, not a device integrated in our demo. <a className="text-cyan-200 underline" href="https://www.nasa.gov/hrp/ongoing-hrp-research/" target="_blank" rel="noreferrer">NASA HRP research catalog</a></li>
        <li><strong>CSA: Science in space</strong> — communication delays and medical independence, plus applications for people on Earth. <a className="text-cyan-200 underline" href="https://www.csa-asc.gc.ca/eng/iss/science/why-do-we-conduct-science-experiments-in-space.asp" target="_blank" rel="noreferrer">CSA research context</a></li>
      </ul>
      <p className="mt-3 text-xs text-slate-300">References motivate our design; no NASA clinical protocol, hardware integration or endorsement is claimed.</p>
    </details>
    <p className="mt-3 text-xs text-slate-300">Synthetic training product · environmental hazards and health findings are distinct. No live personal diagnosis or neutron data is claimed.</p>
  </section>;
}

// Scientific context only: hazards indicate relevant monitoring, not diagnostic inference.
const HAZARDS = [
  {
    name:"Space radiation",risk:"Long-duration radiation exposure",
    monitor:"Radiation context and dose records (not a medical diagnosis)",
    relation:"Radiation dose is tracked separately from health vitals. Neutrons require specialized measurement; absorbed-dose data alone do not quantify neutron exposure.",
    links:[["NASA · Five hazards","https://www.nasa.gov/hrp/hazards/"],["CSA · Neutron monitoring (CANS)","https://www.asc-csa.gc.ca/eng/news/articles/2026/2026-02-26-monitoring-radiation-astronaut-health.asp"]],
  },
  {
    name:"Isolation & confinement",risk:"Sleep and behavioral performance",
    monitor:"Sleep duration, mood self-report and routine check-ins",
    relation:"Self-reports and trends can prompt review. They cannot diagnose psychiatric conditions.",
    links:[["NASA · ARCHeR","https://www.nasa.gov/reference/archer/"],["NASA · Spaceflight risks","https://www.nasa.gov/hrp/risks/"]],
  },
  {
    name:"Distance from Earth",risk:"Delayed medical support",
    monitor:"Onboard emergency response, private Crew assessment, delayed Ground relay",
    relation:"Crew can initiate a local response without waiting for delayed communications with Earth.",
    links:[["NASA · Five hazards","https://www.nasa.gov/hrp/hazards/"],["NASA · Tempus Pro (simulated medical scenario)","https://www.nasa.gov/reference/tempus-pro/"],["CSA · Communications and emergency care","https://www.asc-csa.gc.ca/eng/iss/science/why-do-we-conduct-science-experiments-in-space.asp"]],
  },
  {
    name:"Altered gravity",risk:"Cardiovascular and sensorimotor adaptation",
    monitor:"Heart rate, blood pressure, activity context and reported symptoms",
    relation:"Measurements are contextual indicators; the system does not infer a specific gravity-induced illness.",
    links:[["NASA · Spaceflight risks","https://www.nasa.gov/hrp/risks/"],["NASA · Standard Measures","https://www.nasa.gov/reference/standard-measures/"]],
  },
  {
    name:"Hostile / closed environments",risk:"Cabin air quality and life support",
    monitor:"Cabin CO₂, power, scrubber observations and Crew status",
    relation:"Environmental alerts and health measurements remain separate evidence sources; correlation does not establish causation.",
    links:[["NASA · Five hazards","https://www.nasa.gov/hrp/hazards/"]],
  },
];
export default function SpaceflightHazards() {
  return (
    <section className="mt-6 rounded-xl border border-cyan-500/50 bg-slate-900 p-4 text-slate-100" data-testid="spaceflight-hazards" aria-labelledby="hazards-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-cyan-300">NASA Human Research Program</p>
          <h2 className="mt-1 text-xl font-bold" id="hazards-title">The five human spaceflight hazards</h2>
        </div>
        <a className="text-sm font-semibold text-cyan-200 underline" href="https://www.nasa.gov/hrp/hazards/" target="_blank" rel="noreferrer">NASA official source</a>
      </div>
      <p className="mt-2 text-sm text-slate-300">Explore why our health indicators matter. These are science-backed monitoring associations, not algorithms that diagnose diseases or exposure causes.</p>
      <div className="mt-4 grid gap-2 md:grid-cols-2">
        {HAZARDS.map((hazard,index)=><details key={hazard.name} className="rounded-lg border border-slate-600 bg-slate-800/70 p-3" data-testid={"hazard-"+index}>
          <summary className="cursor-pointer text-sm font-semibold">{index+1}. {hazard.name}</summary>
          <div className="mt-3 space-y-2 text-sm">
            <p><strong>Related risk:</strong> {hazard.risk}</p>
            <p><strong>Relevant monitoring:</strong> {hazard.monitor}</p>
            <p className="text-slate-300">{hazard.relation}</p>
            <p className="flex flex-wrap gap-3">{hazard.links.map(([name,url])=><a key={url} href={url} target="_blank" rel="noreferrer" className="text-cyan-200 underline">{name}</a>)}</p>
          </div>
        </details>)}
      </div>
      <p className="mt-3 text-xs text-slate-300">Earth impact: the CSA notes that space health studies can inform research on osteoporosis, cardiovascular disorders, diabetes and access to care. <a className="underline text-cyan-200" href="https://www.asc-csa.gc.ca/eng/iss/science/why-do-we-conduct-science-experiments-in-space.asp" target="_blank" rel="noreferrer">CSA explanation</a>.</p>
      <p className="mt-3 text-xs text-slate-300">Research context: <a className="underline text-cyan-200" href="https://www.nasa.gov/reference/standard-measures/" target="_blank" rel="noreferrer">NASA Standard Measures</a> collects sleep reports and wrist-sensor activity; <a href="https://www.nasa.gov/reference/archer/" target="_blank" rel="noreferrer" className="underline text-cyan-200">ARCHeR</a> investigates activity, sleep and well-being.</p>
    </section>
  );
}

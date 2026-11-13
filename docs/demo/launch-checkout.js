// Local Commander training exercise. The live golden run has its own clock and command gate.
function bindLaunchCheckout(config, {pauseReplay,onCanvas,onPlayback,resetCrew}) {
  const find = id => document.getElementById(id);
  const storageKey = "sx:" + config.id + ":v" + config.version;
  const fresh = () => ({time:0,jobs:{},hold:false,armed:null,ignition:null,separation:null,insertion:null,aborted:false,phasing:null,capture:null,retreat:null,approachHeld:false,sealAt:null,pressureAt:null,hatchAt:null,transferAt:null,researchAt:null,
    departedAt:null,deorbitAt:null,landedAt:null,recoveredAt:null});
  const ascent = config.ascent;
  const rendezvous = config.rendezvous;
  const docking = config.docking;
  const returnPlan = config.return;
  let replay = false;
  let ascentTimer = null;
  let playback = null;
  const tick = ascent.tick_s;
  const countdown = config.sequence.countdown_s;
  let state = fresh();
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (saved) state = {...fresh(),...saved};
  } catch {
    // A local storage restriction still permits a session-only run.
  }
  function persist() {
    try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch {}
  }
  function ready() {
    return config.jobs.every(job => state.jobs[job.id]?.due <= state.time);
  }
  function flightState() {
    if (state.aborted) return {phase:"Ascent aborted",next:"Exercise ended",terminal:true};
    if (state.ignition === null) {
      const counting = state.armed !== null && state.time < state.armed+countdown;
      const jobsRunning = config.jobs.some(job=>state.jobs[job.id]?.due>state.time);
      let next = "Assign crew checks";
      if (state.hold) next = "Release the launch hold";
      else if (ready()) next = state.armed === null ? "Arm countdown" : counting ? "Advance countdown · " + (state.armed+countdown-state.time) + " s remaining" : "Commit liftoff";
      return {phase:state.hold ? "Launch held" : counting ? "Countdown armed" : "Launchpad",
        next,advance:jobsRunning || (counting && !state.hold)};
    }
    if (state.separation === null) {
      const burn = state.time - state.ignition;
      if (burn >= ascent.separation_deadline_s) return {phase:"Separation window missed",next:"Abort ascent"};
      if (burn < ascent.burn_s) return {phase:"Booster ascent",next:"Booster burnout",advance:true};
      return {phase:"Booster burnout",next:"Separate booster",advance:true,separate:true};
    }
    const coastTime = (state.insertion ?? state.time)-state.separation;
    const coast = ascent.coast.find(sample=>sample.seconds===coastTime);
    if (state.insertion !== null) return orbitalState(coast.after_burn);
    if (coastTime >= ascent.coast_limit_s || coast.reserve < ascent.insertion_cost+ascent.minimum_reserve)
      return {phase:"Insertion held · low reserve",next:"Abort ascent",reserve:coast.reserve};
    return {phase:"Upper stage coast",next:"Commit orbital insertion",advance:true,
      insert:coast.can_insert,reserve:coast.reserve};
  }
  function orbitalState(reserve) {
    if (state.retreat !== null) return {phase:"Station approach ended",next:"Safe orbit",
      reserve:reserve-(state.phasing === null ? 0 : rendezvous.phasing_cost),terminal:true,orbit:true};
    if (state.phasing === null) {
      const canPhase = reserve >= rendezvous.phasing_cost+rendezvous.retreat_reserve;
      return {phase:"Stable orbit",next:canPhase ? "Commit phasing" : "Approach held · reserve below minimum",
        reserve,orbit:true,phaseBurn:canPhase};
    }
    const remaining = reserve-rendezvous.phasing_cost;
    const elapsed = (state.capture ?? state.time)-state.phasing;
    const sample = rendezvous.approach.find(point=>point.seconds===elapsed);
    if (state.capture !== null) {
      return {reserve:remaining-(state.deorbitAt === null ? 0 : returnPlan.reserve_cost),orbit:true,sample,...dockingState()};
    }
    return {
      phase:state.approachHeld ? "Approach held" : sample.state,
      next:sample.expired ? "Retreat to safe orbit" : sample.capture ? "Capture or retreat" : "Advance approach",
      reserve:remaining,orbit:true,sample,
      advance:!state.approachHeld && !sample.expired,
      capture:!state.approachHeld && sample.capture,
    };
  }
  function evidenceStatus(observedAt, reading) {
    if (observedAt === null || observedAt < state.capture) return "Unknown";
    const age = state.time-observedAt;
    if (age >= docking.evidence_valid_s) return "Expired · recheck required";
    return reading + " · " + missionStamp(observedAt);
  }

  function dockingState() {
    const seal = evidenceStatus(state.sealAt,docking.seal);
    const pressure = evidenceStatus(state.pressureAt,docking.pressure);
    if (state.transferAt !== null) return {...returnState(),seal,pressure};
    if (state.hatchAt !== null) return {phase:"Transfer authorized",next:"Hand off the research kit",seal,pressure};
    const canOpen = seal.startsWith("Verified") && pressure.startsWith("Matched");
    return {phase:"Station captured",next:canOpen ? "Commander can open the hatch" : "Verify seal and pressure",
      advance:true,canOpen,seal,pressure};
  }

  function returnState() {
    if (state.recoveredAt !== null) return {phase:"Crew recovered on Earth",next:"Mission complete",terminal:true};
    if (state.landedAt !== null) return {phase:"Capsule landed",next:"Confirm crew recovery"};
    if (state.deorbitAt !== null) {
      const elapsed = state.time-state.deorbitAt;
      if (elapsed >= returnPlan.entry_s+returnPlan.descent_s) {
        return {phase:"Landing zone reached",next:"Confirm landing"};
      }
      return elapsed >= returnPlan.entry_s
        ? {phase:"Capsule descent",next:"Reach landing zone",advance:true}
        : {phase:"Atmospheric entry",next:"Complete entry",advance:true};
    }
    if (state.departedAt !== null) return {phase:"Return capsule in orbit",next:"Commit deorbit"};
    if (state.researchAt === null) return {phase:"Research kit transferred",next:"Assign Sana to station research"};
    if (state.time < state.researchAt+returnPlan.research_s) {
      return {phase:"Station research",next:"Complete Sana’s sampling run",advance:true};
    }
    return {phase:"Station research complete",next:"Seal hatch and board the return capsule"};
  }

  function canvasState(flight) {
    let frameIndex = 0;
    let phaseStarted = state.insertion;
    let site = "Earth orbit";
    let dock = "Hatch secured";
    let visual = "outbound";
    if (state.landedAt !== null) {
      frameIndex = 10;
      phaseStarted = state.landedAt;
      site = "Earth landing zone";
      visual = "landed";
      dock = "Landing complete";
    } else if (state.departedAt !== null) {
      frameIndex = 9;
      phaseStarted = state.departedAt;
      site = "Earth return trajectory";
      visual = state.deorbitAt === null ? "return" : "entry";
      dock = "Undocked · hatch secured";
    } else if (state.transferAt !== null) {
      frameIndex = state.researchAt === null ? 6 : 7;
      phaseStarted = state.researchAt ?? state.transferAt;
      site = "ISS laboratory";
      visual = "docked";
      dock = "Research kit on station";
    } else if (state.capture !== null) {
      frameIndex = 6;
      phaseStarted = state.capture;
      site = "ISS port";
      visual = "docked";
      dock = state.hatchAt === null ? "Captured · hatch secured" : "Hatch open";
    } else if (state.phasing !== null && state.retreat === null) {
      frameIndex = 5;
      phaseStarted = state.phasing;
      site = "ISS approach";
      visual = "approach";
      dock = "Approach · hatch secured";
    }
    const phases = {5:"Approach",6:"Docked",7:"Station research",9:"Return transit",10:"Recovery"};
    return {time:state.time,phaseStarted,frameIndex,visual,advance:Boolean(flight.advance),frame:{
      phase:phases[frameIndex] ?? "Outbound",
      label:flight.phase,site,dock,
      vehicle:state.departedAt !== null ? "Asteria return capsule" : "Asteria",
      route:{5:5,6:6,7:6,9:7,10:8}[frameIndex] ?? 1,
    }};
  }

  function renderView() {
    const flight = flightState();
    const inOrbit = !replay && state.insertion !== null && !state.aborted;
    const controlsHome = find(inOrbit ? "mission-command-widget" : "pad-controls");
    const controls = find("launch-controls");
    if (controls.parentElement !== controlsHome) controlsHome.append(controls);
    find("stage").hidden = !replay && !inOrbit;
    find("launch-checkout").hidden = replay || inOrbit;
    if (!replay) render();
    onCanvas(inOrbit ? canvasState(flight) : null);
  }

  function advance() {
    if (!flightState().advance || state.ignition !== null && state.insertion === null) return;
    state.time += tick;
    persist();
    renderView();
    const flight = flightState();
    if (!flight.advance || flight.capture) stopPlayback();
  }

  function stopPlayback() {
    if (playback === null) return;
    clearInterval(playback);
    playback = null;
    onPlayback(false);
  }

  function togglePlayback() {
    if (playback !== null) {stopPlayback(); return;}
    if (!flightState().advance) return;
    playback = setInterval(advance,tick/4*1000);
    onPlayback(true);
  }

  function animateAscent() {
    if (ascentTimer !== null || state.ignition === null || state.insertion !== null || state.aborted || replay) return;
    ascentTimer = setTimeout(()=>{
      ascentTimer = null;
      const flight = flightState();
      if (flight.separate) state.separation = state.time;
      else if (flight.insert) state.insertion = state.time;
      else if (flight.advance) state.time += tick;
      else return;
      persist();
      renderView();
      animateAscent();
    },750);
  }

  function renderObjectives(flight) {
    const times = {
      checks:ready() ? Math.max(...config.jobs.map(job=>state.jobs[job.id].due)) : null,
      countdown:state.ignition,separation:state.separation,insertion:state.insertion,
      phasing:state.phasing,capture:state.capture,hatch:state.hatchAt,transfer:state.transferAt,
      research:state.researchAt !== null && state.time >= state.researchAt+returnPlan.research_s
        ? state.researchAt+returnPlan.research_s : null,
      departure:state.departedAt,deorbit:state.deorbitAt,landing:state.landedAt,return:state.recoveredAt,
    };
    let nextFound = false;
    for (const objective of config.sequence.objectives) {
      const {label,badge,row} = objectiveRows.get(objective.id);
      const actual = times[objective.id];
      let status = "Upcoming";
      if (actual != null) status = "Verified · " + missionStamp(actual);
      else if (objective.planned_s === null) status = "Follow-on phase";
      else if (!nextFound) {
        const held = state.hold || state.approachHeld || flight.phase.includes("held") || flight.phase.includes("missed");
        status = flight.terminal ? "Incomplete" : held ? "Held" : "Next";
        nextFound = true;
      }
      row.dataset.status = status.split(" ")[0].toLowerCase();
      label.textContent = objective.label;
      badge.textContent = (objective.planned_s === null ? "" : "Plan "+missionStamp(objective.planned_s)+" · ") + status;
    }
    find("mission-objective-next").textContent = flight.phase + " · " + flight.next;
  }

  function missionStamp(seconds) {
    return "T+" + Math.floor(seconds/60) + ":" + String(seconds%60).padStart(2,"0");
  }
  function render() {
    find("launch-time").textContent = Math.floor(state.time / 60) + ":" + String(state.time % 60).padStart(2, "0");
    const flight = flightState();
    find("launch-status").textContent = flight.phase;
    find("launch-next").textContent = flight.next;
    find("launch-reserve").textContent = flight.reserve === undefined ? "Upper stage standby" : flight.reserve + " game units";
    const scene = find("launch-scene");
    const elapsed = state.ignition === null ? 0 : state.time-state.ignition;
    scene.dataset.phase = state.aborted ? "abort" : flight.orbit ? "orbit" : state.separation !== null ? "upper" : state.ignition === null ? "pad" : "ascent";
    scene.setAttribute("aria-label", "Asteria · " + flight.phase);
    scene.style.setProperty("--climb", Math.min(scene.clientHeight*.19, elapsed*2.1)+"px");
    scene.dataset.separated = String(state.separation !== null);
    renderObjectives(flight);
    find("launch-stack").dataset.ignited = String(flight.phase === "Booster ascent");
    find("launch-stack").querySelector("[data-stage=booster]").hidden = state.separation !== null;
    find("launch-go").hidden = state.ignition !== null;
    find("launch-arm").hidden = state.ignition !== null || state.armed !== null;
    find("launch-arm").disabled = state.hold || !ready();
    find("launch-go").disabled = state.hold || !ready() || state.armed === null || state.time < state.armed+countdown;
    find("launch-step").disabled = !flight.advance || state.ignition !== null && state.insertion === null;
    find("launch-crew-checks").hidden = state.ignition !== null;
    find("launch-research").hidden = state.transferAt === null || state.researchAt !== null;
    find("launch-depart").hidden = state.researchAt === null || state.time < state.researchAt+returnPlan.research_s || state.departedAt !== null;
    find("launch-deorbit").hidden = state.departedAt === null || state.deorbitAt !== null;
    find("launch-deorbit").disabled = (flight.reserve ?? 0) < returnPlan.reserve_cost;
    find("launch-land").hidden = state.deorbitAt === null || state.time < state.deorbitAt+returnPlan.entry_s+returnPlan.descent_s || state.landedAt !== null;
    find("launch-recover").hidden = state.landedAt === null || state.recoveredAt !== null;
    find("launch-abort").hidden = state.ignition === null || flight.orbit || flight.terminal;
    find("launch-phasing").hidden = !flight.orbit || state.phasing !== null || flight.terminal;
    find("launch-phasing").disabled = !flight.phaseBurn;
    find("launch-approach-hold").hidden = !flight.sample || state.capture !== null || flight.terminal || flight.sample.expired;
    find("launch-approach-hold").textContent = state.approachHeld ? "Resume approach" : "Hold approach";
    find("launch-approach-hold").setAttribute("aria-pressed",String(state.approachHeld));
    find("launch-capture").hidden = !flight.sample || state.capture !== null || flight.terminal;
    find("launch-capture").disabled = !flight.capture;
    find("launch-retreat").hidden = !flight.orbit || state.capture !== null || flight.terminal;
    find("launch-approach").hidden = !flight.orbit || state.departedAt !== null;
    find("launch-range").textContent = flight.sample ? flight.sample.range + " game units" : "Awaiting phasing";
    find("launch-closing").textContent = flight.sample ? flight.sample.closing + " units/tick" : "—";
    find("launch-hatch").textContent = state.departedAt !== null ? "Secured for return" : state.hatchAt !== null ? "Open · Commander authorized"
      : state.capture !== null ? "Secured · verification required" : "Secured";
    find("launch-docking").hidden = state.capture === null;
    find("launch-seal").textContent = flight.seal ?? "Unknown";
    find("launch-pressure").textContent = flight.pressure ?? "Unknown";
    find("launch-custody").textContent = state.transferAt === null ? "On Asteria"
      : "At station · " + missionStamp(state.transferAt);
    const checking = state.capture !== null && state.hatchAt === null;
    find("launch-check-seal").hidden = !checking;
    find("launch-check-pressure").hidden = !checking;
    find("launch-open-hatch").hidden = !checking;
    find("launch-open-hatch").disabled = !flight.canOpen;
    find("launch-transfer").hidden = state.hatchAt === null || state.transferAt !== null;
    find("launch-track").value = flight.sample ? 100-flight.sample.range : 0;
    find("launch-hold").hidden = state.ignition !== null;
    find("launch-hold").textContent = state.hold ? "Release hold" : "Hold launch";
    find("launch-hold").setAttribute("aria-pressed", String(state.hold));
    find("launch-checklist").textContent = state.hold ? "Commander hold"
      : ready() ? "Crew checks verified" : "Waiting for crew checks";
    for (const job of config.jobs) {
      const record = state.jobs[job.id];
      const row = rows.get(job.id);
      row.assign.disabled = Boolean(record) || state.ignition !== null;
      row.status.textContent = !record ? "Awaiting assignment"
        : record.due <= state.time ? "Verified"
        : "In progress · " + (record.due-state.time) + " s";
    }
  }
  const rows = new Map();
  const objectiveRows = new Map();
  for (const objective of config.sequence.objectives) {
    const row = document.createElement("li");
    const label = document.createElement("strong");
    const badge = document.createElement("small");
    row.append(label,badge);
    find("mission-objective-list").append(row);
    objectiveRows.set(objective.id,{row,label,badge});
  }
  find("launch-title").textContent = config.title;
  find("launch-subtitle").textContent = config.vehicle;
  for (const stage of config.stages) {
    const item = document.createElement("li");
    item.className = "launch-stage";
    item.dataset.stage = stage.id;
    const name = document.createElement("strong");
    const detail = document.createElement("small");
    name.textContent = stage.name;
    detail.textContent = stage.detail;
    item.append(name,detail);
    find("launch-stack").append(item);
  }
  for (const job of config.jobs) {
    const row = document.createElement("li");
    const title = document.createElement("strong");
    const status = document.createElement("span");
    const assign = document.createElement("button");
    title.textContent = job.title;
    assign.type = "button";
    assign.textContent = "Assign " + job.crew.split(" ")[0];
    status.className = "checkout-job-status";
    const station = document.createElement("small");
    station.textContent = job.station + " · " + job.duration_s + " s";
    assign.addEventListener("click", () => {
      if (state.jobs[job.id] || state.ignition !== null) return;
      state.jobs[job.id] = {due:state.time + job.duration_s};
      persist();
      render();
    });
    row.append(title,station,status,assign);
    rows.set(job.id,{status,assign});
    find("launch-jobs").append(row);
  }
  function openMissions() {
    pauseReplay();
    stopPlayback();
    find("mission-menu").showModal();
  }

  function showView(showReplay, writeHistory = false) {
    for (const dialog of [find("mission-menu"), find("mission-objectives")]) {
      if (dialog.open) dialog.close();
    }
    pauseReplay();
    stopPlayback();
    clearTimeout(ascentTimer);
    ascentTimer = null;
    replay = showReplay;
    renderView();
    animateAscent();
    if (writeHistory && (new URLSearchParams(location.search).get("view") === "replay") !== replay) {
      const url = new URL(location.href);
      if (replay) url.searchParams.set("view", "replay");
      else url.searchParams.delete("view");
      history.pushState(null, "", url);
    }
  }

  function openObjectives() {
    pauseReplay();
    stopPlayback();
    render();
    find("mission-objectives").showModal();
  }

  for (const id of ["show-missions","launch-open-missions"]) find(id).addEventListener("click",openMissions);
  for (const id of ["open-checkout","objective-open-launch"]) find(id).addEventListener("click",()=>showView(false,true));
  for (const id of ["show-objectives","launch-open-objectives"]) find(id).addEventListener("click",openObjectives);
  find("open-flight-replay").addEventListener("click",()=>showView(true,true));
  const syncView = () => showView(new URLSearchParams(location.search).get("view") === "replay");
  window.addEventListener("popstate",syncView);
  queueMicrotask(syncView);
  find("launch-arm").addEventListener("click",()=>{
    if (state.hold || !ready() || state.armed !== null || state.ignition !== null) return;
    state.armed = state.time;
    persist();
    render();
  });
  find("launch-step").addEventListener("click", advance);
  find("launch-hold").addEventListener("click", () => {
    if (state.ignition !== null) return;
    state.hold = !state.hold;
    persist();
    render();
  });
  find("launch-go").addEventListener("click", () => {
    if (find("launch-go").disabled || state.ignition !== null) return;
    state.ignition = state.time;
    persist();
    renderView();
    animateAscent();
  });
  find("launch-abort").addEventListener("click", () => {
    if (flightState().terminal || state.ignition === null) return;
    state.aborted = true;
    persist();
    renderView();
  });
  find("launch-phasing").addEventListener("click", () => {
    if (!flightState().phaseBurn) return;
    state.phasing = state.time;
    persist();
    renderView();
  });
  find("launch-approach-hold").addEventListener("click", () => {
    if (find("launch-approach-hold").hidden) return;
    state.approachHeld = !state.approachHeld;
    if (state.approachHeld) stopPlayback();
    persist();
    renderView();
  });
  find("launch-capture").addEventListener("click", () => {
    if (!flightState().capture) return;
    stopPlayback();
    state.capture = state.time;
    persist();
    renderView();
  });
  find("launch-retreat").addEventListener("click", () => {
    const flight = flightState();
    if (!flight.orbit || state.capture !== null || flight.terminal) return;
    stopPlayback();
    state.retreat = state.time;
    persist();
    renderView();
  });
  for (const [button,field] of [["launch-check-seal","sealAt"],["launch-check-pressure","pressureAt"]]) {
    find(button).addEventListener("click", () => {
      if (state.capture === null || state.hatchAt !== null) return;
      state[field] = state.time;
      persist();
      render();
    });
  }
  find("launch-open-hatch").addEventListener("click", () => {
    if (state.capture === null || state.hatchAt !== null || !dockingState().canOpen) return;
    state.hatchAt = state.time;
    persist();
    renderView();
  });
  find("launch-transfer").addEventListener("click", () => {
    if (state.hatchAt === null || state.transferAt !== null) return;
    state.transferAt = state.time;
    persist();
    renderView();
  });
  for (const [button,field] of [
    ["launch-research","researchAt"],["launch-depart","departedAt"],["launch-deorbit","deorbitAt"],
    ["launch-land","landedAt"],["launch-recover","recoveredAt"],
  ]) {
    find(button).addEventListener("click", () => {
      if (find(button).hidden || find(button).disabled || state[field] !== null) return;
      stopPlayback();
      state[field] = state.time;
      persist();
      renderView();
    });
  }

  function reset() {
    stopPlayback();
    clearTimeout(ascentTimer);
    ascentTimer = null;
    state = fresh();
    resetCrew();
    persist();
    renderView();
  }
  find("launch-reset").addEventListener("click",reset);
  return {advance,togglePlayback,reset};
}

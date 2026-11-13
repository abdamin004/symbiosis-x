// Local Commander training exercise. The live golden run has its own clock and command gate.
function bindLaunchCheckout(config, pauseReplay) {
  const find = id => document.getElementById(id);
  const storageKey = "sx:" + config.id + ":v" + config.version;
  const fresh = () => ({time:0,jobs:{},hold:false,armed:null,ignition:null,separation:null,insertion:null,aborted:false,phasing:null,capture:null,retreat:null,approachHeld:false});
  const ascent = config.ascent;
  const rendezvous = config.rendezvous;
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
    if (state.capture !== null) return {phase:"Station captured",next:"Hatch secured · seal and pressure checks pending",
      reserve:remaining,terminal:true,orbit:true,sample};
    return {
      phase:state.approachHeld ? "Approach held" : sample.state,
      next:sample.expired ? "Retreat to safe orbit" : sample.capture ? "Capture or retreat" : "Advance approach",
      reserve:remaining,orbit:true,sample,
      advance:!state.approachHeld && !sample.expired,
      capture:!state.approachHeld && sample.capture,
    };
  }
  function renderObjectives(flight) {
    const times = {
      checks:ready() ? Math.max(...config.jobs.map(job=>state.jobs[job.id].due)) : null,
      countdown:state.ignition,separation:state.separation,insertion:state.insertion,
      phasing:state.phasing,capture:state.capture,
    };
    let nextFound = false;
    for (const objective of config.sequence.objectives) {
      const {label,badge,row} = objectiveRows.get(objective.id);
      const actual = times[objective.id];
      let status = "Upcoming";
      if (actual != null) status = "Verified · " + missionStamp(actual);
      else if (objective.planned_s === null) status = "Follow-on phase";
      else if (!nextFound) {
        const canAdvance = flight.advance || flight.separate || flight.insert || flight.phaseBurn || flight.capture;
        const held = state.hold || state.approachHeld || (state.ignition !== null && !canAdvance);
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
    scene.style.setProperty("--climb", Math.min(95,elapsed*2.1)+"px");
    scene.dataset.separated = String(state.separation !== null);
    renderObjectives(flight);
    find("launch-stack").dataset.ignited = String(flight.phase === "Booster ascent");
    find("launch-stack").querySelector("[data-stage=booster]").hidden = state.separation !== null;
    find("launch-go").hidden = state.ignition !== null;
    find("launch-arm").hidden = state.ignition !== null || state.armed !== null;
    find("launch-arm").disabled = state.hold || !ready();
    find("launch-go").disabled = state.hold || !ready() || state.armed === null || state.time < state.armed+countdown;
    find("launch-step").disabled = !flight.advance;
    find("launch-separate").hidden = state.ignition === null || state.separation !== null || flight.terminal;
    find("launch-separate").disabled = !flight.separate;
    find("launch-insert").hidden = state.separation === null || flight.orbit || flight.terminal;
    find("launch-insert").disabled = !flight.insert;
    find("launch-abort").hidden = state.ignition === null || flight.orbit || flight.terminal;
    find("launch-phasing").hidden = !flight.orbit || state.phasing !== null || flight.terminal;
    find("launch-phasing").disabled = !flight.phaseBurn;
    find("launch-approach-hold").hidden = !flight.sample || flight.terminal || flight.sample.expired;
    find("launch-approach-hold").textContent = state.approachHeld ? "Resume approach" : "Hold approach";
    find("launch-approach-hold").setAttribute("aria-pressed",String(state.approachHeld));
    find("launch-capture").hidden = !flight.sample || flight.terminal;
    find("launch-capture").disabled = !flight.capture;
    find("launch-retreat").hidden = !flight.orbit || flight.terminal;
    find("launch-approach").hidden = !flight.orbit;
    find("launch-range").textContent = flight.sample ? flight.sample.range + " game units" : "Awaiting phasing";
    find("launch-closing").textContent = flight.sample ? flight.sample.closing + " units/tick" : "—";
    find("launch-hatch").textContent = state.capture !== null ? "Secured · verification pending" : "Secured";
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
  find("show-missions").addEventListener("click", () => {
    pauseReplay();
    find("mission-menu").showModal();
  });
  function openCheckout() {
    if (find("mission-menu").open) find("mission-menu").close();
    if (find("mission-objectives").open) find("mission-objectives").close();
    pauseReplay();
    render();
    find("launch-checkout").showModal();
  }
  find("open-checkout").addEventListener("click",openCheckout);
  find("objective-open-launch").addEventListener("click",openCheckout);
  find("show-objectives").addEventListener("click",()=>{
    pauseReplay();
    render();
    find("mission-objectives").showModal();
  });
  find("launch-open-objectives").addEventListener("click",()=>{
    find("launch-checkout").close();
    render();
    find("mission-objectives").showModal();
  });
  find("launch-arm").addEventListener("click",()=>{
    if (state.hold || !ready() || state.armed !== null || state.ignition !== null) return;
    state.armed = state.time;
    persist();
    render();
  });
  find("launch-step").addEventListener("click", () => {
    if (find("launch-step").disabled) return;
    state.time += tick;
    persist();
    render();
  });
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
    render();
  });
  find("launch-separate").addEventListener("click", () => {
    if (!flightState().separate) return;
    state.separation = state.time;
    persist();
    render();
  });
  find("launch-insert").addEventListener("click", () => {
    if (!flightState().insert) return;
    state.insertion = state.time;
    persist();
    render();
  });
  find("launch-abort").addEventListener("click", () => {
    if (flightState().terminal || state.ignition === null) return;
    state.aborted = true;
    persist();
    render();
  });
  find("launch-phasing").addEventListener("click", () => {
    if (!flightState().phaseBurn) return;
    state.phasing = state.time;
    persist();
    render();
  });
  find("launch-approach-hold").addEventListener("click", () => {
    if (find("launch-approach-hold").hidden) return;
    state.approachHeld = !state.approachHeld;
    persist();
    render();
  });
  find("launch-capture").addEventListener("click", () => {
    if (!flightState().capture) return;
    state.capture = state.time;
    persist();
    render();
  });
  find("launch-retreat").addEventListener("click", () => {
    const flight = flightState();
    if (!flight.orbit || flight.terminal) return;
    state.retreat = state.time;
    persist();
    render();
  });
  find("launch-reset").addEventListener("click", () => {
    state = fresh();
    persist();
    render();
  });
}

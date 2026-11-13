// Local Commander training exercise. The live golden run has its own clock and command gate.
function bindLaunchCheckout(config, pauseReplay) {
  const find = id => document.getElementById(id);
  const storageKey = "sx:" + config.id + ":v" + config.version;
  const fresh = () => ({time:0,jobs:{},hold:false,ignition:null,separation:null,insertion:null,aborted:false});
  const ascent = config.ascent;
  const tick = ascent.tick_s;
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
    if (state.ignition === null) return {
      phase:"Launchpad",next:"First-stage ignition",advance:config.jobs.some(job=>state.jobs[job.id]?.due>state.time),
    };
    if (state.separation === null) {
      const burn = state.time - state.ignition;
      if (burn >= ascent.separation_deadline_s) return {phase:"Separation window missed",next:"Abort ascent"};
      if (burn < ascent.burn_s) return {phase:"Booster ascent",next:"Booster burnout",advance:true};
      return {phase:"Booster burnout",next:"Separate booster",advance:true,separate:true};
    }
    const coastTime = (state.insertion ?? state.time)-state.separation;
    const coast = ascent.coast.find(sample=>sample.seconds===coastTime);
    if (state.insertion !== null) return {phase:"Stable orbit",next:"Orbital checkout",reserve:coast.after_burn,terminal:true};
    if (coastTime >= ascent.coast_limit_s || coast.reserve < ascent.insertion_cost+ascent.minimum_reserve)
      return {phase:"Insertion held · low reserve",next:"Abort ascent",reserve:coast.reserve};
    return {phase:"Upper stage coast",next:"Commit orbital insertion",advance:true,
      insert:coast.can_insert,reserve:coast.reserve};
  }
  function render() {
    find("launch-time").textContent = Math.floor(state.time / 60) + ":" + String(state.time % 60).padStart(2, "0");
    const flight = flightState();
    find("launch-status").textContent = flight.phase;
    find("launch-next").textContent = flight.next;
    find("launch-reserve").textContent = flight.reserve === undefined ? "Upper stage standby" : flight.reserve + " game units";
    find("launch-stack").dataset.ignited = String(flight.phase === "Booster ascent");
    find("launch-stack").querySelector("[data-stage=booster]").hidden = state.separation !== null;
    find("launch-go").hidden = state.ignition !== null;
    find("launch-go").disabled = state.hold || !ready();
    find("launch-step").disabled = !flight.advance;
    find("launch-separate").hidden = state.ignition === null || state.separation !== null || flight.terminal;
    find("launch-separate").disabled = !flight.separate;
    find("launch-insert").hidden = state.separation === null || flight.terminal;
    find("launch-insert").disabled = !flight.insert;
    find("launch-abort").hidden = state.ignition === null || flight.terminal;
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
  find("open-checkout").addEventListener("click", () => {
    find("mission-menu").close();
    render();
    find("launch-checkout").showModal();
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
    if (state.hold || !ready() || state.ignition !== null) return;
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
  find("launch-reset").addEventListener("click", () => {
    state = fresh();
    persist();
    render();
  });
}

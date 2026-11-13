// Local Commander training exercise. The live golden run has its own clock and command gate.
function bindLaunchCheckout(config, pauseReplay) {
  const find = id => document.getElementById(id);
  const storageKey = "sx:" + config.id + ":v" + config.version;
  const fresh = () => ({time: 0, jobs: {}, hold: false, ignition: null});
  const tick = 15;
  let state = fresh();
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (saved) state = saved;
  } catch {
    // A local storage restriction still permits a session-only run.
  }
  function persist() {
    try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch {}
  }
  function ready() {
    return config.jobs.every(job => state.jobs[job.id]?.due <= state.time);
  }
  function render() {
    find("launch-time").textContent = Math.floor(state.time / 60) + ":" + String(state.time % 60).padStart(2, "0");
    find("launch-status").textContent = state.ignition !== null ? "Ignition confirmed · checkout complete"
      : state.hold ? "Commander hold" : ready() ? "All checks complete · go available" : "Waiting for crew checks";
    find("launch-stack").dataset.ignited = String(state.ignition !== null);
    find("launch-go").disabled = state.hold || !ready() || state.ignition !== null;
    find("launch-step").disabled = state.ignition !== null ||
      !config.jobs.some(job => state.jobs[job.id]?.due > state.time);
    find("launch-hold").disabled = state.ignition !== null;
    find("launch-hold").textContent = state.hold ? "Release hold" : "Hold launch";
    find("launch-hold").setAttribute("aria-pressed", String(state.hold));
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
  find("launch-reset").addEventListener("click", () => {
    state = fresh();
    persist();
    render();
  });
}

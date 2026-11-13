// Local Commander training exercise. The live golden run has its own clock and command gate.
function bindLaunchCheckout(config, {pauseReplay,onCanvas,onPlayback,resetCrew,crew}) {
  const find = id => document.getElementById(id);
  const canvas = find("launch-scene");
  const scene = createLaunchScene(canvas);
  const padLabel = canvas.getAttribute("aria-label");
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const storageKey = "sx:" + config.id + ":v" + config.version;
  const fresh = () => ({time:0,jobs:{},hold:false,startupAt:null,armed:null,ignition:null,separation:null,insertion:null,aborted:false,phasing:null,capture:null,retreat:null,approachHeld:false,sealAt:null,pressureAt:null,hatchAt:null,transferAt:null,researchAt:null,
    departedAt:null,deorbitAt:null,landedAt:null,recoveredAt:null});
  const ascent = config.ascent;
  const rendezvous = config.rendezvous;
  const docking = config.docking;
  const returnPlan = config.return;
  let view = "menu";
  let ascentTimer = null;
  let playback = null;
  let speed = 1;
  let tickStarted = 0;
  let padAnimation = null;
  let orbitConfirmation = null;
  let orbitPreviewStarted = 0;
  let orbitPreviewUntil = 0;
  const skyOffset = config.pad.daylight_offset_s;
  const skyCycle = config.pad.daylight_cycle_s;
  const insertion = config.ascent.insertion_profile;
  function lightAt(time) {
    const angle = ((time+skyOffset)%skyCycle)/skyCycle*2*Math.PI;
    const altitude = Math.sin(angle);
    return {angle,altitude,light:Math.max(0,Math.min(1,(altitude+.12)*1.8))};
  }
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
  function systemsReady() {
    return state.ignition !== null || state.startupAt !== null && state.time >= state.startupAt+config.pad.startup_s;
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
      else if (!systemsReady()) next = state.startupAt === null ? "Start ship systems" : "Wait for systems to come online";
      else if (ready()) next = state.armed === null ? "Arm countdown" : counting ? "Advance countdown · " + (state.armed+countdown-state.time) + " s remaining" : "Launch";
      return {phase:state.hold ? "Launch held" : counting ? "Countdown armed" : "Launchpad",
        next,advance:jobsRunning || (counting && !state.hold),pad:true};
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

  function renderView(animate = true) {
    const launch = view === "launch";
    const menu = view === "menu";
    const inOrbit = launch && state.insertion !== null && !state.aborted && performance.now() >= orbitPreviewUntil;
    const controlsHome = find(inOrbit ? "mission-command-widget" : "pad-controls");
    const controls = find("launch-controls");
    if (controls.parentElement !== controlsHome) controlsHome.append(controls);
    find("stage").hidden = view !== "replay" && !inOrbit;
    find("launch-page").hidden = view === "replay" || inOrbit;
    find("game-menu").hidden = !menu;
    find("pad-transport").hidden = !launch || inOrbit || state.ignition !== null;
    find("pad-controls").hidden = !launch || inOrbit;
    find("launch-open-missions").hidden = !launch;
    find("launch-open-objectives").hidden = !launch;
    find("launch-field").dataset.view = view;
    if (menu) {
      canvas.dataset.phase = "pad";
      canvas.setAttribute("aria-label", padLabel);
      scene.show({phase:"pad",elapsed:0,separated:false,burning:false},false);
      const started = state.time > 0 || Object.keys(state.jobs).length > 0 || state.hold;
      find("launch-start-label").textContent = started ? "Resume mission" : "Start mission";
    }
    if (launch) render(animate);
    onCanvas(inOrbit ? canvasState(flightState()) : null);
  }

  function advance() {
    if (!canAdvance()) return;
    state.time += tick;
    persist();
    renderView();
    const flight = flightState();
    if ((!flight.pad && !flight.advance) || flight.capture) stopPlayback();
  }

  function canAdvance() {
    if (view !== "launch") return false;
    return state.ignition === null || state.insertion !== null && Boolean(flightState().advance);
  }
  function updatePadClock(time) {
    const light = lightAt(time);
    find("pad-clock").textContent = missionStamp(Math.floor(time));
    find("pad-light").textContent = light.altitude > .2 ? "Daylight" : light.altitude < -.2 ? "Night" : "Twilight";
    scene.setSky(light);
  }
  function stopPlayback() {
    if (playback === null) return;
    if (playback !== "pad") clearInterval(playback);
    playback = null;
    cancelAnimationFrame(padAnimation);
    find("pad-play-label").textContent = "Play";
    find("pad-play-icon").setAttribute("href","#hud-play");
    if (state.ignition === null) updatePadClock(state.time);
    onPlayback(false);
  }

  function togglePlayback() {
    if (playback !== null) {stopPlayback(); return;}
    if (!canAdvance()) return;
    if (state.ignition === null) {
      const frame = now => {
        const duration = tick/(4*speed)*1000;
        if (now-tickStarted >= duration) {
          tickStarted += duration;
          advance();
        }
        if (playback === null) return;
        updatePadClock(state.time + Math.min(tick,(now-tickStarted)*.004*speed));
        padAnimation = requestAnimationFrame(frame);
      };
      tickStarted = performance.now();
      playback = "pad";
      padAnimation = requestAnimationFrame(frame);
      find("pad-play-label").textContent = "Pause";
      find("pad-play-icon").setAttribute("href","#hud-pause");
    } else {
      playback = setInterval(advance,tick/4*1000);
      onPlayback(true);
    }
  }

  function animateAscent() {
    if (ascentTimer !== null || state.ignition === null || state.insertion !== null || state.aborted || view !== "launch") return;
    const liftoff = state.time === state.ignition;
    const delay = liftoff && !reducedMotion.matches ? 2700 : 880;
    ascentTimer = setTimeout(()=>{
      ascentTimer = null;
      const flight = flightState();
      if (flight.separate) state.separation = state.time;
      else if (flight.insert) {
        state.insertion = state.time;
        orbitPreviewStarted = performance.now();
        orbitPreviewUntil = orbitPreviewStarted + (reducedMotion.matches ? 0 : 2400);
        if (!reducedMotion.matches) orbitConfirmation = requestAnimationFrame(animateInsertion);
      }
      else if (flight.advance) state.time += tick;
      else return;
      persist();
      renderView();
      animateAscent();
    },delay);
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
  function render(animate = true) {
    if (state.ignition === null && playback !== "pad") updatePadClock(state.time);
    const startup = find("startup-status");
    startup.dataset.online = String(systemsReady());
    for (const status of startup.querySelectorAll("span")) {
      status.textContent = systemsReady() ? "Online" : state.startupAt === null ? "Off" : "Starting";
    }
    find("startup").disabled = state.startupAt !== null || state.ignition !== null;
    find("launch-systems").hidden = state.ignition !== null;
    find("launch-time").textContent = Math.floor(state.time / 60) + ":" + String(state.time % 60).padStart(2, "0");
    const flight = flightState();
    find("launch-status").textContent = flight.phase;
    find("launch-next").textContent = flight.next;
    find("launch-reserve").textContent = flight.reserve === undefined ? "Upper stage standby" : flight.reserve + " game units";
    if (!find("pad-controls").hidden) {
      const elapsed = state.ignition === null ? 0 : state.time-state.ignition;
      const phase = state.aborted ? "abort" : state.separation !== null ? "upper" : state.ignition === null ? "pad" : "ascent";
      canvas.dataset.phase = phase;
      canvas.setAttribute("aria-label", phase === "pad" ? padLabel : "Asteria · " + flight.phase);
      scene.show({phase,elapsed,separated:state.separation !== null,burning:elapsed<ascent.burn_s},animate);
    }
    renderObjectives(flight);
    const orbit = find("orbit-preview");
    orbit.hidden = state.separation === null || state.aborted ||
      (state.insertion !== null && performance.now() >= orbitPreviewUntil);
    if (!orbit.hidden) paintOrbit(orbit, state.insertion === null ? 0 : insertionProgress(performance.now()));
    find("launch-stack").dataset.ignited = String(flight.phase === "Booster ascent");
    find("launch-stack").querySelector("[data-stage=booster]").hidden = state.separation !== null;
    find("launch-go").hidden = state.ignition !== null;
    find("launch-arm").hidden = state.ignition !== null || state.armed !== null;
    find("launch-arm").disabled = state.hold || !systemsReady() || !ready();
    find("launch-go").disabled = state.hold || !systemsReady() || !ready() || state.armed === null || state.time < state.armed+countdown;
    find("launch-step").disabled = !canAdvance();
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
      row.assign.setAttribute("aria-pressed",String(Boolean(record)));
      row.assignedLabel.textContent = record ? "Assigned" : "Assign";
      row.assign.setAttribute("aria-label",(record ? "Assigned " : "Assign ") + job.crew.split(" ")[0]);
      row.status.textContent = !record ? "Awaiting assignment"
        : record.due <= state.time ? "Verified"
        : "In progress · " + (record.due-state.time) + " s";
    }
  }
  function insertionProgress(now) {
    return Math.max(0, Math.min(1, (now - orbitPreviewStarted) / 1200));
  }

  function animateInsertion(now) {
    if (now >= orbitPreviewUntil) {
      orbitConfirmation = null;
      renderView();
      return;
    }
    const orbit = find("orbit-preview");
    if (!orbit.hidden) paintOrbit(orbit, insertionProgress(now));
    orbitConfirmation = requestAnimationFrame(animateInsertion);
  }

  function paintOrbit(container, progress = 1) {
    const orbitCanvas = container.querySelector("canvas");
    const ctx = orbitCanvas.getContext("2d");
    const pe = Math.round(insertion.initial_periapsis_km + progress *
      (insertion.target_periapsis_km - insertion.initial_periapsis_km));
    const stable = progress === 1 && pe >= insertion.minimum_periapsis_km;
    container.querySelector("#orbit-ap").textContent = insertion.apoapsis_km + " km";
    container.querySelector("#orbit-pe").textContent = pe + " km";
    const status = container.querySelector("#orbit-status");
    const message = stable ? "Insertion raised periapsis · orbit confirmed"
      : state.insertion !== null ? "Insertion burn · raising periapsis" : "Coast trajectory · insertion needed";
    if (status.textContent !== message) status.textContent = message;
    ctx.clearRect(0,0,480,180);
    function ring(cx,cy,rx,ry,color,dashes=[]) {
      ctx.beginPath();
      ctx.ellipse(cx,cy,rx,ry,0,0,Math.PI*2);
      ctx.strokeStyle=color;
      ctx.setLineDash(dashes);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.fillStyle="#315f88";
    ctx.beginPath(); ctx.arc(240,90,52,0,Math.PI*2); ctx.fill();
    ring(240,90,147,68,"#a9d8ff",[6,5]);
    ring(268 - 28 * progress,90,119 + 28 * progress,39 + 29 * progress,
      stable ? "#96ebca" : "#f1b688");
    ctx.fillStyle="#f0f5ff";
    ctx.font="12px system-ui";
    ctx.fillText("AP",397,94);
    ctx.fillText("PE",123 - 53 * progress,94);
  }

  const rows = new Map();
  for (const name of ["Electrical bus","Hydraulics","Oxygen supply","CO₂ scrubber"]) {
    const row = document.createElement("li");
    const status = document.createElement("span");
    row.append(name,status);
    find("startup-status").append(row);
  }
  find("startup").addEventListener("click",()=>{
    if (state.startupAt !== null || state.ignition !== null) return;
    state.startupAt = state.time;
    persist();
    render();
  });
  find("pad-play").addEventListener("click",togglePlayback);
  find("pad-speed").addEventListener("click",()=>{
    speed = speed === 4 ? 1 : speed*2;
    tickStarted = performance.now();
    find("pad-speed").textContent = speed+"×";
  });
  for (const id of ["show-briefing","launch-briefing"]) find(id).addEventListener("click",()=>{
    stopPlayback();
    find("mission-briefing").showModal();
  });
  find("show-orbit").addEventListener("click",()=>{
    stopPlayback();
    const copy = find("orbit-preview").cloneNode(true);
    copy.removeAttribute("id");
    copy.hidden = false;
    paintOrbit(copy);
    for (const element of copy.querySelectorAll("[id]")) element.removeAttribute("id");
    find("orbit-dialog-content").replaceChildren(copy);
    find("orbit-dialog").showModal();
  });
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
    const assignee = crew.find(person=>person.name===job.crew);
    const assignedLabel = document.createElement("span");
    assignedLabel.textContent = "Assign";
    assign.className = "launch-assignee";
    assign.title = assignee.name + " · " + assignee.role + " · qualified for this check";
    assign.append(assignee.portrait(),assignedLabel," "+job.crew.split(" ")[0]);
    status.className = "checkout-job-status";
    const station = document.createElement("small");
    station.textContent = job.station + " · " + job.duration_s + " s. " + job.purpose;
    assign.addEventListener("click", () => {
      if (state.jobs[job.id] || state.ignition !== null) return;
      state.jobs[job.id] = {due:state.time + job.duration_s};
      persist();
      render();
    });
    row.append(title,station,status,assign);
    rows.set(job.id,{status,assign,assignedLabel});
    find("launch-jobs").append(row);
  }
  function currentView() {
    const route = new URLSearchParams(location.search).get("view");
    return route === "replay" || route === "launch" ? route : "menu";
  }

  function showView(next, navigate = false) {
    if (find("mission-objectives").open) find("mission-objectives").close();
    pauseReplay();
    stopPlayback();
    clearTimeout(ascentTimer);
    ascentTimer = null;
    view = next;
    renderView(false);
    animateAscent();
    if (navigate && currentView() !== view) {
      const url = new URL(location.href);
      if (view === "menu") url.searchParams.delete("view");
      else url.searchParams.set("view",view);
      history.pushState(null,"",url);
      const heading = view === "menu" ? "game-title" : find("stage").hidden ? "launch-title" : "show-missions";
      find(heading).focus({preventScroll:true});
      window.scrollTo(0,0);
    }
  }

  function openObjectives() {
    pauseReplay();
    stopPlayback();
    render();
    find("mission-objectives").showModal();
  }

  for (const id of ["show-missions","launch-open-missions"]) find(id).addEventListener("click",()=>showView("menu",true));
  for (const id of ["open-checkout","objective-open-launch"]) find(id).addEventListener("click",()=>showView("launch",true));
  for (const id of ["show-objectives","launch-open-objectives"]) find(id).addEventListener("click",openObjectives);
  find("open-flight-replay").addEventListener("click",()=>showView("replay",true));
  const syncView = () => showView(currentView());
  window.addEventListener("popstate",syncView);
  queueMicrotask(syncView);
  find("launch-arm").addEventListener("click",()=>{
    if (state.hold || !systemsReady() || !ready() || state.armed !== null || state.ignition !== null) return;
    state.armed = state.time;
    persist();
    render();
  });
  find("launch-step").addEventListener("click", advance);
  find("launch-hold").addEventListener("click", () => {
    if (state.ignition !== null) return;
    state.hold = !state.hold;
    if (state.hold) state.armed = null;
    persist();
    render();
  });
  find("launch-go").addEventListener("click", () => {
    if (find("launch-go").disabled || state.ignition !== null) return;
    stopPlayback();
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
    cancelAnimationFrame(orbitConfirmation);
    orbitConfirmation = null;
    orbitPreviewUntil = 0;
    state = fresh();
    resetCrew();
    persist();
    renderView();
  }
  find("launch-reset").addEventListener("click",reset);
  return {advance,togglePlayback,reset};
}

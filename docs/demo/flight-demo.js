// Presentation offsets use wall time. Flight commands still advance the mission clock
// through the same checkout, maneuver and docking gates as a manual run.
const flightDemoCues = [
  [0, "Systems and crew checkout", "startup"],
  [1, null, "assign-checks"],
  [2, null, 1], [3, null, 1], [4, null, 1],
  [5, "Range clear · countdown armed", "launch-arm"],
  [7, null, 1],
  [8, "Horizon liftoff", "launch-go"],
  [14, "Booster separation", "launch-separate"],
  [19, "Orbital insertion", "launch-insert"],
  [29, "Stable orbit · Sana’s health baseline", "crew-baseline"],
  [36, "Wearable quality · motion artifact", 1],
  [43, "Crew response · Noor checks on Sana", "crew-check"],
  [51, null, 1],
  [60, "Crew response · observation recorded", 1],
  [68, "Wearable quality · repeat sample accepted", 1],
  [74, "Coast to the ISS window", "close-twin", "launch-coast"],
  [79, "ISS transfer burn", "launch-phasing"],
  [89, "Transfer coast · engines off", "launch-coast"],
  [94, "Match station orbit", "launch-match"],
  [104, "ISS approach · closing range", "show-docking"],
  [108, null, 1], [113, null, 1], [118, null, 1],
  [122, "Docking · mechanical capture", "launch-capture"],
  [128, "Docking · verify seal and pressure", "launch-check-seal", "launch-check-pressure"],
  [134, "Hatch clearance and cargo handoff", "launch-open-hatch", "launch-transfer"],
  [141, "Sana collects paired research samples", "hide-docking", "launch-research"],
  [146, null, 1], [151, null, 1],
  [154, "Research archived", "launch-archive", "show-docking"],
  [160, "Undock and clear the ISS", "launch-depart"],
  [166, "Deorbit and atmospheric entry", "hide-docking", "launch-deorbit"],
  [169, null, 1], [172, null, 1],
  [173, "Capsule descent", 1],
  [176, null, 1],
  [177, "Capsule landed", "launch-land"],
  [180, "Crew recovered on Earth", "launch-recover"],
];

// Crew-only fixture for the timed presentation. Offsets are mission seconds
// since insertion, including the gap between observation and receipt.
const flightDemoCrew = "SIM-02";
function flightDemoWristband(crewId, time, insertion) {
  if (crewId !== flightDemoCrew) return null;
  const seconds = time - insertion;
  const held = seconds >= 15 && seconds < 60;
  const repeat = seconds >= 60;
  const accepted = {
    value: repeat ? 70 : 68, unit:"bpm", quality:"valid",
    observed_at_s:insertion + (repeat ? 55 : -5),
    received_at_s:insertion + (repeat ? 60 : 0),
  };
  const age = time - accepted.observed_at_s;
  return {source_id:"Synthetic demo · optical wristband", reading:{
    status:held ? "held" : age > 15 ? "stale" : "accepted", accepted, age_s:age,
    evidence:held ? {quality:"suspect",observed_at_s:insertion+10,received_at_s:insertion+15} : null,
  }};
}

function createFlightDemo({banner, clock, status, pause}, {begin, run, busy, next, suspend, resume}) {
  const format = seconds => Math.floor(seconds/60) + ":" + String(seconds%60).padStart(2,"0");
  const duration = flightDemoCues.at(-1)[0];
  let started, pausedAt, cursor, frame;
  let active = false;
  function paint(now) {
    const seconds = Math.min(duration, Math.floor((now-started)/1000));
    const elapsed = format(seconds) + " / " + format(duration);
    if (clock.textContent !== elapsed) clock.textContent = elapsed;
    const cue = flightDemoCues[cursor];
    if (cue && seconds >= cue[0] && !busy()) {
      const [, label, ...actions] = cue;
      for (const action of actions) {
        if (run(action)) continue;
        status.textContent = "Demo stopped · " + next();
        status.dataset.stopped = "";
        pause.hidden = true;
        return;
      }
      if (label) status.textContent = label;
      cursor++;
    }
    if (cursor < flightDemoCues.length) frame = requestAnimationFrame(paint);
    else pause.hidden = true;
  }
  function start() {
    active = true;
    pausedAt = null;
    cursor = 0;
    banner.hidden = false;
    pause.hidden = false;
    pause.textContent = "Pause demo";
    delete status.dataset.stopped;
    begin();
    started = performance.now();
    pause.focus();
    paint(started);
  }
  function stop() {
    cancelAnimationFrame(frame);
    banner.hidden = true;
    active = false;
  }
  pause.addEventListener("click",()=>{
    if (!active || pause.hidden) return;
    const now = performance.now();
    if (pausedAt === null) {
      pausedAt = now;
      cancelAnimationFrame(frame);
      suspend();
      pause.textContent = "Resume demo";
    } else {
      const pausedFor = now-pausedAt;
      started += pausedFor;
      pausedAt = null;
      resume(pausedFor);
      frame = requestAnimationFrame(paint);
      pause.textContent = "Pause demo";
    }
  });
  return {start,stop,get active() { return active; }};
}

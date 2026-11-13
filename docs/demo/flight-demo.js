// A cue may wait for a mission milestone as well as its earliest presentation time.
const flightDemoCues = [
  [0, "Astronaut health · systems and crew checkout", "startup", "assign-checks"],
  [5, "Range clear · countdown armed", "launch-arm"],
  [8, "Horizon liftoff", "launch-go"],
  [14, "Booster separation", "launch-separate"],
  [19, "Orbital insertion", "launch-insert"],
  [29, "Stable orbit · cabin and Crew baseline", "crew-baseline"],
  [32, null, "show-deck"],
  [33, "Suspected CO₂ exposure · check on Sana", {orbit:15}],
  [36, "Private Crew check · Noor checks on Sana", "crew-check"],
  [38, "Ivo inspects the scrubber · operational alert in transit", {orbit:30}, "start-demo-scrubber"],
  [41, null, "show-systems"],
  [43, "Private Crew check · observation recorded", {orbit:45}],
  [48, "Ground receives scrubber status · Crew accepts repeat wristband sample", {orbit:60}],
  [54, "Scrubber repair · Ivo restores airflow", {orbit:75}],
  [60, "Crew verifies restored flow and watches the CO₂ trend", {orbit:90}],
  [65, "Crew confirms CO₂ is falling · recovery report in transit", {orbit:105}],
  [73, null, "close-twin", "show-ground", "show-orders"],
  [82, "Ground receives the cabin recovery report", {orbit:150}],
  [87, null, "reset-panels"],
  [90, "Scheduled spacewalk · Mara releases antenna inspection", {orbit:165}, "start-demo-eva"],
  [96, "Spacewalk · Ivo exits to service the antenna", {eva:30}],
  [105, "Spacewalker returns through the airlock", {eva:75}],
  [112, "Mara verifies Ivo’s safe return", {eva:105}, "verify-demo-eva", "close-twin"],
  [115, null, "show-workflows"],
  [117, "Coast to the ISS window", "reset-panels", "close-twin", "launch-coast"],
  [122, "ISS transfer burn", "launch-phasing"],
  [132, "Transfer coast · engines off", "launch-coast"],
  [137, "Match station orbit", "launch-match"],
  [147, "ISS approach · closing range", "show-docking"],
  [165, "Docking · mechanical capture", "launch-capture"],
  [171, "Docking · verify seal and pressure", "launch-check-seal", "launch-check-pressure"],
  [177, "Hatch clearance and cargo handoff", "launch-open-hatch", "launch-transfer"],
  [184, "Sana collects paired research samples", "hide-docking", "launch-research"],
  [197, "Research archived", "launch-archive", "show-docking"],
  [203, "Undock and clear the ISS", "launch-depart"],
  [209, "Deorbit and atmospheric entry", "hide-docking", "launch-deorbit"],
  [214, "Capsule descent", {entry:30}],
  [220, "Capsule landed", "launch-land"],
  [223, "Crew recovered on Earth", "launch-recover"],
];

// Rebase authored drill offsets onto this launch's mission clock. Ground
// receives only the latest released packet, with no Crew or suit evidence.
function flightDemoCabin(drill, time, insertion) {
  const elapsed = time - insertion;
  const step = Math.floor(elapsed / 15);
  const frame = drill.frames[Math.min(step, drill.frames.length - 1)];
  const report = frame.ground;
  const observed = insertion + report.delivery.observed_at_s;
  return {
    source:drill.source, co2:{...frame.co2,observed_at_s:insertion+frame.co2.observed_at_s},
    exposureRisk:step > 0 && frame.flow_m3_h < drill.frames[0].flow_m3_h,
    flow_m3_h:frame.flow_m3_h,
    ground:{
      source:"Offline playback · " + drill.source,
      caseStatus:report.case_status,
      packet:{
        snapshot_id:report.snapshot_id, decision_rev:report.decision_rev,
        co2:{...report.co2,observed_at_s:observed},
        delivery:{observed_at_s:observed,received_at_s:insertion+report.delivery.received_at_s,
          age_s:time-observed,link_status:report.delivery.link_status},
      },
    },
  };
}

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

function createFlightDemo({banner, clock, status, pause}, {begin, run, busy, ready, next, tickDelay, advance, suspend, resume, paintScene, soundCue}) {
  const format = seconds => Math.floor(seconds/60) + ":" + String(seconds%60).padStart(2,"0");
  const duration = flightDemoCues.at(-1)[0];
  let started, pausedAt, cursor, frame, tickStarted, interval;
  let active = false;
  function paint(now) {
    const seconds = Math.min(duration, Math.floor((now-started)/1000));
    const elapsed = format(seconds) + " / " + format(duration);
    if (clock.textContent !== elapsed) clock.textContent = elapsed;
    const delay = tickDelay();
    if (delay !== interval) {
      interval = delay;
      tickStarted = now;
    }
    // Apply every step through the authoritative flight gate. After a delayed
    // frame, resume from the next step so intermediate work remains visible.
    if (interval && now - tickStarted >= interval) {
      advance();
      tickStarted = now;
    }
    const cue = flightDemoCues[cursor];
    const milestone = cue && typeof cue[2] === "object" ? cue[2] : null;
    if (cue && seconds >= cue[0] && !busy() && (!milestone || ready(milestone))) {
      const [, label] = cue;
      const steps = cue.slice(milestone ? 3 : 2);
      for (const action of steps) {
        if (run(action)) continue;
        status.textContent = "Demo stopped · " + next();
        status.dataset.stopped = "";
        pause.hidden = true;
        return;
      }
      if (label) status.textContent = label;
      soundCue(cue[0]);
      cursor++;
    }
    paintScene(now,tickDelay() === interval && interval ? (now-tickStarted)/interval : 0);
    if (cursor < flightDemoCues.length) frame = requestAnimationFrame(paint);
    else pause.hidden = true;
  }
  function start() {
    active = true;
    pausedAt = null;
    cursor = 0;
    interval = 0;
    tickStarted = 0;
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
      tickStarted += pausedFor;
      pausedAt = null;
      resume(pausedFor);
      frame = requestAnimationFrame(paint);
      pause.textContent = "Pause demo";
    }
  });
  return {start,stop,get active() { return active; }};
}

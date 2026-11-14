const health30Cues = [
  [0, "astronaut", "Astronaut health · Sana’s personal baseline and resting pulse trend"],
  [7, "fault", "Health impact · Cabin CO₂ rises after scrubber failure"],
  [12, "emergency", "Onboard emergency support · No Ground link required"],
  [18, "relay", "Ground sees approved case status only after relay delay"],
  [24, "repair", "Crew restores the scrubber · Exposure trend improves"],
  [27, "deck", "Ship twin supports the health assessment"],
  [28, "end", ""],
];

function bindHealth30({host,data,zones,hull,query}) {
  host.innerHTML = `
    <canvas class="health30-launch" aria-label="Horizon launch"></canvas>
    <div class="health30-brand"><span>CREWSYNC</span><strong>SYMBIOSIS X</strong></div>
    <div class="health30-crew"></div>
    <div class="health30-hull"></div>
    <canvas class="health30-docking" width="760" height="320" aria-label="ISS docking"></canvas>
    <p class="health30-docking-caption" hidden></p>
    <article class="health30-panel"></article>
    <div class="health30-end"><span>CREWSYNC</span><h1>SYMBIOSIS X</h1><p>A digital twin of the astronaut and the ship,<br>delivered to Ground.</p><small>78 of 78 authored replay checks · NASA Inspiration4 · Spaceflight Standard Measures</small></div>
    <p class="health30-caption" aria-live="off"></p>
    <p class="health30-synthetic">Synthetic crew data · simulation</p>`;
  const find = selector => host.querySelector(selector);
  const crew = find(".health30-crew");
  for (const member of data.health30_profiles) {
    const name = document.createElement("span");
    name.textContent = member.display_name;
    name.dataset.crew = member.crew_id;
    crew.append(name);
  }
  const ship = find(".health30-hull");
  const shipImage = document.createElement("img");
  shipImage.alt = "Horizon’s instrumented spacecraft cutaway";
  shipImage.src = hull.toDataURL();
  ship.append(shipImage);
  const launcher = createLaunchScene(find(".health30-launch"));
  const docking = createDockingScene(find(".health30-docking"),find(".health30-docking-caption"));
  const panel = find(".health30-panel");
  const cabin = data.health30_cabin;
  const summary = new Intl.NumberFormat("en-US");
  const ppm = number => summary.format(number);
  const sampleAt = time => cabin.samples[Math.min(cabin.samples.length - 1,Math.floor(time/cabin.sample_s))];
  const asText = (node,text) => {node.textContent = text; return node;};

  const profile = data.health_profiles["SIM-02"];
  const baselines = new Map(profile.baselines.map(item=>[item.metric,item]));
  const readings = [
    ["heart_rate","Heart rate","96","bpm"],
    ["blood_pressure","Blood pressure","112/74","mmHg"],
    ["glucose","Blood glucose","91","mg/dL"],
    ["temperature","Temperature","36.7","°C"],
    ["sleep","Sleep duration","444","min"],
    ["sleep_quality","Sleep quality","4","/5"],
    ["mood","Mood","4","/5"],
    ["symptoms","Symptoms","None",""],
  ];
  const history = [70,94,95,96];
  const instruments = data.health30_sensors.filter(sensor=>sensor.room_id && sensor.visibility === "operational");
  const deckSensors = new Map(data.rooms.map(room=>[room.room_id,instruments.filter(sensor=>sensor.room_id === room.room_id)]));

  function astronaut() {
    panel.innerHTML = `<small>ASTRONAUT TWIN · PRIVATE CREW</small><h2></h2>
      <div class="health30-readings"></div>
      <div class="health30-history"><span>Review · 3 repeated high resting pulse readings (synthetic)</span><svg viewBox="0 0 240 46" role="img" aria-label="Synthetic heart-rate history in the shaded personal band"><rect y="5" width="240" height="34" fill="#70c9ba32"/><polyline fill="none" stroke="#9cebd0" stroke-width="3"/></svg></div>
      <p><b>Fictional history</b> · <span class="health30-medical-history"></span></p>
      <p><b>Next check</b> · Repeat a resting pulse check and review the pattern</p>
      <footer>Synthetic rehearsal values · review rule, not diagnosis</footer>`;
    asText(panel.querySelector("h2"),profile.display_name);
    asText(panel.querySelector(".health30-medical-history"),profile.history.entries.map(entry=>entry.note).join(" "));
    panel.querySelector("polyline").setAttribute("points",history.map((item,i)=>i*80+","+ (36-(item-64)*1.8)).join(" "));
    for (const [id,name,value,unit] of readings) {
      const entry = baselines.get(id);
      const baseline = id === "symptoms" ? "None reported"
        : id === "blood_pressure" ? entry.value+"/"+entry.diastolic+" "+entry.unit
        : entry.unit === "score" ? entry.value+"/5" : entry.value+" "+entry.unit;
      const row = document.createElement("div");
      row.innerHTML = `<span>${name}</span><strong>${value} <small>${unit}</small></strong><span>Baseline ${baseline}</span>`;
      panel.querySelector(".health30-readings").append(row);
    }
  }

  function deck() {
    panel.innerHTML = '<small>SHIP TWIN</small><h2>Horizon equipment</h2><p>Instrumented equipment · simulated sensors</p><div class="health30-deck"></div>';
    let index = 0;
    for (const [id,sensors] of deckSensors) {
      if (!sensors.length) continue;
      const [sensor] = sensors;
      const name = data.rooms.find(room => room.room_id === id).name;
      const row = document.createElement("div");
      row.style.setProperty("--reveal", index++ * 190 + "ms");
      row.append(asText(document.createElement("b"),name),
        asText(document.createElement("span"),sensor.display_name),asText(document.createElement("strong"),sensor.presentation_sample + " " + sensor.unit),
        asText(document.createElement("small"),"Age 0 s"));
      panel.querySelector(".health30-deck").append(row);
      if (zones[id]) {
        const room = zones[id];
        const tag = asText(document.createElement("span"),sensor.presentation_sample + " " + sensor.unit);
        tag.className = "health30-room-tag";
        tag.style.setProperty("--x",(room.x + room.w / 2)/11 + "%");
        tag.style.setProperty("--y",(room.y + room.h / 2)/4.75 + "%");
        tag.style.setProperty("--reveal",(index - 1) * 190 + "ms");
        ship.append(tag);
      }
    }
  }

  function air(repair) {
    panel.innerHTML = `<small>SHIP TWIN · LIFE SUPPORT</small><h2>Cabin CO₂</h2>
      <strong class="health30-hero-value"></strong>
      <div class="health30-plot"><span>Demo limit 3,200 ppm</span><svg viewBox="0 0 430 110" role="img" aria-label="Modeled cabin CO₂ history and the 3,200 ppm demo limit"><line x1="0" x2="430" y1="29" y2="29" stroke="#ffc18f" stroke-dasharray="6 5"/><polyline fill="none" stroke="#9bdcff" stroke-width="4"/></svg></div>
      <p class="health30-air-status"></p>
      <p class="health30-exposure">${repair ? "Crew order · Ivo Reyes · Scrubber repair verified" : "Sana · Cabin exposure watch. Check the modeled limit."}</p>
      <footer>Simulated cabin model · mission time compressed · <a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC11357997/">Inspiration4 CO₂ and HRV research · Jones et al., 2024</a></footer>`;
    if (!repair) {
      const source = data.research_context.physiology;
      panel.querySelector("footer").append(asText(document.createElement("span")," · " + source.co2_hrv));
    }
  }

  function paintAir(time,repair) {
    const stageTime = repair ? cabin.repair_s + (cabin.samples.at(-1).time_s - cabin.repair_s) * Math.min(1,(time - 19)/3)
      : 4200 + (cabin.repair_s - 4200) * Math.min(1,(time - 11)/3.5);
    const latest = sampleAt(stageTime);
    panel.querySelector(".health30-hero-value").textContent = ppm(latest.ppm) + " ppm";
    const points = cabin.samples.filter(sample => sample.time_s <= latest.time_s).map(sample =>
      (430 * sample.time_s / cabin.samples.at(-1).time_s).toFixed(1) + "," + (100 - (sample.ppm - 1950) * 71/1250).toFixed(1));
    panel.querySelector("polyline").setAttribute("points",points.join(" "));
    panel.querySelector(".health30-air-status").textContent = repair ? "↓ Falling after repair · 20 m³/h" : "↑ Rising · scrubber offline · 0 m³/h";
    panel.dataset.alert = !repair && latest.ppm >= cabin.limit_ppm ? "true" : "false";
    if (!repair && latest.ppm >= cabin.limit_ppm) {
      panel.querySelector(".health30-exposure").textContent = "Sana · Suspected cabin exposure. Request an onboard check.";
    }
  }

  function emergency() {
    panel.innerHTML = `<small>ASTRONAUT TWIN · EMERGENCY ASSIST</small><h2>Separate chest-pain drill</h2>
      <div class="health30-callout"><b>Case: Mara Vale · Onboard responder</b><strong>Sana Kepler</strong><span>Acknowledged · T+06:00</span></div>
      <p>Responsive · breathing · pain ongoing</p>
      <ol id="health30-guidance"></ol>
      <footer>Simulated training · mission-approved procedures govern flight response</footer>`;
    const drill = data.emergency_drills?.find(item => item.kind === "chest_pain");
    const steps = drill && typeof resolveEmergencyGuidance === "function"
      ? resolveEmergencyGuidance(drill.procedure,{responsive:"yes",breathing:"yes",pain_ongoing:"yes"}) : [
        "Open the local training alert.", "Assign a crew responder and record acknowledgment.",
      ];
    for (const step of steps) panel.querySelector("ol").append(asText(document.createElement("li"),step));
  }

  function relay() {
    panel.innerHTML = `<small>GROUND TWIN · DELAYED OPERATIONAL VIEW</small><h2>Approved case status</h2>
      <div class="health30-link"><b>Horizon</b><span><i>●</i></span><b>Ground</b></div>
      <strong class="health30-relay-status"></strong><p class="health30-relay-time"></p>
      <p class="health30-delivered" hidden><b>Delivered</b> · Case A · Urgent · Acknowledged</p>
      <p class="health30-delivered" hidden>Separate cabin recovery sample: CO₂ ${ppm(cabin.samples.at(-1).ppm)} ppm</p>
      <p><b>Withheld onboard</b></p>
      <div class="health30-chips"><span>Heart rate</span><span>Wearable samples</span><span>Check-in notes</span><span>Medical history</span></div>`;
  }

  function showBeat(beat) {
    host.dataset.beat = beat;
    panel.dataset.alert = "false";
    panel.hidden = ["launch","dock","land","end"].includes(beat);
    panel.replaceChildren();
    ship.querySelectorAll(".health30-room-tag").forEach(tag=>tag.remove());
    if (beat === "launch") {
      launcher.show({phase:"pad",elapsed:0,ship:"Horizon",separated:false,burning:false},false);
      launcher.show({phase:"ascent",elapsed:0,ship:"Horizon",separated:false,burning:true},true);
    } else if (beat === "astronaut") astronaut();
    else if (beat === "deck") deck();
    else if (beat === "fault" || beat === "repair") air(beat === "repair");
    else if (beat === "emergency") emergency();
    else if (beat === "relay") relay();
    else if (beat === "eva" || beat === "research") {
      panel.innerHTML = beat === "eva"
        ? "<small>EXTERIOR WORK</small><h2>Suit twin</h2><p>Antenna inspection · tether and suit telemetry</p><strong class='health30-hero-value'>EVA</strong>"
        : "<small>ISS OPERATIONS</small><h2>Station research</h2><p>Paired motion samples logged by Sana</p>";
    } else if (beat === "dock") docking.show({phase:"captured",range:0,ship:"Horizon",caption:"ISS docking"});
    else if (beat === "land") {
      const recovery = document.getElementById("return-scene").cloneNode(true);
      recovery.removeAttribute("id");
      recovery.classList.add("health30-recovery");
      recovery.dataset.phase = "splashdown";
      recovery.hidden = false;
      host.append(recovery);
    }
    if (beat === "end") host.querySelector(".health30-recovery")?.remove();
  }

  const initial = Math.min(30,Math.max(0,Number(query.get("t")) || 0));
  let previous;
  const started = performance.now();
  host.hidden = false;
  document.body.classList.add("health30-active");
  function tick(now) {
    const time = Math.min(30,initial + (now - started)/1000);
    const [,beat,caption] = health30Cues.findLast(([at]) => at <= time);
    if (previous !== beat) {
      showBeat(beat);
      find(".health30-caption").textContent = caption;
      previous = beat;
    }
    if (beat === "fault" || beat === "repair") paintAir(time,beat === "repair");
    if (beat === "launch") {
      host.dataset.liftoff = String(time < 1.5);
    }
    if (beat === "relay") {
      const progress = Math.min(1,(time - 22)/3);
      panel.style.setProperty("--packet-progress", (progress*100) + "%");
      panel.querySelector(".health30-relay-status").textContent = progress === 1
        ? "Delivered to Ground" : "In transit · " + Math.ceil((1-progress)*300) + " s";
      panel.querySelector(".health30-relay-time").textContent = progress === 1
        ? "Sent T+06:00 · Received T+11:00 · 300 s mission delay"
        : "Sent T+06:00 · Expected T+11:00";
      for (const line of panel.querySelectorAll(".health30-delivered")) line.hidden = progress < 1;
    }
    host.dataset.elapsed = time.toFixed(2);
    if (time < 30) requestAnimationFrame(tick);
    else host.dataset.complete = "true";
  }
  tick(started);
}

// Local Commander training exercise. The live golden run has its own clock and command gate.
function bindLaunchCheckout(missions, replayVersion, {pauseReplay,onCanvas,onPlayback,resetCrew,crew,openCommand,closeCommand,onDemoCrew,exteriorBusy,nextExteriorHold,antennaUnverified}) {
  const saves = createFlightSaves();
  let config;
  const find = id => document.getElementById(id);
  const canvas = find("launch-scene");
  const scene = createLaunchScene(canvas);
  const burnCanvas = find("orbital-burn-scene");
  const burnScene = createLaunchScene(burnCanvas);
  const guide = find("mission-guide");
  const overview = find("map-widget");
  const plan = createMissionPlan(find);
  let guideTarget;
  const dockingScene = createDockingScene(find("docking-scene"),find("docking-caption"));
  const attitudeControls = [...document.querySelectorAll("[data-attitude],[data-pitch]")];
  const navigationHosts = {
    mini:find("navigation-thumb"),large:find("navigation-track"),preview:find("orbit-map-preview"),guidance:find("maneuver-track"),
    caption:find("navigation-caption"),heading:find("navigation-heading"),attitudeControls,
    fields:Object.fromEntries(["ap","pe","altitude","speed","period","target","owner","stage","attitude","reserve","basis","approach"]
      .map(name=>[name,find("navigation-"+name)])),
  };
  const padLabel = " on a concrete launchpad by the service road, hangar and tank farm";
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const narrowCheckout = matchMedia("(max-width:850px)");
  const checkoutProgress = find("launch-checkout-progress");
  function placeCheckoutProgress() {
    find(narrowCheckout.matches ? "pad-controls" : "pad-command").prepend(checkoutProgress);
  }
  narrowCheckout.addEventListener("change",placeCheckoutProgress);
  placeCheckoutProgress();
  const fresh = mission => ({time:0,jobs:{},hold:false,startupAt:null,armed:null,ignition:null,separation:null,insertion:null,aborted:false,phasing:null,capture:null,retreat:null,approachHeld:false,sealAt:null,pressureAt:null,hatchAt:null,transferAt:null,researchAt:null,
    archivedAt:null,departedAt:null,deorbitAt:null,landedAt:null,recoveredAt:null,systemsCheckAt:null,
    transferArrival:null,matchedAt:null,
    attitude:0,pitch:0,rcs:mission.navigation.rcsPulses});
  let ascent, rendezvous, docking, returnPlan, navigation;
  let view = "menu";
  let ascentTimer = null;
  let ascentPlaying = false;
  let playback = null;
  let speed = 1;
  let tickStarted = 0;
  let padAnimation = null;
  let orbitConfirmation = null;
  let orbitPreviewStarted = 0;
  let orbitPreviewUntil = 0;
  let activeBurn = null;
  const burnDuration = 7200;
  const groundRate = 2;
  const checkpointLead = 180;
  const systems = [
    {name:"Electrical bus",icon:"zap",label:"PWR"},
    {name:"Hydraulics",icon:"activity",label:"HYD"},
    {name:"Oxygen supply",icon:"droplets",label:"O₂"},
    {name:"CO₂ scrubber",icon:"wind",label:"CO₂"},
  ];
  let insertion;
  function lightAt(time) {
    const {daylight_offset_s:offset,daylight_cycle_s:cycle} = config.pad;
    const angle = ((time+offset)%cycle)/cycle*2*Math.PI;
    const altitude = Math.sin(angle);
    return {angle,altitude,light:Math.max(0,Math.min(1,(altitude+.12)*1.8))};
  }
  const tutorial = find("flight-tutorial");
  const lessonKey = "sx:flight-checkout-tutorial:v1";
  let tutorialPage = 0;
  let voiceEnabled = true;
  const pages = [
    {title:"Your mission", copy:()=>config.objective, draw:drawMissionRoute},
    {title:"Bring the ship online", copy:()=>`Start ship systems, then press Play. Allow ${config.pad.startup_s} seconds on the launch clock for all four systems to come online.`, draw:drawStartupLesson},
    {title:"Assign astronauts to checks", copy:()=>"In Crew checklist, select the astronaut’s portrait on each row. Press Play and wait for all checks to show Verified.", draw:drawCrewLesson},
    {title:"Clear the pad", copy:()=>"When ship systems are online and the crew checks are verified, use the launch controls below Crew checklist.", draw:drawLaunchLesson},
  ];
  let tick, countdown;
  let state;
  function persist() {
    return demo.active ? true : saves.write(config,state);
  }
  function loadMission(mission, timed) {
    cancelAnimationFrame(orbitConfirmation);
    orbitConfirmation = null;
    orbitPreviewUntil = 0;
    activeBurn = null;
    config = mission;
    find("navigation-ship-key").textContent = "▲ " + mission.ship;
    find("navigation-station-key").hidden = !mission.rendezvous;
    state = timed ? fresh(mission) : {...fresh(mission),...saves.read(mission)};
    // Older ISS runs could depart before the research archive step existed.
    if (state.departedAt !== null && state.archivedAt === null) state.archivedAt = state.departedAt;
    ascent = mission.ascent;
    rendezvous = mission.rendezvous;
    docking = mission.docking;
    returnPlan = mission.return;
    insertion = ascent.insertion_profile;
    tick = ascent.tick_s;
    countdown = mission.sequence.countdown_s;
    speed = 1;
    navigation = createFlightNavigation(mission.navigation,navigationHosts);
    buildMissionControls();
  }
  function tutorialElement(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }
  function tutorialControl(label, icon) {
    const control = tutorialElement("span","tutorial-control",label);
    if (icon) setIcon(control,icon," "+label);
    return control;
  }
  function tutorialLocation(label, location) {
    const block = tutorialElement("span","tutorial-location");
    block.append(tutorialElement("strong",null,label),tutorialElement("span",null,location));
    return block;
  }
  function drawMissionRoute() {
    const stages = [
      ["tutorial-launch","Launch",`Lift off in ${config.ship} and separate the booster.`],
      ["tutorial-orbit","Orbit",`Establish a ${insertion.target_periapsis_km} × ${insertion.apoapsis_km} km parking orbit.`],
      ...(rendezvous ? [
        ["tutorial-dock","Rendezvous & dock","Match the ISS orbit, capture and verify the hatch."],
        ["flask-conical","Research","Deliver the kit and verify the crew’s research samples."],
      ] : [
        ["clipboard-list","Systems checkout","Assign Ivo to verify the orbital systems."],
      ]),
      ["tutorial-recovery","Recovery","Deorbit, land and confirm crew recovery on Earth."],
    ];
    const route = tutorialElement("ol","tutorial-route");
    route.setAttribute("role","list");
    route.setAttribute("aria-label","Mission route");
    for (const [icon,label,detail] of stages) {
      const stage = tutorialElement("li");
      const marker = tutorialElement("span","tutorial-route-icon");
      setIcon(marker,icon,"");
      stage.append(marker,tutorialElement("strong",null,label),tutorialElement("small",null,detail));
      route.append(stage);
    }
    return route;
  }
  function tutorialTransport() {
    const transport = tutorialElement("div","tutorial-transport");
    transport.append(tutorialLocation("Launch time controls","Top of the screen"),tutorialControl("Play","play"));
    return transport;
  }
  function drawStartupLesson() {
    const console = tutorialElement("div","tutorial-console");
    const panel = tutorialElement("div","tutorial-systems");
    const head = tutorialElement("div","tutorial-systems-head");
    head.append(tutorialLocation("Ship systems","Left panel · first panel on mobile"),tutorialControl("Start ship systems","zap"));
    const readouts = tutorialElement("ul","tutorial-startup");
    readouts.setAttribute("role","list");
    for (const {name,icon} of systems) {
      const row = tutorialElement("li");
      setIcon(row,icon,"");
      row.append(tutorialElement("strong",null,name),tutorialElement("small",null,"✓ Online"));
      readouts.append(row);
    }
    panel.append(head,readouts);
    console.append(panel,tutorialTransport());
    return console;
  }
  function drawCrewLesson() {
    const panel = tutorialElement("div","tutorial-console");
    const checks = tutorialElement("ul","tutorial-checks");
    checks.setAttribute("role","list");
    const icons = {restraints:"users",engine:"activity",link:"radio"};
    for (const job of config.jobs) {
      const row = tutorialElement("li");
      const cue = tutorialElement("span","tutorial-check-icon");
      setIcon(cue,icons[job.id] ?? "clipboard-list","");
      const details = tutorialElement("span","tutorial-job");
      details.append(tutorialElement("strong",null,job.title),tutorialElement("small",null,job.station+" · "+job.duration_s+" s"));
      const assignee = crew.find(person=>person.name===job.crew);
      const control = tutorialControl("Assign "+job.crew.split(" ")[0]);
      control.prepend(assignee.portrait());
      row.append(cue,details,control);
      checks.append(row);
    }
    const states = tutorialElement("div","tutorial-states");
    states.append(tutorialElement("span",null,"Awaiting assignment"),tutorialElement("span",null,"→ In progress"),tutorialElement("span",null,"→ ✓ Verified"));
    panel.append(tutorialLocation("Crew checklist","Right panel · below Ship systems on mobile"),checks,tutorialTransport(),states);
    return panel;
  }
  function drawLaunchLesson() {
    const steps = tutorialElement("ol","tutorial-liftoff");
    steps.setAttribute("role","list");
    for (const [label,icon,detail] of [
      ["Arm countdown","",`Start the ${countdown}-second countdown.`],
      ["Play","play","Run the countdown in Launch time controls."],
      ["Launch","tutorial-launch",`Commit liftoff once the countdown clears.`],
    ]) {
      const row = tutorialElement("li");
      row.append(tutorialControl(label,icon),tutorialElement("small",null,detail));
      steps.append(row);
    }
    return steps;
  }
  function drawTutorial() {
    const {title,copy,draw} = pages[tutorialPage];
    find("tutorial-context").textContent = config.title+" · "+config.ship;
    find("tutorial-title").textContent = title;
    find("tutorial-copy").textContent = copy();
    find("tutorial-art").replaceChildren(draw());
    find("tutorial-step").textContent = (tutorialPage+1)+" / "+pages.length;
    find("tutorial-back").disabled = tutorialPage === 0;
    find("tutorial-next").textContent = tutorialPage === pages.length-1 ? "Open checkout" : "Next";
    find("tutorial-title").focus();
    tutorial.querySelector(".tutorial-content").scrollTop = 0;
  }
  function showCheckoutTutorial() {
    let seen = false;
    try { seen = localStorage.getItem(lessonKey) === "seen"; } catch {}
    if (seen || state.ignition !== null || state.startupAt !== null || Object.keys(state.jobs).length) return;
    tutorialPage = 0;
    drawTutorial();
    tutorial.showModal();
    find("tutorial-title").focus();
  }
  find("tutorial-next").addEventListener("click",()=>{
    if (tutorialPage === pages.length-1) tutorial.close("complete");
    else { tutorialPage++; drawTutorial(); }
  });
  find("tutorial-back").addEventListener("click",()=>{tutorialPage--;drawTutorial();});
  tutorial.addEventListener("close",()=>{
    if (!["skip","complete"].includes(tutorial.returnValue)) return;
    try { localStorage.setItem(lessonKey,"seen"); } catch {}
  });
  const voiceButton = find("pad-audio");
  voiceButton.hidden = !("speechSynthesis" in window);
  voiceButton.addEventListener("click",()=>{
    voiceEnabled = !voiceEnabled;
    voiceButton.setAttribute("aria-pressed",String(voiceEnabled));
    if (!voiceEnabled) speechSynthesis.cancel();
  });
  function announceHelmets() {
    if (!voiceEnabled || voiceButton.hidden) return;
    const cue = new SpeechSynthesisUtterance("Helmets on. Hold on for launch.");
    cue.rate = .92;
    cue.lang = "en-US";
    speechSynthesis.speak(cue);
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
      const missing = config.jobs.find(job=>!state.jobs[job.id]);
      let next = missing ? "Assign "+missing.crew.split(" ")[0]+" to their check" : "Play to finish the crew checks";
      if (state.hold) next = "Release the launch hold";
      else if (state.startupAt === null) next = "Start ship systems";
      else if (!systemsReady() && !missing) next = "Play to bring the ship systems online";
      else if (ready()) next = state.armed === null ? "Arm countdown" : counting ? "Advance countdown · " + (state.armed+countdown-state.time) + " s remaining" : "Launch";
      return {phase:state.hold ? "Launch held" : counting ? "Countdown armed" : "Launchpad",
        next,advance:counting || (!state.hold && (jobsRunning || state.startupAt !== null && !systemsReady())),pad:true};
    }
    if (state.separation === null) {
      const burn = state.time - state.ignition;
      if (burn >= ascent.separation_deadline_s) return {phase:"Separation window missed",next:"Abort ascent"};
      if (burn < ascent.burn_s) return {phase:"Booster ascent",next:"Booster burnout",advance:true};
      return {phase:"Booster burnout",next:"Separate booster",separate:true};
    }
    const coastTime = (state.insertion ?? state.time)-state.separation;
    const coast = ascent.coast.find(sample=>sample.seconds===coastTime);
    if (state.insertion !== null) return orbitalState(coast.after_burn);
    if (coastTime >= ascent.coast_limit_s || coast.reserve < ascent.insertion_cost+ascent.minimum_reserve)
      return {phase:"Insertion held · low reserve",next:"Abort ascent",reserve:coast.reserve};
    return {phase:coast.can_insert ? "Insertion window open" : "Upper stage coast",
      next:coast.can_insert ? "Commit orbital insertion" : "Coast to the insertion window",
      advance:!coast.can_insert,insert:coast.can_insert,reserve:coast.reserve};
  }
  function orbitalState(reserve) {
    if (activeBurn?.kind === "insertion") {
      return {phase:"Orbital insertion burn",next:"Raise periapsis into the parking orbit",reserve};
    }
    if (!demo.active && exteriorBusy(config.id,state.time)) {
      return {phase:"Exterior crew active",next:"Wait for the spacewalker to return before maneuvering",
        reserve:reserve-(state.phasing === null ? 0 : rendezvous.phasing_cost),orbit:true,advance:true,exteriorHold:true};
    }
    if (!rendezvous) {
      const remaining = reserve-(state.deorbitAt === null ? 0 : returnPlan.reserve_cost);
      const checkout = state.systemsCheckAt === null ? {phase:"Stable orbit",next:"Assign Ivo to orbital systems check"}
        : state.time < state.systemsCheckAt + config.checkout_s
          ? {phase:"Orbital systems checkout",next:"Wait for Ivo’s systems check",advance:true}
          : {phase:"Orbital systems verified",next:"Commit deorbit",canDeorbit:true};
      return {reserve:remaining,orbit:true,canWaitForCrew:state.deorbitAt === null,
        ...(state.deorbitAt === null ? checkout : returnState())};
    }
    if (state.retreat !== null) return {phase:"Station approach ended",next:"Safe orbit",
      reserve:reserve-(state.phasing === null ? 0 : rendezvous.phasing_cost),terminal:true,orbit:true};
    if (state.phasing === null) {
      const canPhase = reserve >= rendezvous.phasing_cost+rendezvous.retreat_reserve;
      const departure = state.insertion + config.navigation.departureS;
      if (!demo.active && antennaUnverified(config.id,state.time)) {
        return {phase:"ISS transfer held · antenna unverified",next:"Finish exterior inspection and verify safe return in Workflows",
          reserve,orbit:true,canWaitForCrew:true,exteriorHold:true};
      }
      if (canPhase && state.time < departure) return {phase:"Parking orbit · waiting for ISS window",
        next:"Coast to the departure point · "+missionStamp(departure),reserve,orbit:true,advance:true,warpTo:departure};
      return {phase:"Stable orbit · ISS window open",next:canPhase ? "Commit ISS transfer burn" : "Approach held · reserve below minimum",
        reserve,orbit:true,phaseBurn:canPhase};
    }
    const remaining = reserve-rendezvous.phasing_cost;
    if (activeBurn?.kind === "transfer") {
      return {phase:"ISS transfer burn",next:"Raise apoapsis to station altitude",reserve:remaining,orbit:true};
    }
    if (state.transferArrival !== null && state.time < state.transferArrival) {
      return {phase:"Transfer coast · engines off",next:"Coast to transfer apoapsis · "+missionStamp(state.transferArrival),
        reserve:remaining,orbit:true,advance:true,warpTo:state.transferArrival};
    }
    if (state.transferArrival !== null && state.matchedAt === null) {
      return {phase:"At transfer apoapsis",next:"Match the station’s orbit before approaching",reserve:remaining,orbit:true,matchBurn:true};
    }
    if (activeBurn?.kind === "match") {
      return {phase:"Orbit matching burn",next:"Raise periapsis and match station speed",reserve:remaining,orbit:true};
    }
    const elapsed = (state.capture ?? state.time)-(state.matchedAt ?? state.phasing);
    const sample = rendezvous.approach.find(point=>point.seconds===elapsed);
    if (state.capture !== null) {
      return {reserve:remaining-(state.deorbitAt === null ? 0 : returnPlan.reserve_cost),orbit:true,sample,...dockingState()};
    }
    return {
      phase:state.approachHeld ? "Approach held" : sample.state,
      next:sample.expired ? "Retreat to safe orbit" : state.approachHeld ? "Resume approach when ready"
        : sample.capture ? "Capture or retreat" : "Advance approach",
      reserve:remaining,orbit:true,sample,
      advance:!state.approachHeld && !sample.expired && !sample.capture,
      capture:!state.approachHeld && sample.capture,
    };
  }
  function evidenceStatus(observedAt, reading) {
    if (observedAt === null || observedAt < state.capture) return "Unknown";
    const age = state.time-observedAt;
    if (age >= docking.evidence_valid_s) return "Expired · recheck required";
    return reading + " · " + missionStamp(observedAt);
  }

  function dockingShot(flight) {
    if (state.deorbitAt !== null || state.phasing === null || activeBurn) return null;
    if (state.departedAt !== null || state.retreat !== null) {
      return {phase:"departure",range:1,ship:config.ship,caption:state.departedAt !== null ? "Undocking · "+config.ship+" clear of ISS"
        : "Retreat · opening range from ISS"};
    }
    if (!flight.sample) return null;
    if (state.capture !== null) return {phase:"captured",range:0,ship:config.ship,caption:"Docking contact · "+config.ship+" secured to ISS"};
    const phase = state.approachHeld ? "held" : "approach";
    return {phase,range:flight.sample.range/100,ship:config.ship,caption:flight.phase + " · Range " + flight.sample.range + " game units"};
  }

  function dockingState() {
    const seal = evidenceStatus(state.sealAt,docking.seal);
    const pressure = evidenceStatus(state.pressureAt,docking.pressure);
    if (state.transferAt !== null) return {...returnState(),seal,pressure};
    if (state.hatchAt !== null) return {phase:"Transfer authorized",next:"Hand off the research kit",seal,pressure};
    const canOpen = seal.startsWith("Verified") && pressure.startsWith("Matched");
    return {phase:"Station captured",next:canOpen ? "Commander can open the hatch" : "Verify seal and pressure",
      canOpen,seal,pressure,canWaitForCrew:true};
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
    if (state.departedAt !== null) return {phase:"Return capsule in orbit",next:"Commit deorbit",canDeorbit:true};
    if (state.researchAt === null) return {phase:"Research kit transferred",next:"Assign Sana to station research"};
    if (state.time < state.researchAt+returnPlan.research_s) {
      return {phase:"Station research",next:"Complete Sana’s sampling run",advance:true};
    }
    if (state.archivedAt === null) return {phase:"Samples collected",next:"Verify and archive paired research data"};
    return {phase:"Station research complete",next:"Seal hatch and board the return capsule"};
  }

  function missionWork() {
    const assigned = rendezvous ? state.researchAt : state.systemsCheckAt;
    const duration = rendezvous ? returnPlan.research_s : config.checkout_s;
    if (assigned === null || state.time >= assigned+duration) return null;
    return {assigned,arrival:assigned+tick,finishes:assigned+duration,
      member:rendezvous ? 1 : 2,asset:rendezvous ? "lab" : "bench",
      previous:rendezvous ? "stores" : "bus",
      action:rendezvous ? "Collect paired motion samples at ISS" : "Verify orbital systems"};
  }

  function exteriorEligible(flight) {
    return Boolean(!demo.active && rendezvous && !activeBurn && !flight.terminal &&
      (state.phasing === null || state.hatchAt !== null && state.departedAt === null));
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
    } else if (state.departedAt !== null || state.deorbitAt !== null) {
      frameIndex = 9;
      phaseStarted = state.departedAt ?? state.deorbitAt;
      site = "Earth return trajectory";
      visual = state.deorbitAt === null ? "return" : "entry";
      dock = rendezvous ? "Undocked · hatch secured" : "Hatch secured";
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
    } else if (flight.sample && state.retreat === null) {
      frameIndex = 5;
      phaseStarted = state.matchedAt ?? state.phasing;
      site = "ISS approach";
      visual = "approach";
      dock = "Approach · hatch secured";
    }
    const phases = {5:"Approach",6:"Docked",7:"Station research",9:"Return transit",10:"Recovery"};
    const stationWork = missionWork();
    return {missionId:demo.active ? config.id+"-timed-demo" : config.id,timedDemo:demo.active,missionTitle:config.title,time:state.time,phaseStarted,crewStarted:state.insertion,
      frameIndex,visual,advance:!demo.active && canAdvance(),playable:!demo.active && canPlay(),speed,stationWork,
      recovery:state.deorbitAt === null ? null : {
        phase:state.recoveredAt !== null ? "recovered" : state.landedAt !== null ? "splashdown"
          : state.time-state.deorbitAt >= returnPlan.entry_s ? "chutes"
          : state.time-state.deorbitAt < tick ? "separation" : "entry",
        start:state.deorbitAt, entry:returnPlan.entry_s, descent:returnPlan.descent_s,
      },
      command:{phase:flight.phase,next:flight.next,reserve:reserveReadout(flight)},
      checkpoint:demo.active ? null : checkpointApproach(flight),
      steering:state.capture === null && state.deorbitAt === null, yaw:state.attitude,pitch:state.pitch,
      playbackLimit:flight.warpTo,
      evaEligible:exteriorEligible(flight),frame:{
      phase:phases[frameIndex] ?? "Orbit",
      label:flight.phase,site,dock,
      vehicle:state.departedAt !== null ? config.ship + " return capsule" : config.ship,
      route:{5:5,6:6,7:6,9:7,10:8}[frameIndex] ?? 1,
    }};
  }

  function canOrient() {
    return view === "launch" && !activeBurn && state.insertion !== null && state.deorbitAt === null &&
      (state.capture === null || state.departedAt !== null) && state.rcs > 0;
  }

  function renderNavigation(flight) {
    const visible = view === "launch";
    find("flight-instrument").hidden = !visible || state.ignition === null;
    find("orbit-map-widget").hidden = !visible;
    if (!visible) { navigation.show(null); return; }
    const context = state.ignition === null ? "Pad · trajectory preview"
      : state.recoveredAt !== null ? "Earth recovery" : "Spacecraft trajectory";
    if (find("orbit-widget-context").textContent !== context) find("orbit-widget-context").textContent = context;
    const progress = activeBurn ? burnProgress(performance.now()) : 0;
    const time = activeBurn?.kind === "coast" ? state.time+(activeBurn.destination-state.time)*progress : state.time;
    navigation.show({
      checkout:!rendezvous,ship:config.ship,time,ignition:state.ignition,insertion:state.insertion,inserted:state.insertion !== null,
      transfer:state.phasing,matched:state.matchedAt,burn:activeBurn && {...activeBurn,progress},
      coastUntil:flight.warpTo, guidanceMode:find("flight-guidance").dataset.mode,
      plannedBurn:flight.insert ? "insertion" : flight.phaseBurn ? "transfer" : flight.matchBurn ? "match" : null,
      captured:state.capture !== null && state.departedAt === null,departure:state.departedAt,deorbit:state.deorbitAt,
      ascentDuration:ascent.burn_s+ascent.minimum_coast_s,entryDuration:returnPlan.entry_s+returnPlan.descent_s,
      attitude:state.attitude,pitch:state.pitch,rcs:state.rcs,canOrient:!demo.active && canOrient(),phase:flight.phase,target:flight.next,
      owner:"Mara · guidance and commit / Ivo · propulsion",
      approach:!rendezvous ? "Orbital checkout" : state.capture !== null ? state.departedAt === null ? "Hard dock" : "Clear of station"
        : flight.sample ? flight.sample.range+" game units · closing "+flight.sample.closing+" units/tick" : "No approach active",
      propulsion:state.departedAt !== null ? "Return capsule · liquid propellant"
        : state.separation === null ? "Booster · solid propellant"
        : (rendezvous ? "Orbital stage" : config.ship) + " · liquid fuel + oxidizer",
    });
  }

  function renderView(animate = true) {
    const launch = view === "launch";
    const menu = view === "menu";
    const inOrbit = launch && state.insertion !== null && !state.aborted && activeBurn?.kind !== "insertion";
    const controlsHome = find(inOrbit ? "mission-command-widget" : "pad-command");
    const controls = find("launch-controls");
    if (controls.parentElement !== controlsHome) controlsHome.append(controls);
    find("stage").hidden = view !== "replay" && !inOrbit;
    find("launch-page").hidden = view === "replay" || inOrbit;
    find("game-menu").hidden = !menu;
    find("pad-transport").hidden = !launch || inOrbit;
    find("pad-controls").hidden = !launch || inOrbit;
    find("launch-open-missions").hidden = !launch;
    find("launch-open-objectives").hidden = !launch;
    find("launch-show-processes").hidden = !launch;
    find("pad-briefing").hidden = !launch;
    guide.hidden = !launch;
    const mapView = menu ? "menu" : inOrbit ? "flight" : view;
    if (overview.dataset.view !== mapView) {
      overview.dataset.view = mapView;
      overview.querySelector('[data-map-view="route"]').textContent = view === "replay" ? "Route" : "Plan";
      const selected = overview.querySelector('[data-map-view][aria-pressed="true"]');
      if (selected && getComputedStyle(selected).display === "none") {
        selectOverviewTab(overview.querySelector('[data-map-view="route"]'));
      }
    }
    overview.hidden = menu;
    find("map-plan-open").hidden = !launch;
    find("map-current").hidden = !launch;
    find("map-milestones").hidden = !launch;
    find("map-replay-route").hidden = view !== "replay";
    find("map-replay-controls").hidden = view !== "replay";
    find("launch-mission-name").textContent = launch ? config.title : "SYMBIOSIS X";
    find("launch-field").dataset.view = view;
    if (menu) {
      scene.setCheckout(null);
      canvas.dataset.phase = "pad";
      canvas.setAttribute("aria-label",config.ship + padLabel);
      scene.setSky(lightAt(0));
      scene.show({phase:"pad",elapsed:0,separated:false,burning:false,ship:config.ship,lightStack:!rendezvous},false);
      menuUI.render(config,saves.read(config),flightState().phase);
    }
    const flight = launch ? flightState() : null;
    if (flight) {
      render(animate);
      const transport = find(inOrbit ? "flight-playback" : "pad-transport");
      guide.style.setProperty("--guide-top",Math.ceil(transport.getBoundingClientRect().bottom+8)+"px");
    }
    const orbitalBurn = inOrbit && ["transfer","match"].includes(activeBurn?.kind);
    burnCanvas.hidden = !orbitalBurn;
    if (orbitalBurn) burnScene.show({phase:"orbital",elapsed:0,separated:true,ship:config.ship},animate);
    else burnScene.hide();
    renderNavigation(flight);
    const checks = ready() ? Math.max(...config.jobs.map(job=>state.jobs[job.id].due)) : null;
    const reached = milestones=>milestones.filter(([time])=>time !== null && time<=state.time)
      .sort(([first],[second])=>first-second);
    const procedureEvents = launch ? {
      checkout:reached([[state.startupAt,"Startup requested"],[checks,"Crew checks verified"],
        [state.armed,"Countdown armed"],[state.ignition,"Launch committed"]]),
      docking:reached([[state.phasing,"ISS transfer committed"],[state.matchedAt,"Station orbit matched"],[state.capture,"Mechanical capture"],
        [state.hatchAt === null || state.sealAt === null || state.pressureAt === null ? null : Math.max(state.sealAt,state.pressureAt),"Hatch evidence verified"],
        [state.hatchAt,"Hatch authorized"],[state.transferAt,"Cargo receipt accepted"],
        [state.archivedAt,"Research archived"],[state.departedAt,"Departure committed"]]),
    } : {};
    onCanvas(inOrbit ? canvasState(flight) : null,procedureEvents,{
      mode:launch ? (demo.active ? config.id+"-timed-demo" : config.id) : view,
      time:launch ? state.time : null,
    });
  }

  function advance() {
    if (!canAdvance()) return;
    state.time = Math.min(state.time+tick,flightState().warpTo ?? Infinity);
    persist();
    if (!canPlay()) stopPlayback();
    renderView();
    return true;
  }

  function checkpointApproach(flight) {
    if (activeBurn) return {detail:"Wait for the current maneuver to finish."};
    if (flight.exteriorHold) return {detail:flight.next+"."};
    if (flight.terminal) return {detail:"No future checkpoint in this mission."};

    // Use the live phase gate. Planned briefing times do not account for Commander delays.
    const work = missionWork();
    const approachStart = state.matchedAt ?? state.phasing;
    const capture = flight.sample && state.capture === null && !flight.capture && !flight.sample.expired
      ? rendezvous.approach.find(point=>point.capture)?.seconds : undefined;
    const entryEnds = state.deorbitAt === null ? undefined : state.deorbitAt+returnPlan.entry_s;
    const landingZone = entryEnds === undefined ? undefined : entryEnds+returnPlan.descent_s;
    const checkpoint = flight.warpTo ?? work?.finishes ??
      (capture === undefined ? undefined : approachStart+capture) ??
      (state.time < entryEnds ? entryEnds : state.time < landingZone ? landingZone : undefined);
    if (!flight.advance || checkpoint === undefined) {
      return {detail:flight.advance ? flight.next+"." : "Next action · "+flight.next+"."};
    }

    const target = checkpoint-checkpointLead;
    if (target <= state.time) return {detail:"Within 3 mission minutes of the next checkpoint. Use Advance 15 s."};
    if (nextExteriorHold(config.id,state.time,state.insertion,exteriorEligible(flight)) <= target) {
      return {detail:"Exterior inspection is due before the approach point. Use Advance 15 s."};
    }
    return {target,detail:"Advance to "+missionStamp(target)+" · checkpoint at "+missionStamp(checkpoint)+"."};
  }

  function advanceToCheckpoint() {
    if (demo.active || view !== "launch" || state.insertion === null) return;
    const {target} = checkpointApproach(flightState());
    if (target === undefined) return;
    stopPlayback();
    state.time = target;
    persist();
    renderView();
  }

  function canAdvance() {
    if (view !== "launch" || activeBurn || performance.now() < orbitPreviewUntil) return false;
    const flight = flightState();
    if (flight.matchBurn) return false;
    return Boolean(flight.advance || flight.canWaitForCrew || flight.capture);
  }
  function canPlay() {
    if (view !== "launch" || activeBurn) return false;
    const flight = flightState();
    return Boolean(flight.advance || flight.canWaitForCrew);
  }
  function updatePadClock(time) {
    const light = lightAt(time);
    find("pad-clock").textContent = missionStamp(Math.floor(time));
    find("pad-light").textContent = light.altitude > .2 ? "Daylight" : light.altitude < -.2 ? "Night" : "Twilight";
    scene.setSky(light);
    updateCheckout(time);
  }
  function stopPlayback() {
    clearTimeout(ascentTimer);
    ascentTimer = null;
    ascentPlaying = false;
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
    if (demo.active) return;
    if (state.ignition !== null && state.insertion === null) {
      if (state.aborted || !flightState().advance) return;
      if (ascentPlaying) stopPlayback();
      else { ascentPlaying = true; animateAscent(); }
      render();
      return;
    }
    if (playback !== null) {
      stopPlayback();
      renderObjectives(flightState());
      return;
    }
    if (!canPlay()) return;
    if (state.ignition === null) {
      const frame = now => {
        const duration = tick/(groundRate*speed)*1000;
        if (now-tickStarted >= duration) {
          tickStarted += duration;
          advance();
        }
        if (playback === null) return;
        updatePadClock(state.time + Math.min(tick,(now-tickStarted)*groundRate*speed/1000));
        padAnimation = requestAnimationFrame(frame);
      };
      tickStarted = performance.now();
      playback = "pad";
      padAnimation = requestAnimationFrame(frame);
      find("pad-play-label").textContent = "Pause";
      find("pad-play-icon").setAttribute("href","#hud-pause");
      renderObjectives(flightState());
    } else {
      playback = setInterval(advance,tick/(4*speed)*1000);
      onPlayback(true);
      renderObjectives(flightState());
    }
  }

  function animateAscent() {
    if (!ascentPlaying || ascentTimer !== null || view !== "launch") return;
    const liftoff = state.time === state.ignition;
    const coasting = state.separation !== null && state.insertion === null;
    const delay = coasting && !reducedMotion.matches ? 1800 : (liftoff && !reducedMotion.matches ? 2700 : 880)/speed;
    ascentTimer = setTimeout(()=>{
      ascentTimer = null;
      if (!flightState().advance) { stopPlayback(); render(); return; }
      advance();
      animateAscent();
    },delay);
  }

  function renderObjectives(flight) {
    const times = {
      checks:ready() ? Math.max(...config.jobs.map(job=>state.jobs[job.id].due)) : null,
      countdown:state.ignition,separation:state.separation,insertion:activeBurn?.kind === "insertion" ? null : state.insertion,
      phasing:activeBurn?.kind === "transfer" ? null : state.phasing,
      match:activeBurn?.kind === "match" ? null : state.matchedAt,capture:state.capture,hatch:state.hatchAt,transfer:state.transferAt,
      systems:state.systemsCheckAt !== null && state.time >= state.systemsCheckAt+config.checkout_s
        ? state.systemsCheckAt+config.checkout_s : null,
      research:state.archivedAt,
      departure:state.departedAt,deorbit:state.deorbitAt,landing:state.landedAt,return:state.recoveredAt,
    };
    const current = config.sequence.objectives.find(objective=>times[objective.id] == null);
    const held = state.hold || state.approachHeld || flight.phase.includes("held") || flight.phase.includes("missed");
    const objectives = config.sequence.objectives.map(objective=>{
      const actual = times[objective.id];
      const status = actual != null ? "verified" : objective !== current ? "upcoming"
        : flight.terminal ? "incomplete" : held ? "held" : "next";
      return {...objective,actual,status};
    });
    plan.render(objectives,flight);
    renderGuide(flight,objectives.filter(objective=>objective.status === "verified").length,held);
  }

  function nextControl(flight) {
    if (activeBurn || flight.terminal) return null;
    if (state.ignition === null) {
      if (state.hold) return "launch-hold";
      if (state.startupAt === null) return "startup";
      const missing = config.jobs.find(job=>!state.jobs[job.id]);
      if (missing) return rows.get(missing.id).assign;
      if (!systemsReady() || !ready()) return "pad-play";
      if (state.armed === null) return "launch-arm";
      return flight.advance ? "pad-play" : "launch-go";
    }
    if (flight.separate) return "launch-separate";
    if (flight.insert) return "launch-insert";
    if (flight.warpTo !== undefined) return "launch-coast";
    if (flight.phaseBurn) return "launch-phasing";
    if (flight.matchBurn) return "launch-match";
    if (flight.sample?.expired && state.capture === null) return "launch-retreat";
    if (state.approachHeld) return "launch-approach-hold";
    if (flight.capture) return "launch-capture";
    if (flight.exteriorHold && flight.advance) return "play";
    if (!demo.active && antennaUnverified(config.id,state.time) && state.phasing === null) return "show-processes";
    if (flight.canOpen) return "launch-open-hatch";
    if (state.capture !== null && state.hatchAt === null) {
      return flight.seal.startsWith("Verified") ? "launch-check-pressure" : "launch-check-seal";
    }
    if (flight.canDeorbit) return find("launch-deorbit").disabled ? null : "launch-deorbit";
    if (flight.advance) return state.insertion === null ? "pad-play" : "play";
    for (const id of ["launch-transfer","launch-research","launch-archive","launch-depart","launch-systems-check",
      "launch-land","launch-recover","launch-abort"]) {
      if (!find(id).hidden && !find(id).disabled) return id;
    }
    return null;
  }

  const guideActions = {
    startup:["checkout","Start ship systems","Power, steering and cabin air come online before liftoff."],
    "launch-hold":["checkout","Release hold","The countdown can continue once you clear the hold."],
    "launch-arm":["checkout","Arm countdown","Start the final timer before launch."],
    "launch-go":["ascent","Launch","The booster lifts the ship off the pad."],
    "launch-separate":["separation","Separate booster","Drop the spent booster so the ship can fly on."],
    "launch-insert":["insertion","Enter Earth orbit","Choose Commit orbital insertion to fire the engine and settle into orbit."],
    "launch-phasing":["insertion","Fire engines toward the station","Choose Commit ISS transfer burn to begin the trip."],
    "launch-match":["insertion","Match station orbit","Fire the engine to match the station’s speed before closing in."],
    "launch-approach-hold":["approach","Resume approach","This lets the ship start closing in again."],
    "launch-capture":["docking","Dock with the station","Choose Capture station to latch the ship to the docking port."],
    "launch-retreat":["approach","Retreat to orbit","The docking window has closed. Move away from the station."],
    "launch-check-seal":["docking","Check seal","Verify the joint between the ship and station is airtight."],
    "launch-check-pressure":["docking","Compare pressure","Check that air pressure matches on both sides of the hatch."],
    "launch-open-hatch":["docking","Open the hatch","Both checks are current. Choose Authorize hatch opening."],
    "launch-transfer":["docking","Hand off research kit","Move the kit from the ship to the station."],
    "launch-research":["docking","Assign Sana to station research","Sana uses the kit to collect motion samples."],
    "launch-archive":["docking","Verify and archive research","Save the paired samples before leaving the station."],
    "launch-depart":["docking","Board the return capsule","Choose Seal hatch and board return capsule to leave the station."],
    "launch-systems-check":["coast","Assign Ivo to orbital systems check","Ivo checks that the ship is ready to return."],
    "launch-deorbit":["recovery","Begin the return to Earth","Choose Commit deorbit to leave orbit and descend."],
    "launch-land":["recovery","Confirm landing","Record that the capsule reached the landing zone."],
    "launch-recover":["recovery","Confirm crew recovery","Record that the crew is safely back on Earth."],
    "launch-abort":["ascent","Abort ascent","End the exercise. The ship missed its chance to reach orbit safely."],
    "show-processes":["coast","Finish the inspection and verify safe return in Workflows","The antenna check must be complete before the ship can maneuver."],
  };

  function guideCue(flight, control, waiting) {
    if (state.recoveredAt !== null) return ["recovery","Crew safely back on Earth",""];
    if (flight.terminal) return state.aborted
      ? ["ascent","Ascent ended","Open Flight plan to review the unfinished steps."]
      : ["approach","Ship back in safe orbit","Open Flight plan to review the unfinished steps."];
    if (activeBurn) {
      const maneuver = {
        insertion:["insertion","Entering Earth orbit","The engine fires to settle the ship into orbit."],
        transfer:["insertion","Heading toward the station","The engine fires to lift the ship into a higher orbit."],
        match:["insertion","Matching the station’s speed","The engine fires before the ship can close in."],
        coast:["coast","Coasting with engines off","The ship follows its orbit to the next maneuver."],
      };
      return maneuver[activeBurn.kind];
    }
    if (control === "launch-coast") return state.phasing === null
      ? ["coast","Coast to the departure point","Let the ship drift in orbit until it lines up for the trip to the station."]
      : ["coast","Coast to the top of the orbit","Let the ship drift to the station’s altitude before matching speed."];
    if (control === "pad-play") {
      if (flight.pad) return state.armed === null
        ? ["checkout",waiting ? "Checks in progress" : "Play to finish checkout","Give the systems and crew time to finish their checks."]
        : ["ascent",waiting ? "Countdown running" : "Play to run the countdown",
          "Launch unlocks when the countdown ends."];
      return state.separation === null
        ? ["ascent",waiting ? "Booster lifting the ship" : "Play to continue climbing","Wait for the booster to finish firing before separating it."]
        : ["insertion",waiting ? "Drifting toward the burn point" : "Play to reach the burn point",
          "The ship has a short window to fire its engine and enter orbit."];
    }
    if (control === "play") {
      if (flight.exteriorHold) return ["coast","Wait for the spacewalker","Advance time so the crew member can return safely."];
      if (state.deorbitAt !== null) return ["recovery",waiting ? "Descending toward Earth" : "Play to reach the landing zone",
        "The capsule slows as it descends through the atmosphere."];
      if (state.capture !== null) return ["docking",waiting ? "Sana is collecting samples" : "Play to finish sampling",
        "Wait for Sana to collect both sets of motion readings."];
      if (flight.sample) return ["approach",waiting ? "Closing in on the station" : "Play to approach the station",
        "The docking control unlocks when the ship is close enough and moving slowly."];
      return ["coast",waiting ? "Ivo is checking the ship" : "Play to finish Ivo’s check",
        "Wait for Ivo to verify the ship’s systems."];
    }
    if (guideActions[control]) return guideActions[control];
    if (flight.pad) return ["checkout",flight.next,"Each crew member checks a different part of launch readiness."];
    if (flight.canDeorbit) return ["recovery","Return held","The ship needs more fuel reserve to begin the return."];
    return ["coast","Station approach held","The ship needs more fuel reserve to start the trip."];
  }

  function renderGuide(flight, completed, held) {
    const waiting = Boolean(activeBurn || playback !== null || ascentPlaying);
    const stateName = state.recoveredAt !== null ? "complete" : flight.terminal ? "ended"
      : held ? "held" : waiting ? "waiting" : "ready";
    guide.dataset.state = stateName;
    const target = nextControl(flight);
    guideTarget = typeof target === "string" ? find(target) : target;
    const [scene, next, detail] = guideCue(flight,guideTarget?.id,waiting);
    find("guide-illustration").dataset.scene = scene;
    for (const [id, value] of [
      ["guide-count",completed+" / "+config.sequence.objectives.length+" complete"],
      ["guide-phase",flight.phase],["guide-next",next],["guide-detail",detail],
    ]) {
      if (find(id).textContent !== value) find(id).textContent = value;
    }
    find("guide-focus").hidden = !guideTarget || demo.active || waiting;
  }

  function updateCheckout(time) {
    if (view !== "launch" || state.ignition !== null) return;
    const starting = state.startupAt !== null;
    const fraction = starting ? Math.max(0,Math.min(1,(time-state.startupAt)/config.pad.startup_s)) : 0;
    const cues = systems.map((system,index)=>{
      const step = fraction*systems.length;
      const status = step >= index+1 ? "online" : starting && step >= index ? "starting" : "off";
      system.row.dataset.state = status;
      system.status.textContent = {online:"Online",starting:"Starting",off:starting ? "Queued" : "Off"}[status];
      return {label:system.label,state:status};
    });
    const crew = config.jobs.map(job=>{
      const record = state.jobs[job.id];
      const row = rows.get(job.id);
      const progress = record ? Math.max(0,Math.min(1,1-(record.due-time)/job.duration_s)) : 0;
      const status = !record ? "idle" : progress === 1 ? "verified" : "working";
      row.item.dataset.state = status;
      row.progress.value = progress;
      row.status.textContent = status === "verified" ? "✓ Verified" : record
        ? "In progress · " + Math.max(1,Math.ceil(record.due-time)) + " s" : "Awaiting assignment";
      return {label:job.crew.split(" ")[0],state:status,progress};
    });
    scene.setCheckout({systems:cues,crew,power:fraction,time});
  }
  function reserveReadout(flight) {
    return flight.reserve === undefined ? "Upper stage standby" : flight.reserve+" game units";
  }

  function renderLaunchStack(flight) {
    const booster = state.separation !== null ? "Separated" : state.aborted ? "Engine off"
      : flight.phase === "Booster ascent" ? "Firing" : state.ignition !== null ? "Burnout" : "Attached";
    const upper = activeBurn?.kind === "insertion" ? "Firing" : state.aborted ? "Engine off"
      : state.insertion !== null ? "In orbit" : state.separation !== null ? "Coasting" : "Attached";
    for (const [id, label] of [["capsule","Attached"],["upper",upper],["booster",booster]]) {
      const stage = stageRows.get(id);
      if (!stage) continue;
      stage.item.dataset.state = label.toLowerCase();
      stage.status.textContent = label;
    }
  }

  function renderCheckoutProgress(online, crewReady) {
    checkoutProgress.hidden = state.ignition !== null;
    if (state.ignition !== null) return;
    const total = config.jobs.length;
    const done = config.jobs.filter(job=>state.jobs[job.id]?.due <= state.time).length;
    find("launch-crew-progress").max = total;
    find("launch-crew-progress").value = done;
    const count = done+" of "+total+" checks done · "+(total-done)+" remaining";
    const blockers = [];
    if (state.hold) blockers.push("release launch hold");
    if (!online) blockers.push(state.startupAt === null ? "start ship systems" : "finish ship startup");
    if (!crewReady) blockers.push(config.jobs.some(job=>!state.jobs[job.id]) ? "assign remaining checks" : "finish crew checks");
    const seconds = state.armed === null ? 0 : state.armed+countdown-state.time;
    const gate = blockers.length ? "Arm blocked · "+blockers.join(" · ")
      : state.armed === null ? "Ready to arm · choose Arm countdown"
      : seconds > 0 ? "Launch blocked · "+seconds+" s left in countdown"
      : "Ready for liftoff · choose Launch";
    for (const [id,value] of [["launch-crew-count",count],["launch-checklist",gate]]) {
      if (find(id).textContent !== value) find(id).textContent = value;
    }
  }

  function render(animate = true) {
    if (state.ignition === null && playback !== "pad") updatePadClock(state.time);
    const launchPlaying = playback === "pad" || ascentPlaying;
    find("pad-play-label").textContent = launchPlaying ? "Pause" : "Play";
    find("pad-play-icon").setAttribute("href",launchPlaying ? "#hud-pause" : "#hud-play");
    const flight = flightState();
    find("pad-play").disabled = demo.active || !canPlay();
    find("pad-step").disabled = demo.active || !canAdvance();
    find("pad-speed").textContent = speed+"×";
    find("pad-speed").title = (groundRate*speed)+" ground mission seconds per real second";
    if (state.ignition !== null) {
      find("pad-clock").textContent = missionStamp(state.time);
      find("pad-light").textContent = flightState().phase;
    }
    const startup = find("startup-status");
    const online = systemsReady();
    const crewReady = ready();
    startup.dataset.online = String(online);
    find("startup").disabled = state.startupAt !== null || state.ignition !== null;
    find("launch-systems").hidden = state.ignition !== null;
    find("launch-time").textContent = Math.floor(state.time / 60) + ":" + String(state.time % 60).padStart(2, "0");
    find("launch-status").textContent = flight.phase;
    find("launch-next").textContent = flight.next;
    find("launch-reserve").textContent = reserveReadout(flight);
    if (!find("pad-controls").hidden) {
      const elapsed = state.ignition === null ? 0 : state.time-state.ignition;
      const phase = state.aborted ? "abort" : state.separation !== null ? "upper" : state.ignition === null ? "pad" : "ascent";
      canvas.dataset.phase = phase;
      canvas.setAttribute("aria-label", phase === "pad" ? config.ship + padLabel : config.ship + " · " + flight.phase);
      if (phase !== "pad") scene.setCheckout(null);
      scene.show({phase,elapsed,separated:state.separation !== null,burning:elapsed<ascent.burn_s,
        orbitalBurn:activeBurn?.kind === "insertion",ship:config.ship,lightStack:!rendezvous},animate);
    }
    const orbit = find("orbit-preview");
    orbit.hidden = state.separation === null || state.aborted ||
      (state.insertion !== null && activeBurn?.kind !== "insertion");
    if (!orbit.hidden) paintOrbit(orbit, state.insertion === null ? 0 : burnProgress(performance.now()));
    renderLaunchStack(flight);
    renderCheckoutProgress(online,crewReady);
    find("launch-go").hidden = state.ignition !== null;
    find("launch-separate").hidden = !flight.separate;
    find("launch-insert").hidden = !flight.insert;
    find("launch-arm").hidden = state.ignition !== null || state.armed !== null;
    find("launch-arm").disabled = state.hold || !online || !crewReady;
    find("launch-go").disabled = find("launch-arm").disabled || state.armed === null || state.time < state.armed+countdown;
    find("launch-step").disabled = demo.active || !canAdvance();
    find("launch-crew-checks").hidden = state.ignition !== null;
    find("launch-research").hidden = state.transferAt === null || state.researchAt !== null;
    const researchDone = state.researchAt !== null && state.time >= state.researchAt+returnPlan.research_s;
    find("launch-archive").hidden = !researchDone || state.archivedAt !== null;
    find("launch-depart").hidden = state.archivedAt === null || state.departedAt !== null || Boolean(exteriorBusy(config.id,state.time));
    find("station-research-board").hidden = state.hatchAt === null || state.departedAt !== null;
    find("station-research-progress").value = state.researchAt === null ? 0 :
      Math.min(100,100*(state.time-state.researchAt)/returnPlan.research_s);
    find("station-research-status").textContent = state.archivedAt !== null ? "Paired sample archived · " + missionStamp(state.archivedAt)
      : researchDone ? "Sampling complete · awaiting Commander verification"
      : state.researchAt !== null ? "Sana is collecting synthetic wrist and trunk motion"
      : state.transferAt === null ? "Awaiting research kit transfer" : "Research kit received · assign Sana";
    const shot = dockingShot(flight);
    dockingScene.show(shot);
    renderGuidance(flight,shot);
    find("launch-systems-check").hidden = Boolean(rendezvous) || !flight.orbit || state.systemsCheckAt !== null;
    find("launch-deorbit").hidden = !flight.canDeorbit;
    find("launch-deorbit").disabled = (flight.reserve ?? 0) < returnPlan.reserve_cost;
    find("launch-land").hidden = state.deorbitAt === null || state.time < state.deorbitAt+returnPlan.entry_s+returnPlan.descent_s || state.landedAt !== null;
    find("launch-recover").hidden = state.landedAt === null || state.recoveredAt !== null;
    find("launch-abort").hidden = state.ignition === null || flight.orbit || flight.terminal || Boolean(activeBurn);
    find("launch-phasing").hidden = !rendezvous || !flight.orbit || state.phasing !== null || flight.terminal;
    find("launch-phasing").disabled = !flight.phaseBurn || Boolean(activeBurn);
    find("launch-coast").hidden = flight.warpTo === undefined;
    find("launch-coast").disabled = Boolean(activeBurn);
    find("launch-coast").textContent = state.phasing === null ? "Coast to ISS departure window" : "Coast to transfer apoapsis";
    find("launch-match").hidden = !flight.matchBurn;
    find("launch-approach-hold").hidden = !flight.sample || state.capture !== null || flight.terminal || flight.sample.expired;
    find("launch-approach-hold").textContent = state.approachHeld ? "Resume approach" : "Hold approach";
    find("launch-approach-hold").setAttribute("aria-pressed",String(state.approachHeld));
    find("launch-capture").hidden = !flight.sample || state.capture !== null || flight.terminal;
    find("launch-capture").disabled = !flight.capture;
    find("launch-retreat").hidden = !rendezvous || !flight.orbit || state.capture !== null || flight.terminal ||
      Boolean(activeBurn) || Boolean(exteriorBusy(config.id,state.time));
    find("launch-approach").hidden = !flight.sample || state.departedAt !== null;
    find("launch-range").textContent = flight.sample ? flight.sample.range + " game units" : "Awaiting phasing";
    find("launch-closing").textContent = flight.sample ? flight.sample.closing + " units/tick" : "—";
    find("launch-hatch").textContent = state.departedAt !== null ? "Secured for return" : state.hatchAt !== null ? "Open · Commander authorized"
      : state.capture !== null ? "Secured · verification required" : "Secured";
    find("launch-docking").hidden = state.capture === null;
    find("launch-seal").textContent = flight.seal ?? "Unknown";
    find("launch-pressure").textContent = flight.pressure ?? "Unknown";
    find("launch-custody").textContent = state.transferAt === null ? "On "+config.ship
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
    for (const job of config.jobs) {
      const record = state.jobs[job.id];
      const row = rows.get(job.id);
      row.assign.disabled = Boolean(record) || state.ignition !== null;
      row.assign.setAttribute("aria-pressed",String(Boolean(record)));
      row.assignedLabel.textContent = record ? "Assigned" : "Assign";
      row.assign.setAttribute("aria-label",(record ? "Assigned " : "Assign ") + job.crew.split(" ")[0]);
    }
    updateCheckout(state.time);
    renderObjectives(flight);
  }
  function burnProgress(now) {
    const duration = activeBurn?.kind === "coast" ? 3200 : burnDuration;
    return Math.max(0,Math.min(1,(now-orbitPreviewStarted)/duration));
  }

  function renderGuidance(flight, shot, now=performance.now()) {
    const kind = activeBurn?.kind ?? (flight.insert ? "insertion" : flight.phaseBurn ? "transfer"
      : flight.matchBurn ? "match" : null);
    const coast = activeBurn?.kind === "coast" || flight.warpTo !== undefined ||
      state.separation !== null && state.insertion === null && flight.advance;
    const mode = shot ? "docking" : coast ? "coast" : kind ? "burn" : "orbit";
    const guidance = find("flight-guidance");
    guidance.hidden = state.separation === null || state.aborted;
    guidance.dataset.mode = mode;
    find("guidance-mode").textContent = {coast:"Coast",orbit:"Orbit",burn:"Burn",docking:"Docking"}[mode];
    find("maneuver-track").hidden = guidance.hidden || mode === "docking";
    find("docking-view").hidden = !shot;
    const ref = config.navigation;
    const target = {insertion:ref.parking,transfer:ref.transfer,match:ref.station}[kind];
    const deltaV = {insertion:ref.insertionDeltaV,transfer:ref.transferDeltaV,match:ref.matchDeltaV}[kind];
    const progress = activeBurn ? burnProgress(now) : 0;
    const destination = activeBurn?.destination ?? flight.warpTo;
    const coastTime = state.time+((destination ?? state.time)-state.time)*progress;
    const waypoint = state.phasing === null ? "ISS departure window" : "Transfer apoapsis";
    const title = {insertion:"Orbital insertion",transfer:"ISS transfer",match:"Match station orbit"}[kind];
    find("maneuver-title").textContent = mode === "docking" ? "ISS rendezvous"
      : mode === "coast" ? destination === undefined ? "Insertion window" : waypoint
      : title ?? flight.phase;
    find("maneuver-target").textContent = target
      ? "Prograde · Δv "+deltaV+" m/s · Target "+target.pe+" × "+target.ap+" km"
        + (activeBurn ? " · Burn playback stretched" : "")
      : mode === "coast" && destination !== undefined
        ? "Engines off · "+missionStamp(Math.floor(coastTime))+" → "+missionStamp(destination)
        : flight.next;
    const canvas = find("maneuver-track");
    canvas.setAttribute("aria-label",config.ship+" · "+mode+" guidance");
    find("maneuver-progress").hidden = !activeBurn;
    find("maneuver-progress").setAttribute("aria-label",mode === "coast" ? "Coast progress" : "Engine burn progress");
    find("maneuver-progress").value = progress;
  }

  function animateBurn(now) {
    if (now >= orbitPreviewUntil) {
      orbitConfirmation = null;
      const destination = activeBurn.destination;
      activeBurn = null;
      if (destination !== undefined) {
        state.time = destination;
        persist();
      }
      renderView();
      return;
    }
    const flight = flightState();
    const orbit = find("orbit-preview");
    const progress = burnProgress(now);
    if (!orbit.hidden) paintOrbit(orbit,progress);
    const throttle = Math.max(0,Math.min(1,progress*14,(1-progress)*10));
    if (activeBurn.kind === "insertion") scene.setThrottle(throttle);
    if (!burnCanvas.hidden) burnScene.setThrottle(throttle);
    renderGuidance(flight,null,now);
    renderNavigation(flight);
    orbitConfirmation = requestAnimationFrame(animateBurn);
  }

  function showManeuver(kind, destination) {
    if (reducedMotion.matches) {
      if (destination !== undefined) state.time = destination;
      return;
    }
    activeBurn = {kind,destination};
    orbitPreviewStarted = performance.now();
    orbitPreviewUntil = orbitPreviewStarted + (kind === "coast" ? 3200 : burnDuration + 850);
    orbitConfirmation = requestAnimationFrame(animateBurn);
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
  for (const system of systems) {
    const row = document.createElement("li");
    const symbol = document.createElement("span");
    symbol.className = "startup-symbol";
    const svg = document.createElementNS("http://www.w3.org/2000/svg","svg");
    svg.classList.add("icon");
    svg.setAttribute("aria-hidden","true");
    const use = document.createElementNS("http://www.w3.org/2000/svg","use");
    use.setAttribute("href","#hud-"+system.icon);
    svg.append(use);
    symbol.append(svg);
    const status = document.createElement("span");
    row.append(symbol,system.name,status);
    system.row = row;
    system.status = status;
    find("startup-status").append(row);
  }
  find("startup").addEventListener("click",()=>{
    if (state.startupAt !== null || state.ignition !== null) return;
    state.startupAt = state.time;
    persist();
    render();
  });
  find("pad-play").addEventListener("click",togglePlayback);
  find("pad-step").addEventListener("click",advance);
  function cycleSpeed() {
    if (demo.active) return;
    speed = speed === 4 ? 1 : speed*2;
    tickStarted = performance.now();
    if (ascentPlaying) {
      clearTimeout(ascentTimer);
      ascentTimer = null;
      animateAscent();
    }
    if (playback !== null && playback !== "pad") {
      clearInterval(playback);
      playback = setInterval(advance,tick/(4*speed)*1000);
    }
    renderView(false);
  }
  find("pad-speed").addEventListener("click",cycleSpeed);
  for (const id of ["show-briefing","launch-briefing","pad-briefing"]) find(id).addEventListener("click",()=>{
    pauseReplay();
    if (!demo.active) stopPlayback();
    if (view === "launch") renderView(false);
    menuUI.setBriefing(view === "replay" ? null : config);
    find("mission-briefing").showModal();
  });
  function openNavigation() {
    find("orbit-dialog").showModal();
    renderNavigation(flightState());
  }
  for (const id of ["show-orbit","open-orbit-minimap"]) find(id).addEventListener("click",openNavigation);
  function steer(axis, degrees) {
    if (demo.active || !canOrient()) return;
    const before = state[axis];
    state[axis] = axis === "pitch" ? Math.max(-75,Math.min(75,before+degrees)) : (before+degrees+540)%360-180;
    if (state[axis] === before) return;
    state.rcs--;
    persist();
    renderView(false);
  }
  for (const button of attitudeControls) button.addEventListener("click",()=>{
    if ("pitch" in button.dataset) steer("pitch",Number(button.dataset.pitch));
    else steer("attitude",Number(button.dataset.attitude));
  });
  find("navigation-mini").addEventListener("keydown",event=>{
    const directions = {
      a:["attitude",-15],d:["attitude",15],w:["pitch",15],s:["pitch",-15],
      arrowleft:["attitude",-15],arrowright:["attitude",15],arrowup:["pitch",15],arrowdown:["pitch",-15],
    };
    const direction = directions[event.key.toLowerCase()];
    if (!direction || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    if (!event.repeat) steer(...direction);
  });
  const stageRows = new Map();
  const stagePurposes = {
    capsule:"Carries crew and returns them to Earth",
    upper:"Places the capsule into orbit",
    booster:"Provides thrust for liftoff",
  };
  const jobIcons = {restraints:"users",engine:"activity",link:"radio"};
  function buildMissionControls() {
    plan.build(config);
    stageRows.clear();
    rows.clear();
    for (const id of ["launch-stack","launch-jobs"]) find(id).replaceChildren();
    find("launch-title").textContent = config.title;
    find("launch-subtitle").textContent = config.vehicle;
    for (const stage of config.stages) {
      const item = document.createElement("li");
      item.className = "launch-stage";
      item.dataset.stage = stage.id;
      const shape = document.createElement("span");
      shape.className = "launch-stage-shape";
      shape.setAttribute("aria-hidden","true");
      const copy = document.createElement("div");
      copy.className = "launch-stage-copy";
      const name = document.createElement("strong");
      const detail = document.createElement("small");
      const status = document.createElement("span");
      status.className = "launch-stage-status";
      name.textContent = stage.name;
      detail.textContent = stage.id === "upper" && !rendezvous
        ? "Carries the crew into orbit and back to Earth" : stagePurposes[stage.id] ?? stage.detail;
      copy.append(name,detail,status);
      item.append(shape,copy);
      stageRows.set(stage.id,{item,status});
      find("launch-stack").append(item);
    }
    for (const job of config.jobs) {
      const row = document.createElement("li");
      const title = document.createElement("strong");
      const status = document.createElement("span");
      const assign = document.createElement("button");
      setIcon(title,jobIcons[job.id] ?? "clipboard-list",job.title);
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
      const progress = document.createElement("progress");
      progress.max = 1;
      progress.setAttribute("aria-label",job.title+" progress");
      row.append(title,station,status,assign,progress);
      rows.set(job.id,{item:row,status,assign,assignedLabel,progress});
      find("launch-jobs").append(row);
    }
  }

  function route() {
    const params = new URLSearchParams(location.search);
    const next = params.get("view");
    const mission = missions.find(item=>item.id === params.get("mission")) ?? missions[0];
    return {view:next === "replay" || next === "launch" ? next : "menu",mission};
  }

  function showView(next, mission, navigate = false, timed = false) {
    if (!timed && demo.active) {
      onDemoCrew("close-twin");
      closeCommand();
      resetCrew(config.id+"-timed-demo");
      demo.stop();
    }
    for (const id of ["mission-objectives","orbit-dialog"]) if (find(id).open) find(id).close();
    pauseReplay();
    stopPlayback();
    loadMission(mission,timed);
    view = next;
    renderView(false);
    if (navigate) {
      const url = new URL(location.href);
      if (view === "menu") url.searchParams.delete("view");
      else url.searchParams.set("view",view);
      if (view === "replay" || mission === missions[0]) url.searchParams.delete("mission");
      else url.searchParams.set("mission",mission.id);
      if (url.href !== location.href) history.pushState(null,"",url);
      const heading = view === "menu" ? "game-title" : find("stage").hidden ? "launch-title" : "show-missions";
      find(heading).focus({preventScroll:true});
      window.scrollTo(0,0);
    }
  }

  function openObjectives() {
    if (!demo.active) stopPlayback();
    renderView(false);
    find("mission-objectives").showModal();
  }

  function exit() {
    const saved = view !== "launch" || persist();
    find("campaign-notice").textContent = saved ? "" : "Browser storage is unavailable. This run can only resume in this tab.";
    showView("menu",config,true);
  }

  const demoActions = {
    "assign-checks":()=>{ for (const row of rows.values()) row.assign.click(); return true; },
    "crew-baseline":()=>onDemoCrew("crew-baseline"),
    "crew-check":()=>onDemoCrew("crew-check"),
    "start-demo-eva":()=>onDemoCrew("start-demo-eva"),
    "verify-demo-eva":()=>onDemoCrew("verify-demo-eva"),
    "close-twin":()=>onDemoCrew("close-twin"),
    "show-docking":()=>{ openCommand(find("demo-pause")); return true; },
    "hide-docking":()=>{ closeCommand(); return true; },
  };
  const demo = createFlightDemo({
    banner:find("demo-banner"),clock:find("demo-time"),status:find("demo-status"),pause:find("demo-pause"),
  },{
    begin() {
      resetCrew(missions[0].id+"-timed-demo");
      showView("launch",missions[0],false,true);
    },
    run(action) {
      if (action === 1) return advance();
      if (Object.hasOwn(demoActions,action)) return demoActions[action]();
      const control = find(action);
      if (!control || control.hidden || control.disabled) return false;
      control.click();
      return true;
    },
    busy:()=>Boolean(activeBurn || ascentPlaying),
    next:()=>flightState().next,
    suspend() {
      clearTimeout(ascentTimer);
      ascentTimer = null;
      cancelAnimationFrame(orbitConfirmation);
      scene.hide();
      burnScene.hide();
    },
    resume(pausedFor) {
      if (activeBurn) {
        orbitPreviewStarted += pausedFor;
        orbitPreviewUntil += pausedFor;
        orbitConfirmation = requestAnimationFrame(animateBurn);
      }
      renderView();
      animateAscent();
    },
  });
  find("start-timed-demo").addEventListener("click",demo.start);
  find("demo-exit").addEventListener("click",exit);
  document.addEventListener("click",event=>{
    if (demo.active && event.isTrusted && event.target.closest(
      "#launch-controls,#launch-jobs,#launch-systems,#pad-transport,#play,#step,#next-event,"+
      "#speed-cycle,#end-mission,#assign-asset,#assign-routine,#request-peer-check,#activity"
    )) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  },true);

  function startNew(mission) {
    resetCrew(mission.id);
    const saved = saves.write(mission,fresh(mission));
    find("campaign-notice").textContent = saved ? "" : "Browser storage is unavailable. This run can only resume in this tab.";
    showView("launch",mission,true);
    showCheckoutTutorial();
  }

  const replacement = find("replace-campaign");
  let replacementMission = null;
  replacement.addEventListener("close",()=>{
    if (replacement.returnValue === "replace" && replacementMission) startNew(replacementMission);
    replacementMission = null;
  });
  const menuUI = bindFlightMenu(missions,crew,replayVersion,{
    select(mission) { showView("menu",mission,true); },
    launch(newRun) {
      const saved = saves.read(config);
      if (!newRun && saved) showView("launch",config,true);
      if (newRun && !saved) startNew(config);
      if (newRun && saved) {
        replacementMission = config;
        replacement.returnValue = "cancel";
        find("replace-campaign-text").textContent = "This will replace the saved " + config.title + " campaign.";
        replacement.showModal();
      }
    },
    replay() { showView("replay",config,true); },
  });
  for (const id of ["show-missions","launch-open-missions"]) find(id).addEventListener("click",exit);
  for (const id of ["map-plan-open","launch-open-objectives","guide-plan"]) find(id).addEventListener("click",openObjectives);
  find("guide-focus").addEventListener("click",()=>{
    if (!guideTarget || guideTarget.disabled) return;
    if (guideTarget.closest("#mission-command-widget")) openCommand(find("guide-focus"));
    if (guideTarget.closest("[hidden]")) return;
    guideTarget.focus();
    guideTarget.scrollIntoView({block:"nearest",inline:"nearest"});
  });
  const syncView = () => {
    const next = route();
    showView(next.view,next.mission);
  };
  window.addEventListener("popstate",syncView);
  queueMicrotask(syncView);
  find("launch-arm").addEventListener("click",()=>{
    if (state.hold || !systemsReady() || !ready() || state.armed !== null || state.ignition !== null) return;
    state.armed = state.time;
    announceHelmets();
    persist();
    render();
  });
  find("launch-step").addEventListener("click", advance);
  find("launch-hold").addEventListener("click", () => {
    if (state.ignition !== null) return;
    state.hold = !state.hold;
    if (state.hold) {
      state.armed = null;
      stopPlayback();
    }
    persist();
    render();
  });
  find("launch-go").addEventListener("click", () => {
    if (find("launch-go").disabled || state.ignition !== null) return;
    stopPlayback();
    state.ignition = state.time;
    ascentPlaying = true;
    persist();
    renderView();
    animateAscent();
  });
  find("launch-separate").addEventListener("click",()=>{
    if (!flightState().separate) return;
    state.separation = state.time;
    ascentPlaying = true;
    persist();
    renderView();
    animateAscent();
  });
  find("launch-insert").addEventListener("click",()=>{
    if (!flightState().insert) return;
    state.insertion = state.time;
    showManeuver("insertion");
    persist();
    renderView();
  });
  find("launch-systems-check").addEventListener("click",()=>{
    if (rendezvous || state.insertion === null || state.systemsCheckAt !== null) return;
    state.systemsCheckAt = state.time;
    persist();
    renderView();
  });
  find("launch-abort").addEventListener("click", () => {
    if (activeBurn || flightState().terminal || state.ignition === null) return;
    stopPlayback();
    state.aborted = true;
    persist();
    renderView();
  });
  find("launch-phasing").addEventListener("click", () => {
    if (activeBurn || !flightState().phaseBurn) return;
    stopPlayback();
    state.phasing = state.time;
    state.transferArrival = state.time+config.navigation.transferS;
    state.attitude = 0;
    showManeuver("transfer");
    persist();
    renderView();
  });
  find("launch-coast").addEventListener("click", () => {
    const destination = flightState().warpTo;
    if (activeBurn || destination === undefined) return;
    stopPlayback();
    showManeuver("coast",destination);
    persist();
    renderView();
  });
  find("launch-match").addEventListener("click", () => {
    if (activeBurn || !flightState().matchBurn) return;
    state.matchedAt = state.time;
    state.attitude = 0;
    showManeuver("match");
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
    if (activeBurn || !rendezvous || !flight.orbit || state.capture !== null || flight.terminal ||
        exteriorBusy(config.id,state.time)) return;
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
    ["launch-research","researchAt"],["launch-archive","archivedAt"],["launch-depart","departedAt"],["launch-deorbit","deorbitAt"],
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

  return {advance:()=>{if (!demo.active) advance();},advanceToCheckpoint,togglePlayback,cycleSpeed,refreshCrewWork:()=>renderView(false),
    paintNavigation:time=>navigation.showAt(time)};
}

function missionStamp(seconds) {
  return "T+" + Math.floor(seconds/60) + ":" + String(seconds%60).padStart(2,"0");
}

function createMissionPlan(find) {
  const phases = [
    ["Checkout","Pad","clipboard-list",["checks","countdown"]],
    ["Ascent","Ascent","zap",["separation"]],
    ["Orbital insertion","Orbit","map",["insertion"]],
    ["Rendezvous","Dock","radio",["phasing","match","capture","hatch"]],
    ["Station research","ISS","flask-conical",["transfer","research"]],
    ["Orbital systems","Orbit","activity",["systems"]],
    ["Earth return","Return","rotate-ccw",["departure","deorbit","landing","return"]],
  ];
  const icons = {
    checks:"clipboard-list",countdown:"play",separation:"zap",insertion:"map",phasing:"zap",match:"activity",
    capture:"radio",hatch:"wind",transfer:"package",research:"flask-conical",systems:"activity",
    departure:"skip-forward",deorbit:"rotate-ccw",landing:"map",return:"users",
  };
  const labels = {verified:"Verified",upcoming:"Upcoming",next:"Next",held:"Held",incomplete:"Incomplete"};
  const stageLabels = {complete:"Complete",current:"Current",held:"Held",incomplete:"Incomplete",upcoming:"Upcoming"};
  const rows = new Map();
  let stages = [];
  let ship = "";

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  }
  function setText(element, value) {
    if (element.textContent !== value) element.textContent = value;
  }
  function mark(element, state) {
    if (element.dataset.step !== state) element.dataset.step = state;
    if (state === "current" || state === "held" || state === "incomplete") element.setAttribute("aria-current","step");
    else element.removeAttribute("aria-current");
  }

  function build(mission) {
    ship = mission.ship;
    setText(find("mission-objective-ship"),mission.ship+" · "+mission.title);
    setText(find("mission-objective-brief"),mission.objective);
    rows.clear();
    const milestones = find("map-milestones");
    const details = find("mission-objective-list");
    const track = find("guide-track");
    for (const list of [milestones,details,track]) list.replaceChildren();

    const phaseDefinitions = [...phases];
    const known = new Set(phases.flatMap(phase=>phase[3]));
    const other = mission.sequence.objectives.filter(objective=>!known.has(objective.id)).map(objective=>objective.id);
    if (other.length) phaseDefinitions.push(["Other objectives","Other","clipboard-list",other]);
    stages = phaseDefinitions.flatMap(([title,short,icon,ids])=>{
      const objectives = mission.sequence.objectives.filter(objective=>ids.includes(objective.id));
      if (!objectives.length) return [];
      const milestone = node("li");
      const marker = node("span","plan-mark");
      setIcon(marker,icon,"");
      milestone.append(marker,node("span","plan-milestone-label",short));
      milestones.append(milestone);

      const card = node("li","plan-stage");
      const heading = node("h3");
      const phaseIcon = node("span");
      setIcon(phaseIcon,icon,"");
      const badge = node("small");
      heading.append(phaseIcon,document.createTextNode(title),badge);
      const tasks = node("ol","plan-tasks");
      card.append(heading,tasks);
      details.append(card);

      for (const objective of objectives) {
        const row = node("li");
        const taskIcon = node("span","plan-task-icon");
        setIcon(taskIcon,icons[objective.id] ?? "clipboard-list","");
        const copy = node("div");
        const status = node("small");
        copy.append(node("strong",null,objective.label),status);
        row.append(taskIcon,copy);
        tasks.append(row);
        rows.set(objective.id,{row,status,segment:node("i")});
      }
      return [{title,objectives,milestone,card,badge}];
    });
    for (const {id} of mission.sequence.objectives) track.append(rows.get(id).segment);
  }

  function render(objectives, flight) {
    const byId = new Map(objectives.map(objective=>[objective.id,objective]));
    const current = objectives.find(objective=>objective.status !== "verified");
    for (const {id,status,actual,planned_s:planned} of objectives) {
      const {row,status:badge,segment} = rows.get(id);
      if (row.dataset.status !== status) row.dataset.status = status;
      segment.dataset.step = status === "verified" ? "complete" : current?.id === id ? "current" : "upcoming";
      const timing = planned == null ? "" : "Plan "+missionStamp(planned)+" · ";
      setText(badge,timing+labels[status]+(actual == null ? "" : " · "+missionStamp(actual)));
    }
    for (const stage of stages) {
      const complete = stage.objectives.every(objective=>byId.get(objective.id).status === "verified");
      const active = stage.objectives.some(objective=>objective.id === current?.id);
      const state = complete ? "complete" : active ? current.status === "next" ? "current" : current.status : "upcoming";
      mark(stage.milestone,state);
      mark(stage.card,state);
      const label = stage.title+" · "+stageLabels[state];
      stage.milestone.title = label;
      stage.milestone.setAttribute("aria-label",label);
      setText(stage.badge,stageLabels[state]);
    }
    const icon = icons[current?.id] ?? "clipboard-list";
    const marker = find("map-current-icon");
    if (marker.dataset.icon !== icon) {
      setIcon(marker,icon,"");
      marker.dataset.icon = icon;
    }
    setText(find("map-current-objective"),current?.label ?? "Crew safely back on Earth");
    setText(find("map-current-state"),ship+" · "+(current ? labels[current.status] : "Complete"));
    setText(find("mission-objective-next"),flight.phase+" · "+flight.next);
  }

  return {build,render};
}

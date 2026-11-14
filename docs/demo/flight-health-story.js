// The timed Flight presentation drives a separate, synthetic health-story run.
function bindFlightHealthStory({find, clock, metrics, openTwin, onUpdate}) {
  const crewId = "SIM-01";
  const panel = find("live-health-story");
  const button = find("show-health-story");
  const indicators = find("health-story-indicators");
  const pulse = document.createElement("output");
  let session;

  for (const {id, label} of metrics) {
    const item = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = label;
    if (id === "heart_rate") item.append(name, pulse);
    else item.append(name, " · Unobserved");
    indicators.append(item);
  }

  function paint() {
    const story = session?.view;
    const caseStatus = story?.emergency;
    const delivery = story?.ground_delivery;
    const assessment = story?.health_assessment;
    const ground = session?.ground;
    const state = story?.story_state;
    const title = {
      clear:"Baseline within personal range",
      insufficient:"More evidence needed",
      review:"Review resting heart rate",
      emergency:"Chest-pain training drill",
      unobserved:"Unobserved",
    }[state];
    const emergencyButton = find("show-flight-emergency");
    emergencyButton.hidden = !story && !new URLSearchParams(location.search).get("run_id");
    button.hidden = !story;
    const buttonText = story ? "Mara · " + title : "";
    if (button.textContent !== buttonText) button.textContent = buttonText;

    find("health-story-state").textContent = title ?? "";
    panel.dataset.state = state ?? "";
    find("health-story-pin").textContent = {
      clear:"Baseline", insufficient:"Watch", review:"Review", emergency:"Local alert", unobserved:"Unobserved",
    }[state] ?? "";
    pulse.textContent = assessment ? " · " + assessment.evidence.value + " " + assessment.evidence.unit : " · Unobserved";
    find("health-story-time").textContent = assessment ? "Story T+" + clock(story.mission_s) +
      " · Sample T+" + clock(assessment.observed_at_s) : "";
    find("health-story-reason").textContent = assessment?.personal.reason ?? "";
    find("health-story-trend").textContent = story?.health_trend?.reason ?? "";
    const gravity = story?.gravity_context;
    find("health-story-gravity").hidden = !gravity;
    if (gravity) {
      const phase = {preflight:"Preflight", orbit:"Orbital microgravity", reentry:"Reentry", recovery:"Earth recovery"};
      find("gravity-summary").textContent = phase[gravity.current.phase] + " · " +
        clock(gravity.elapsed_in_phase_s) + " in phase · " + clock(gravity.orbital_exposure_s) + " in orbit";
      for (const field of ["mobility", "orientation", "rest"]) {
        find("gravity-baseline-" + field).textContent = gravity.baseline[field];
        find("gravity-current-" + field).textContent = gravity.current[field];
      }
    }
    find("health-story-case").textContent = caseStatus
      ? caseStatus.acknowledgment ? "Local response acknowledged" : "Local alert raised · crew response pending"
      : "";
    find("health-story-delivery").textContent = {
      not_shared:"Case status stays onboard until Crew shares it.",
      queued:delivery && "Ground delivery at T+" + clock(delivery.deliver_at_s) +
        " · " + clock(delivery.remaining_s) + " remaining. Only case status will be sent.",
      delivered:delivery && "Case status delivered to Ground at T+" + clock(delivery.delivered_at_s),
    }[delivery?.status] ?? "";
    const actions = [
      ["open-health-drill", state === "review" && !caseStatus],
      ["ack-health-drill", caseStatus && !caseStatus.acknowledgment],
      ["share-health-drill", caseStatus?.acknowledgment && delivery?.status === "not_shared"],
      ["advance-health-relay", delivery?.status === "queued"],
    ];
    for (const [id, visible] of actions) {
      const control = find(id);
      control.hidden = !visible;
      control.disabled = Boolean(session?.working);
    }
    find("health-story-error").textContent = session?.error ?? "";
    const report = find("ground-health-story");
    report.hidden = !ground;
    report.textContent = ground ? "Training case · " + ground.review_priority + " · " + ground.status +
      " · received T+" + clock(ground.delivered_at_s) : "";
  }

  async function request(active, path, {role, body} = {}) {
    const response = await fetch(path, {
      method: body !== undefined || !role ? "POST" : "GET",
      cache:"no-store",
      signal:AbortSignal.any([active.abort.signal, AbortSignal.timeout(5000)]),
      headers:{
        ...(role ? {Authorization:"Bearer " + active.tokens[role]} : {}),
        ...(body ? {"Content-Type":"application/json"} : {}),
      },
      ...(body ? {body:JSON.stringify(body)} : {}),
    });
    if (!response.ok) throw new Error("Health story request failed");
    return response.json();
  }

  async function refresh(active) {
    const view = await request(active, active.run + "/crew/health-twin?" + new URLSearchParams({crew_id:crewId}), {role:"crew"});
    if (view.scenario_id !== "health-story" || view.crew_id !== crewId || view.role !== "crew") {
      throw new Error("Health story response mismatch");
    }
    if (active.run !== "/api/v1/runs/" + encodeURIComponent(view.run_id)) {
      throw new Error("Health story run mismatch");
    }
    active.view = view;
    if (view.ground_delivery?.status === "delivered" && !active.ground) {
      // Ground shows only its own delivered projection. The Crew case never supplies this content.
      const ground = await request(active, active.run + "/ground", {role:"ground"});
      if (ground.role !== "ground" || ground.run_id !== view.run_id) throw new Error("Ground response mismatch");
      active.ground = ground.health_cases.at(-1);
    }
  }

  async function work(active, action) {
    if (session !== active || active.working) return;
    active.working = true;
    active.error = "";
    paint();
    try {
      await action();
      active.failed = false;
    } catch {
      active.failed = true;
      active.error = "Live health story unavailable. The timed mission can continue.";
    } finally {
      active.working = false;
      if (session === active) {
        paint();
        onUpdate();
      }
    }
  }

  async function advance(active, target) {
    const result = await request(active, active.run + "/advance", {
      role:"facilitator", body:{advance_id:"health-story-" + target, expected_step:active.step, target_mission_s:target},
    });
    active.step = result.step;
    await refresh(active);
  }

  function drive(active) {
    if (session !== active || !active.view || active.working || active.failed) return;
    const current = active.view.mission_s;
    const delivery = active.view.ground_delivery;
    const gravity = active.view.gravity_context;
    const nextPhase = gravity?.next_phase_at_s;
    const phaseDue = (gravity?.current.phase === "orbit" && active.enteringAtmosphere) ||
      (gravity?.current.phase === "reentry" && active.recovered);
    const nextReading = current < 60 ? 60 : 360;
    const target = current < 360 ? (active.flightTime >= nextReading ? nextReading : current)
      : delivery?.status === "queued" ? Math.min(delivery.deliver_at_s,
        delivery.issued_at_s + Math.max(0, active.flightTime - active.sharedAtFlightTime))
      : phaseDue && nextPhase != null ? nextPhase : current;
    if (target > current) {
      work(active, () => advance(active,target)).then(() => drive(active));
    }
  }

  async function start() {
    stop();
    if (location.protocol === "file:") return;
    const active = {abort:new AbortController(), flightTime:0};
    session = active;
    await work(active, async () => {
      active.tokens = await request(active, "/api/v1/demo/session");
      const result = await request(active, "/api/v1/runs", {
        role:"facilitator", body:{start_id:crypto.randomUUID(), scenario_id:"health-story", scenario_version:"1", seed:4242},
      });
      active.run = "/api/v1/runs/" + encodeURIComponent(result.run_id);
      active.step = result.step;
      await refresh(active);
    });
    drive(active);
  }

  function stop() {
    session?.abort.abort();
    session = undefined;
    paint();
  }

  function update(flight) {
    if (!session || !flight?.timedDemo) return;
    session.flightTime = Math.max(session.flightTime, Math.floor(flight.time - flight.crewStarted));
    session.enteringAtmosphere = Boolean(flight.recovery);
    session.recovered = flight.recovery?.phase === "recovered";
    drive(session);
  }

  function caseAction(path, body, onSuccess) {
    const active = session;
    if (!active?.view) return;
    work(active, async () => {
      await request(active, active.run + "/crew/emergencies" + path, {role:"crew",body});
      onSuccess?.(active);
      await refresh(active);
    }).then(() => drive(active));
  }

  find("open-health-drill").addEventListener("click", () => caseAction("", {
    operation_id:"open-health-story", drill_id:"drill-chest-pain-v1", reported_by:crewId, synthetic:true,
  }));
  find("ack-health-drill").addEventListener("click", () => {
    const emergency = session?.view?.emergency;
    if (emergency) caseAction("/" + encodeURIComponent(emergency.case_id) + "/acknowledgment",
      {acknowledged_by:emergency.owner});
  });
  find("share-health-drill").addEventListener("click", () => {
    const emergency = session?.view?.emergency;
    if (emergency) caseAction("/" + encodeURIComponent(emergency.case_id) + "/relay",
      {operation_id:"share-health-story"}, active => { active.sharedAtFlightTime = active.flightTime; });
  });
  find("advance-health-relay").addEventListener("click", () => {
    const active = session;
    const delivery = active?.view?.ground_delivery;
    if (delivery?.status === "queued") work(active, () => advance(active,delivery.deliver_at_s));
  });
  button.addEventListener("click", () => openTwin(crewId,button));
  return {
    start, stop, update,
    runId() { return session?.view?.run_id; },
    // Only a reported localized case is mapped to an anatomical hotspot.
    // No unsupported localization for collapse, general exposure or sensor changes.
    issueFor(subjectId) {
      const reported=session?.view?.emergency;
      if (!reported || reported.kind !== "chest_pain" ||
          (reported.subject_crew_id ?? crewId) !== subjectId) return null;
      return {
        region:"torso", title:"Reported chest pain · local emergency",
        symptoms:reported.report ?? "Chest-pain emergency drill reported by Crew",
        evidence:"Reported symptom only; not a diagnosis or inferred heart condition",
        action:"Follow the approved onboard emergency procedure and contact the responder",
        missionTime:reported.opened_at_s, source:"onboard emergency case",
      };
    },
    visibleFor(id, timed) { return Boolean(timed && id === crewId && session?.view); },
  };
}

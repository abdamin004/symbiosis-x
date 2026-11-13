// Local replay of an inspection request. Ground advises; the Commander assigns.
const flightWorkflow = (() => {
  const key = "sx:iss-research-v1:inspection";
  const delay = 300;
  const tick = 15;
  const routineDue = 360;
  const timebox = time => {
    const assigned = Math.ceil(time / tick) * tick;
    return {assigned,arrival:assigned+tick,finishes:assigned+3*tick};
  };

  function read() {
    try { return JSON.parse(localStorage.getItem(key)); }
    catch { return null; }
  }

  function save(order) {
    localStorage.setItem(key, JSON.stringify(order));
  }

  function canSend(frame) {
    return !read() && frame.vehicle === "Outbound capsule" && frame.time >= 360 && frame.time <= 780;
  }

  function send(frame) {
    if (!canSend(frame)) return;
    save({sent:frame.time, arrives:frame.time + delay, basis:"v102", expires:14400});
  }

  function canDecide(frame, order = read()) {
    return Boolean(order && !order.decision && frame.time >= order.arrives
      && frame.time < order.expires && frame.vehicle === "Outbound capsule");
  }

  function decide(frame, approved, origin = null) {
    const order = read();
    if (!canDecide(frame, order)) return;
    const work = timebox(frame.time);
    if (approved && work.finishes >= order.expires) return;
    save({...order, decision:approved ? "Assigned" : "Held", decided:frame.time,
      assigned:approved ? "SIM-03" : null, work:approved ? {...work,origin} : null});
  }

  function job(frame, order = read()) {
    if (!order || frame.time < order.arrives) return null;
    if (order.completed != null && frame.time >= order.completed) return {state:"Reported"};
    if (order.decision === "Held" && frame.time >= order.decided) return {state:"Held"};
    if (frame.time >= order.expires) return {state:"Deadline missed"};
    if (order.decision !== "Assigned" || frame.time < order.decided) return {state:"Awaiting Commander"};
    const work = order.work ?? timebox(order.decided);
    const state = frame.time < work.assigned ? "Queued" : frame.time < work.arrival ? "Travelling"
      : frame.time < work.finishes ? "Inspecting" : "Ready to report";
    return {state,work};
  }

  function canComplete(frame, order = read()) {
    return frame.vehicle === "Outbound capsule" && order?.completed == null && job(frame,order)?.state === "Ready to report";
  }

  function routine(frame, task) {
    if (task && frame.time >= task.finishes) return "Complete";
    if (frame.time >= routineDue) return "Deadline missed";
    if (!task) return "Awaiting Commander";
    if (frame.time < task.assigned) return "Queued";
    if (frame.time < task.arrival) return "Travelling";
    return "Inspecting";
  }

  function complete(frame) {
    const order = read();
    if (!canComplete(frame, order)) return;
    save({...order, completed:frame.time, reportDue:frame.time + delay,
      result:{co2:frame.co2, removal:frame.removal, power:frame.power}});
  }

  function status(frame, clock, ground = false) {
    const {time} = frame;
    const order = read();
    if (!order || time < order.sent) return "No Ground inspection request at this checkpoint.";
    const facts = ["Ground sent " + clock(order.sent) + " · basis " + order.basis];
    if (time < order.arrives || ground && time < (order.reportDue ?? Infinity)) {
      facts.push(time < order.arrives ? "Uplink due " + clock(order.arrives) : "Awaiting onboard report");
      return facts.join(" · ");
    }
    facts.push("Commander received " + clock(order.arrives));
    const state = job(frame,order)?.state;
    if (state === "Deadline missed") facts.push("Inspection deadline missed");
    if (["Queued","Travelling","Inspecting","Ready to report"].includes(state)) facts.push(state);
    if (order.decision && time >= order.decided) {
      facts.push("Commander " + order.decision.toLowerCase() + " " + clock(order.decided));
      if (order.assigned) facts.push(order.assigned + " · inspect Life Support");
    }
    if (order.completed != null && time >= order.completed) {
      facts.push("Inspection at " + clock(order.completed) + " · " + order.result.co2.toFixed(2)
        + " ppm CO₂ · " + order.result.removal + " m³/h flow · " + order.result.power.toFixed(2) + " kW");
      facts.push(time >= order.reportDue ? "Ground received " + clock(order.reportDue)
        : "Downlink due " + clock(order.reportDue));
    }
    return facts.join(" · ");
  }

  return {key, read, send, canSend, canDecide, decide, canComplete, complete, status, job, routine, routineDue, timebox,
    reset: () => localStorage.removeItem(key)};
})();

// Browser-local training relay. Its operational record lives inside the selected Flight save.
const campaignGround = (() => {
  const uplink = 45;
  const downlink = 30;
  // Each manual Flight mission step advances 15s; readiness work uses the same cadence.
  const workTick = 15;
  const timebox = time => {
    const assigned = (Math.floor(time / workTick) + 1) * workTick;
    return {assigned,arrival:assigned+workTick,finishes:assigned+3*workTick};
  };
  const holdReasons = ["Readiness evidence incomplete", "Crew or station unavailable", "Operational conditions require review"];
  const issuer = "Simulated Ground · Flight Director";

  function issue(current, time, departure) {
    const expires = Math.max(departure + 600, time + uplink + 600);
    return {
      issuer, basis: "ISS departure readiness · checkpoint T+" + clock(departure),
      sent: time, arrives: time + uplink, expires,
      sequence: (current?.sequence ?? 0) + 1,
    };
  }

  function job(order, time) {
    if (order?.decision !== "assigned" || order.report || time < order.arrives || time >= order.expires) return null;
    const {work} = order;
    return {...work, state:time < work.assigned ? "Queued" : time < work.arrival ? "Travelling"
      : time < work.finishes ? "Inspecting" : "Ready to report"};
  }

  function status(order, time) {
    if (!order) return "missing";
    if (time < order.arrives) return "pending";
    if (order.report && time >= order.report.delivers) return order.report.result;
    if (time >= order.expires) return "expired";
    return order.report ? "report pending" : order.decision ?? "received";
  }

  function receiveDecision(order, time, decision, reason, origin) {
    if (!["received","acknowledged"].includes(status(order,time))) return null;
    const acknowledged = order.acknowledged ?? time;
    if (decision === "hold" && holdReasons.includes(reason)) {
      return {...order, acknowledged, decision:"held", reason,
        report:{result:"held",sent:time,delivers:time + downlink}};
    }
    if (decision === "assign" && origin) {
      const work = timebox(time);
      if (work.finishes + downlink > order.expires) return null;
      return {...order, acknowledged, decision:"assigned", work:{...work,origin}};
    }
    if (decision === "acknowledge") return {...order, acknowledged, decision:"acknowledged"};
    return null;
  }

  function report(order, time) {
    if (job(order,time)?.state !== "Ready to report" || time + downlink > order.expires) return null;
    return {...order, report:{result:"verified",sent:time,delivers:time + downlink}};
  }

  function cleared(order, time) {
    return status(order,time) === "verified" && time <= order.expires;
  }

  return {issuer, downlink, holdReasons, issue, status, job, timebox, receiveDecision, report, cleared};
})();
function bindExerciseInspector({find, runId, clock, session}) {
  const panel = find("exercise-preview");
  const refresh = find("exercise-preview-refresh");
  const commit = find("exercise-preview-commit");
  const status = find("exercise-preview-status");
  let plan, debrief, busy = false, eligible = false, pending;
  const path = "/api/v1/runs/"+encodeURIComponent(runId);
  const number = (value,digits) => value.toFixed(digits);

  async function request(suffix, body) {
    const {crew} = await session();
    const headers = {Authorization:"Bearer "+crew};
    if (body) headers["Content-Type"] = "application/json";
    return fetch(path+suffix,{method:body ? "POST" : "GET",headers,cache:"no-store",
      body:body ? JSON.stringify(body) : undefined});
  }

  function paint() {
    paintDebrief();
    panel.hidden = !eligible || !plan;
    if (panel.hidden) return;
    find("exercise-preview-basis").textContent = "Basis v"+plan.decision_rev+" · T+"+clock(plan.mission_s)
      +" · horizon "+plan.horizon_s+" s · CO₂ limit "+plan.co2_limit_ppm+" ppm · minimum headroom "
      +number(plan.minimum_headroom_kw,2)+" kW";
    find("exercise-preview-options").replaceChildren(...plan.options.map(option=>{
      const row = document.createElement("li");
      const action = option.candidate_id === "keep_exercise" ? "Keep exercise" : "Defer exercise";
      const power = option.reason_code === "POWER_LIMIT" ? " · Held · power limit"
        : option.reason_code === "CO2_PEAK_LIMIT" ? " · Held · CO₂ limit" : " · Eligible";
      const standby = option.standby;
      row.textContent = action+power+" · projected "+number(option.projected_co2_ppm,2)+" ppm CO₂ · peak "
        +number(option.peak_co2_ppm,2)+" ppm · "+number(option.headroom_kw,2)+" kW headroom"
        +" · Standby "+standby.outcome+" ("+number(standby.required_kw,2)+" kW required, "
        +number(standby.available_kw,2)+" kW available)";
      return row;
    }));
    const {decision,outcome} = plan;
    find("exercise-preview-outcome").textContent = decision
      ? "Deferred at T+"+clock(decision.decided_at_s)+" · predicted "+number(decision.projected_co2_ppm,2)+" ppm CO₂"
        + (outcome ? " · observed "+number(outcome.co2_ppm,2)+" ppm CO₂ at T+"+clock(outcome.observed_at_s)
          +" · "+number(outcome.headroom_kw,2)+" kW headroom" : " · awaiting outcome")
      : outcome ? "Exercise kept · observed "+number(outcome.co2_ppm,2)+" ppm CO₂" : "";
    commit.hidden = !plan.can_commit;
    commit.disabled = busy || !plan.options.some(option=>option.candidate_id === "defer_exercise" && option.result === "feasible");
    refresh.disabled = busy;
  }

  function paintDebrief() {
    const panel = find("wearable-debrief");
    panel.hidden = !eligible || !debrief;
    if (panel.hidden) return;
    const {recheck,ground_report:report,outcome} = debrief;
    const stamp = value => value == null ? "Pending" : "T+"+clock(value);
    find("wearable-debrief-delays").textContent =
      "Detection to verified check · "+(debrief.time_to_verified_s == null ? "Pending" : debrief.time_to_verified_s+" s")
      +" · Ground delivery lag · "+(debrief.ground_delivery_lag_s == null ? "Pending" : debrief.ground_delivery_lag_s+" s");
    const milestones = [
      ["Motion artifact detected",recheck?.opened_at_s],
      ["Crew observer assigned",recheck?.assigned_at_s],
      ["Repeat verified",recheck?.completed_at_s],
      ["Commander deferred exercise",debrief.decision_at_s],
      ["Cabin outcome recorded",outcome?.observed_at_s],
      ["Ground operational update",report?.delivered_at_s],
    ];
    find("wearable-debrief-events").replaceChildren(...milestones.map(([label,at])=>{
      const row = document.createElement("li");
      row.textContent = label+" · "+stamp(at);
      if (label === "Ground operational update" && report && at == null) row.textContent += " · due "+stamp(report.deliver_at_s);
      return row;
    }));
  }

  async function load() {
    const response = await request("/crew/exercise-preview");
    if (response.status === 404) { plan = debrief = null; return; }
    if (!response.ok) throw new Error("Exercise preview unavailable.");
    const next = await response.json();
    if (next.run_id !== runId) throw new Error("Exercise preview is for a different run.");
    plan = next;
    const debriefResponse = await request("/crew/wearable-debrief");
    debrief = debriefResponse.ok ? await debriefResponse.json() : null;
    if (debrief?.run_id !== runId) debrief = null;
  }

  async function refreshPlan() {
    if (busy || !eligible) return;
    busy = true;
    paint();
    try { await load(); status.textContent = ""; }
    catch (error) { status.textContent = error.message; }
    finally { busy = false; paint(); }
  }

  refresh.addEventListener("click",refreshPlan);
  commit.addEventListener("click",async ()=>{
    if (busy || !plan?.can_commit) return;
    if (pending?.basis_decision_rev !== plan.decision_rev) pending = {
      operation_id:"exercise-"+crypto.randomUUID(),candidate_id:"defer_exercise",
      basis_decision_rev:plan.decision_rev,basis_snapshot_id:plan.basis_snapshot_id,expires_at_s:plan.outcome_at_s,
    };
    busy = true;
    paint();
    try {
      const response = await request("/actions",pending);
      if (!response.ok) throw new Error("Exercise decision could not be confirmed.");
      const receipt = await response.json();
      pending = null;
      await load();
      status.textContent = receipt.applied ? "Exercise deferral accepted."
        : "Decision held · "+receipt.reason_code.toLowerCase().replaceAll("_"," ")+".";
    } catch (error) { status.textContent = error.message; }
    finally { busy = false; paint(); }
  });

  return {open(replay) { eligible = Boolean(replay && runId); paint(); if (eligible) refreshPlan(); }};
}

// Flight's live Ground tab reads the delayed Ground projection. Orders reads
// the Crew projection separately, and only renders its operational advice trace.
function bindFlightGround({panel, crewReceipt, clock, workflow, replayPacket, rehearsal, redraw}) {
  const field = name => panel.querySelector('[data-ground="' + name + '"]');
  const form = panel.querySelector("form");
  const candidate = form.elements.candidate;
  const send = form.querySelector("button");
  let context, activeRun, timer, session, receipt, pending, busy = false, sendError;
  let epoch = 0;
  const views = new Map();
  const fetching = new Map();
  const unavailable = new Set();
  const pollMs = 1500;
  const rehearsalPackets = [...new Map(rehearsal.frames.map(({ground}) => [ground.snapshot_id, ground])).values()];
  let lastTimeline;
  const actors = {ground:"Ground", monitor:"Onboard monitor", relay:"Relay"};
  const operationalResults = {
    INSUFFICIENT_EVIDENCE:"Insufficient evidence",
    NO_FEASIBLE_PLAN:"No feasible plan",
    FEASIBLE_PLAN:"Feasible plan available",
    linked:"Repeat fault linked",
  };

  function time(seconds) {
    return (seconds < 0 ? "T−" : "T+") + clock(Math.abs(seconds));
  }

  function value(name, text) {
    const node = field(name);
    if (node.textContent !== text) node.textContent = text;
  }

  async function request(run, role, suffix = "", command, retry = true) {
    session ??= fetch("/api/v1/demo/session", {method:"POST", cache:"no-store"}).then(async response => {
      if (!response.ok) throw new Error("SESSION_UNAVAILABLE");
      return response.json();
    }).catch(error => { session = null; throw error; });
    const tokens = await session;
    if (typeof tokens[role] !== "string") throw new Error("ROLE_UNAVAILABLE");
    const headers = {Authorization:"Bearer " + tokens[role], Accept:"application/json"};
    if (command) headers["Content-Type"] = "application/json";
    const response = await fetch("/api/v1/runs/" + encodeURIComponent(run) + "/" + role + suffix, {
      method:command ? "POST" : "GET", headers, cache:"no-store",
      body:command ? JSON.stringify(command) : undefined,
    });
    if (response.status === 401 && retry) {
      session = null;
      return request(run, role, suffix, command, false);
    }
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(typeof body?.detail === "string" ? body.detail : "RELAY_UNAVAILABLE");
    }
    return response.json();
  }

  function refresh(role) {
    if (!activeRun || fetching.has(role)) return;
    const run = activeRun, requestEpoch = epoch;
    const flightRequest = request(run, role).then(view => {
      if (epoch !== requestEpoch) return;
      if (view.run_id !== run || view.role !== role || !Number.isFinite(view.mission_s)) {
        throw new Error("RUN_VIEW_MISMATCH");
      }
      // Keep only the operational trace from Crew, even when its response
      // includes the astronaut's private projection.
      views.set(role, role === "crew" ? {mission_s:view.mission_s, trace:view.trace} : view);
      unavailable.delete(role);
    }).catch(() => {
      if (epoch === requestEpoch) unavailable.add(role);
    }).finally(() => {
      if (fetching.get(role) === flightRequest) fetching.delete(role);
      if (epoch === requestEpoch) paint();
    });
    fetching.set(role, flightRequest);
  }

  function poll() {
    if (context.groundVisible) refresh("ground");
    if (context.crewVisible) refresh("crew");
  }

  function update(next) {
    if (activeRun !== next.relayRunId) {
      activeRun = next.relayRunId;
      epoch += 1;
      views.clear();
      fetching.clear();
      unavailable.clear();
      receipt = pending = sendError = null;
      busy = false;
    }
    const newlyVisible = next.groundVisible && !context?.groundVisible ||
      next.crewVisible && !context?.crewVisible || next.relayRunId !== context?.relayRunId;
    context = next;
    if (activeRun && (next.groundVisible || next.crewVisible)) {
      timer ??= setInterval(poll, pollMs);
      if (newlyVisible) poll();
    } else if (timer != null) {
      clearInterval(timer);
      timer = null;
    }
    paint();
  }

  function decisionStatus(record) {
    if (record.reason_code === "STALE_BASIS") return ["stale", "Stale · held onboard"];
    if (record.reason_code === "ADVICE_EXPIRED") return ["expired", "Expired · held onboard"];
    if (record.result === "held") return ["held", "Held onboard"];
    return ["received", "Received for Crew review"];
  }

  function adviceStatus(queued, received, ownReceipt) {
    if (received) {
      const [state, description] = decisionStatus(received);
      return [state, description + " at " + time(received.mission_s)];
    }
    if (!queued && !ownReceipt) return ["empty", "No advisory queued."];
    const issued = ownReceipt?.issued_at_s ?? queued.mission_s;
    const due = ownReceipt ? " · due onboard " + time(ownReceipt.deliver_at_s) : "";
    return ["pending", "Pending confirmation · issued " + time(issued) + due];
  }

  function renderCrew() {
    crewReceipt.hidden = !activeRun;
    if (!activeRun || !context.crewVisible) return;
    const view = views.get("crew");
    const queued = view?.trace?.findLast(record => record.step === "advice_queued");
    const received = queued && view.trace.findLast(record => record.case_id === queued.case_id && record.step === "advice_received");
    const [state, text] = adviceStatus(queued, received, null);
    crewReceipt.dataset.state = state;
    const summary = unavailable.has("crew") ? "Crew receipt feed unavailable."
      : view ? text + " · Crew clock " + time(view.mission_s) : "Reading Crew receipt…";
    if (crewReceipt.textContent !== summary) crewReceipt.textContent = summary;
  }

  function packetEvent(packet, title, observed, received) {
    return {at:received, title, state:"received",
      detail:"Observed " + time(observed) + " · " + packet.co2.value.toFixed(2) +
        " " + packet.co2.unit + " CO₂ · v" + packet.decision_rev};
  }

  function liveEvents(live, packet, ownReceipt) {
    const events = [];
    if (packet) events.push(packetEvent(packet, "Telemetry received",
      packet.delivery.observed_at_s, packet.delivery.received_at_s));
    for (const record of live?.trace ?? []) {
      const at = record.mission_s;
      if (record.step === "advice_queued") {
        const match = ownReceipt && record.case_id === "advice-" + ownReceipt.operation_id;
        events.push({at, title:"Advice queued", detail:match
          ? "Ground uplink · " + ownReceipt.basis_snapshot_id + " · scheduled for " + time(ownReceipt.deliver_at_s)
          : "Ground uplink"});
      } else if (record.step === "advice_received") {
        const [state, title] = decisionStatus(record);
        events.push({at, title, state, detail:"Relay · onboard decision time"});
      } else if (record.step === "incident_opened" || record.step === "fault_linked") {
        const result = operationalResults[record.result];
        events.push({at, title:record.step === "incident_opened" ? "Operational case opened" : "Repeat fault linked",
          detail:actors[record.actor] + " · observed onboard" + (result ? " · " + result : "")});
      }
    }
    // A successful POST can precede the next Ground poll.
    if (ownReceipt && !live?.trace?.some(record => record.case_id === "advice-" + ownReceipt.operation_id)) {
      events.push({at:ownReceipt.issued_at_s, title:"Advice queued", state:"pending",
        detail:"Ground uplink · " + ownReceipt.basis_snapshot_id + " · due onboard " + time(ownReceipt.deliver_at_s)});
    }
    for (const shared of live?.health_cases ?? []) {
      events.push({at:shared.delivered_at_s, title:"Shared case status received", state:"received",
        detail:shared.case_alias + " · " + shared.review_priority + " · " + shared.status});
    }
    return events;
  }

  function campaignEvents(campaign, now) {
    const order = campaign.order;
    if (!order) return [];
    const report = order.report;
    const events = [{at:order.sent, title:"Readiness direction sent", detail:order.basis}];
    if (now < order.arrives) {
      events.push({at:order.arrives, title:"Uplink due", state:"pending", detail:"Simulated relay · " + (order.arrives-order.sent) + " s delay"});
    } else {
      events.push({at:order.arrives, title:"Received onboard", state:"received", detail:"Simulated uplink"});
    }
    if (report && now >= report.delivers) {
      events.push({at:report.delivers, title:report.result === "verified" ? "Readiness verified" : "Commander hold received",
        state:"received", detail:"Crew report sent " + time(report.sent) + (report.result === "held" && order.reason ? " · " + order.reason : "")});
    } else if (now >= order.expires) {
      events.push({at:order.expires, title:"Readiness direction expired", state:"stale", detail:"Ground deadline"});
    }
    return events;
  }

  function replayEvents(localPacket, order, now) {
    const events = localPacket ? [packetEvent(localPacket, "Primary scrubber degraded",
      localPacket.delivery.observed_at_s, localPacket.delivery.received_at_s)] : [];
    if (!order || now < order.sent) return events;
    events.push({at:order.sent, title:"Inspection requested", detail:"Ground uplink · basis " + order.basis});
    if (now < order.arrives) {
      events.push({at:order.arrives, title:"Uplink due", state:"pending", detail:"Scripted relay"});
    }
    if (order.reportDue != null && now >= order.reportDue) {
      events.push({at:order.reportDue, title:"Inspection report received", state:"received",
        detail:"Crew inspection observed " + time(order.completed)});
    }
    return events;
  }

  function renderTimeline(events) {
    const timeline = field("timeline");
    const rows = events.sort((a,b) => b.at-a.at).slice(0, 8);
    const signature = JSON.stringify(rows);
    if (signature === lastTimeline) return;
    lastTimeline = signature;
    timeline.hidden = !rows.length;
    field("timeline-empty").hidden = Boolean(rows.length);
    timeline.replaceChildren(...rows.map(({at,title,state,detail}) => {
      const item = document.createElement("li");
      if (state) item.dataset.state = state;
      const header = document.createElement("div");
      header.className = "ground-event";
      const label = document.createElement("strong");
      label.textContent = title;
      const timestamp = document.createElement("time");
      timestamp.className = "ground-time";
      if (at >= 0) timestamp.dateTime = "PT" + at + "S";
      timestamp.textContent = time(at);
      header.append(label,timestamp);
      const source = document.createElement("span");
      source.className = "ground-detail";
      source.textContent = detail;
      item.append(header,source);
      return item;
    }));
  }

  function paint() {
    renderCrew();
    if (!context.groundVisible) return;
    const {frame, mode, campaign, rehearsalStart} = context;
    const live = activeRun ? views.get("ground") : null;
    const replay = !activeRun && mode === "replay";
    const localPacket = replay && frame.time >= replayPacket.delivery.received_at_s ? replayPacket : null;
    const drillPackets = rehearsalStart == null ? [] : rehearsalPackets.filter(
      report => frame.time >= rehearsalStart + report.delivery.received_at_s);
    const latestDrill = drillPackets.at(-1);
    const packet = latestDrill ? {...latestDrill, delivery:{
      observed_at_s:rehearsalStart + latestDrill.delivery.observed_at_s,
      received_at_s:rehearsalStart + latestDrill.delivery.received_at_s,
    }} : live?.packet ?? localPacket;
    const missionTime = activeRun ? live?.mission_s : frame.time;
    const delivered = packet?.delivery;
    const age = delivered ? missionTime - delivered.observed_at_s : null;
    panel.dataset.state = unavailable.has("ground") ? "unavailable" : packet ? "received" : "empty";
    value("source", rehearsalStart != null ? "Offline playback · " + rehearsal.source
      : activeRun ? "Run " + activeRun : campaign ? campaignGround.issuer
      : replay ? "ISS Research Replay · synthetic" : "Local flight · synthetic");
    value("clock", missionTime == null ? "—" : time(missionTime));
    field("live-source").hidden = !activeRun;
    value("link", unavailable.has("ground") ? (packet ? "Feed unavailable · last delivery shown" : "Feed unavailable")
      : packet ? "Delayed · packet received"
      : activeRun && !live ? "Reading relay…"
      : campaign ? "Simulated campaign relay"
      : replay || live ? "Awaiting first delivery" : "Relay unavailable for this run");
    field("telemetry").hidden = !packet;
    field("power-row").hidden = !packet?.power_headroom;
    if (packet) {
      value("basis", packet.snapshot_id + " · v" + packet.decision_rev);
      value("co2", packet.co2 ? packet.co2.value.toFixed(latestDrill ? 2 : 0) + " " + packet.co2.unit : "—");
      value("power", packet.power_headroom ? packet.power_headroom.value.toFixed(2) + " " + packet.power_headroom.unit : "—");
      value("observed", time(delivered.observed_at_s));
      value("received", time(delivered.received_at_s));
      value("age", clock(age));
    }
    const operationalCase = live?.trace?.findLast(record => record.step === "incident_opened" || record.step === "fault_linked");
    const sharedCase = live?.health_cases?.at(-1);
    const caseSummary = latestDrill?.case_status ?? (sharedCase ? sharedCase.case_alias + " · " + sharedCase.review_priority + " · " + sharedCase.status +
      " · received " + time(sharedCase.delivered_at_s)
      : operationalCase ? operationalCase.case_id + " · " + (operationalCase.step === "fault_linked" ? "fault linked" : "incident opened") +
        " · observed " + time(operationalCase.mission_s)
      : localPacket ? "Primary scrubber degraded" : "");
    value("case", caseSummary || "No case delivered");
    field("case-outside").hidden = Boolean(packet) || !caseSummary;
    value("case-outside", caseSummary);

    form.hidden = !activeRun && !replay;
    candidate.hidden = replay;
    field("candidate-label").hidden = replay;
    send.textContent = busy ? "Sending…" : replay ? "Request inspection" : "Queue advice";
    candidate.disabled = busy;
    send.disabled = busy || (activeRun
      ? unavailable.has("ground") || !packet || live?.status !== "active"
      : !replay || !workflow.canSend(frame));

    const queued = live?.trace?.findLast(record => record.step === "advice_queued");
    const ownReceipt = receipt && (!queued || receipt.issued_at_s >= queued.mission_s) ? receipt : null;
    const caseId = ownReceipt ? "advice-" + ownReceipt.operation_id : queued?.case_id;
    const received = caseId && live?.trace?.findLast(record => record.step === "advice_received" && record.case_id === caseId);
    const [state, text] = adviceStatus(queued, received, ownReceipt);
    const order = replay ? workflow.read() : null;
    const localState = order && frame.time >= order.sent
      ? frame.time >= (order.reportDue ?? Infinity) ? "received" : "pending"
      : "empty";
    field("advice").hidden = Boolean(campaign);
    field("advice").dataset.state = replay ? localState : state;
    value("advice", replay ? workflow.status(frame, clock, true) : text);
    value("send-error", sendError ?? "");
    const events = activeRun ? liveEvents(live, packet, receipt)
      : campaign ? campaignEvents(campaign, frame.time)
      : drillPackets.length ? drillPackets.map(report => packetEvent(report, report.case_status,
        rehearsalStart + report.delivery.observed_at_s, rehearsalStart + report.delivery.received_at_s))
      : replayEvents(localPacket, order, frame.time);
    renderTimeline(events);
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (send.disabled) return;
    if (!activeRun) {
      workflow.send(context.frame);
      redraw();
      return;
    }
    const run = activeRun, requestEpoch = epoch;
    const basis = views.get("ground")?.packet?.snapshot_id;
    if (!basis || !candidate.value) return;
    if (pending?.basis_snapshot_id !== basis || pending.candidate_id !== candidate.value) {
      pending = {operation_id:"flight-advice-" + crypto.randomUUID(),
        basis_snapshot_id:basis, candidate_id:candidate.value};
    }
    busy = true;
    sendError = null;
    paint();
    try {
      const result = await request(run, "ground", "/advisories", pending);
      if (epoch !== requestEpoch) return;
      if (result.run_id !== run || result.operation_id !== pending.operation_id || result.status !== "queued") {
        throw new Error("RELAY_UNAVAILABLE");
      }
      receipt = result;
      pending = null;
      refresh("ground");
    } catch (error) {
      if (epoch === requestEpoch) sendError = "Advice could not be confirmed (" + error.message + ").";
    } finally {
      if (epoch === requestEpoch) { busy = false; paint(); }
    }
  });

  return {update};
}

function bindCampaignGround({find, clock, act, inspectionReady, origin}) {
  const issue = find("campaign-ground-issue");
  const ack = find("campaign-ground-ack");
  const assign = find("campaign-ground-assign");
  const hold = find("campaign-ground-hold");
  const reason = find("campaign-ground-hold-reason");
  const report = find("campaign-ground-report");
  let selectedOrder;
  reason.replaceChildren(new Option("Select a reason",""),...campaignGround.holdReasons.map(label=>new Option(label,label)));

  const stamp = seconds => "T+" + clock(seconds);
  const statusText = (order, time) => [
    order.issuer, order.basis, "Sent " + stamp(order.sent),
    (time < order.arrives ? "Uplink due " : "Received onboard ") + stamp(order.arrives),
    time < order.arrives ? "In transit" : time >= order.expires ? "Expired" : "Fresh · age " + clock(time-order.arrives),
    "Deadline " + stamp(order.expires),
  ].join(" · ");

  function update(campaign, time) {
    find("campaign-ground-order").hidden = !campaign;
    find("campaign-ground-relay").hidden = !campaign;
    if (!campaign) { selectedOrder = null; reason.value = ""; return; }
    const {order, required, issueAllowed} = campaign;
    if (selectedOrder !== order?.sequence) reason.value = "";
    selectedOrder = order?.sequence;
    const status = campaignGround.status(order,time);
    const work = campaignGround.job(order,time);
    const facts = order ? statusText(order,time) : required
      ? "No Ground direction received. ISS transfer requires a readiness report."
      : "No Ground direction in this saved campaign.";
    const delivery = order?.report;
    let downlink = "";
    if (delivery) {
      downlink = time < delivery.delivers ? " · Awaiting report delivery"
        : " · Ground received " + (delivery.result === "verified" ? "readiness verified" : "a hold")
          + " at " + stamp(delivery.delivers) + (order.reason ? " · " + order.reason : "");
    } else if (order && time >= order.arrives) {
      downlink = " · Awaiting onboard report";
    }
    const groundStatus = find("campaign-ground-status");
    const groundText = facts + downlink;
    if (groundStatus.textContent !== groundText) groundStatus.textContent = groundText;
    issue.hidden = !issueAllowed;
    issue.disabled = !["missing","held","expired","verified"].includes(status);
    let onboard = order && time >= order.arrives ? facts : order ? "No direction delivered yet." : facts;
    if (order?.acknowledged != null) onboard += " · Acknowledged " + stamp(order.acknowledged);
    if (work) onboard += " · Ivo Reyes · " + work.state + " at the scrubber rack";
    if (status === "held") onboard += " · Commander hold · " + order.reason;
    if (delivery) onboard += " · " + (delivery.result === "held" ? "Hold" : "Readiness report")
      + " sent " + stamp(delivery.sent) + downlink;
    const crewStatus = find("campaign-ground-receipt");
    if (crewStatus.textContent !== onboard) crewStatus.textContent = onboard;

    const canDecide = issueAllowed && ["received","acknowledged"].includes(status);
    ack.hidden = !canDecide || status === "acknowledged";
    assign.hidden = !canDecide;
    assign.disabled = !inspectionReady(time) || campaignGround.timebox(time).finishes+campaignGround.downlink > (order?.expires ?? 0);
    find("campaign-ground-hold-label").hidden = hold.hidden = !canDecide;
    hold.disabled = !reason.value.trim();
    report.hidden = !issueAllowed || work?.state !== "Ready to report";
    report.disabled = Boolean(order && time+campaignGround.downlink > order.expires);
  }

  issue.addEventListener("click",()=>act("issue"));
  ack.addEventListener("click",()=>act("acknowledge"));
  assign.addEventListener("click",()=>{if (!assign.disabled) act("assign",{origin:origin()});});
  reason.addEventListener("input",()=>{hold.disabled = !reason.value.trim();});
  hold.addEventListener("click",()=>act("hold",{reason:reason.value.trim()}));
  report.addEventListener("click",()=>act("report"));

  return {update};
}

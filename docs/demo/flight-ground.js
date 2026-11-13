// Flight's live Ground tab reads the delayed Ground projection. Orders reads
// the Crew projection separately, and only renders its operational advice trace.
function bindFlightGround({panel, crewReceipt, clock, workflow, replayPacket, redraw}) {
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

  function adviceStatus(queued, received, ownReceipt) {
    if (received) {
      const at = " at " + time(received.mission_s);
      if (received.reason_code === "STALE_BASIS") return ["stale", "Stale · held onboard" + at];
      if (received.reason_code === "ADVICE_EXPIRED") return ["expired", "Expired · held onboard" + at];
      return ["received", "Received for Crew review" + at];
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

  function paint() {
    renderCrew();
    if (!context.groundVisible) return;
    const {frame, mode} = context;
    const live = activeRun ? views.get("ground") : null;
    const replay = !activeRun && mode === "replay";
    const localPacket = replay && frame.time >= replayPacket.delivery.received_at_s ? replayPacket : null;
    const drill = frame.healthDrill?.ground;
    const packet = drill?.packet ?? live?.packet ?? localPacket;
    const missionTime = activeRun ? live?.mission_s : frame.time;
    const delivered = packet?.delivery;
    const age = delivered ? missionTime - delivered.observed_at_s : null;
    panel.dataset.state = unavailable.has("ground") ? "unavailable" : packet ? "received" : "empty";
    value("source", drill?.source ?? (activeRun ? "Run " + activeRun : replay ? "ISS Research Replay · synthetic" : "Local flight · synthetic"));
    value("clock", missionTime == null ? "—" : time(missionTime));
    value("link", unavailable.has("ground") ? (packet ? "Feed unavailable · last delivery shown" : "Feed unavailable")
      : packet ? "Delayed · packet received"
      : activeRun && !live ? "Reading relay…"
      : replay || live ? "Awaiting first delivery" : "Relay unavailable for this run");
    field("telemetry").hidden = !packet;
    if (packet) {
      value("basis", packet.snapshot_id + " · v" + packet.decision_rev);
      value("co2", packet.co2 ? packet.co2.value.toFixed(drill ? 2 : 0) + " ppm" : "—");
      value("power", packet.power_headroom ? packet.power_headroom.value.toFixed(2) + " kW" : "—");
      value("observed", time(delivered.observed_at_s));
      value("received", time(delivered.received_at_s));
      value("age", clock(age));
    }
    const operationalCase = live?.trace?.findLast(record => record.step === "incident_opened" || record.step === "fault_linked");
    const sharedCase = live?.health_cases?.at(-1);
    value("case", drill?.caseStatus ?? (sharedCase ? sharedCase.case_alias + " · " + sharedCase.review_priority + " · " + sharedCase.status +
      " · received " + time(sharedCase.delivered_at_s)
      : operationalCase ? operationalCase.case_id + " · " + (operationalCase.step === "fault_linked" ? "fault linked" : "incident opened") +
        " · observed " + time(operationalCase.mission_s)
      : localPacket ? "Primary scrubber degraded" : "No case delivered"));

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
    field("advice").dataset.state = replay ? localState : state;
    value("advice", replay ? workflow.status(frame, clock, true) : text);
    value("send-error", sendError ?? "");
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

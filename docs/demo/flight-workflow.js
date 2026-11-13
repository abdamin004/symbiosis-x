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

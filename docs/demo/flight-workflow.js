// Local replay of an inspection request. Ground advises; the Commander assigns.
const flightWorkflow = (() => {
  const key = "sx:iss-research-v1:inspection";
  const delay = 300;

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

  function decide(frame, approved) {
    const order = read();
    if (!canDecide(frame, order)) return;
    save({...order, decision:approved ? "Assigned" : "Held", decided:frame.time,
      assigned:approved ? "SIM-03" : null});
  }

  function canComplete(frame, order = read()) {
    return Boolean(order?.assigned && frame.time >= order.decided
      && order.completed == null && frame.vehicle === "Outbound capsule");
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
    if (time >= order.expires && !order.decision) facts.push("Review window expired");
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

  return {key, read, send, canSend, canDecide, decide, canComplete, complete, status,
    reset: () => localStorage.removeItem(key)};
})();

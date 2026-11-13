// Replay evidence assistants. These summaries cannot write crew records,
// authorize orders, or change any simulated equipment.
const stationBriefs = {
  "medical-01": ({sample}) => [
    ["Evidence assistant", "Synthetic watch sample available"],
    ["Heart rate", sample.heart_rate + " bpm · synthetic optical watch"],
    ["Baseline comparison", "No verified comparable baseline"],
    ["Missing channels", "No cuff, glucose meter or thermometer sample"],
  ],
  "life-support-01": ({frame}) => [
    ["Life Support assistant", frame.removal == null ? "Scrubber flow unavailable" :
      frame.removal < 20 ? "Primary flow below replay baseline · inspection available" : "Primary flow at replay baseline"],
    ["Atmosphere", frame.co2.toFixed(2) + " ppm CO₂ · O₂ " + frame.air.oxygen_pct.toFixed(1) +
      "% · balance gases " + frame.air.balance_pct.toFixed(3) + "%"],
    ["Source", frame.air_source + " · O₂ fraction assumed"],
  ],
  "comms-01": ({frame,workflow,clock}) => [
    ["Relay assistant", workflow.status(frame,clock)],
    ["Timing", "Local replay · 5 mission-minute delay each way"],
    ["Authority", "Ground requests; Commander assigns or holds; crew reports"],
  ],
  "engineering-01": ({frame}) => [
    ["Research bay", "Dry-run avionics and propulsion checks"],
    ["Bus headroom", frame.power == null ? "No model sample" : frame.power.toFixed(2) + " kW"],
    ["Bench protocol", "Record a synthetic readiness result before proposing a maneuver"],
    ["Authority", "Bench experiments cannot fire engines or change load allocation"],
  ],
};

function engineeringResult(mode, sample) {
  if (sample.power == null) return "Deferred · bus sample unavailable";
  if (mode === "bus") {
    const reserve = sample.power.toFixed(2) + " kW sampled reserve";
    return sample.power < .40 ? "Repeat under higher reserve · " + reserve : "Reserve check passed · " + reserve;
  }
  return sample.power < .40 ? "Dry check held · bus reserve below 0.40 kW"
    : "Dry check passed · bench sequence only";
}

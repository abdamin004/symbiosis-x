"""Build the timed Flight demo's offline, synthetic life-support rehearsal."""

import json

from symbiosis_x.simulation.spacecraft.atmosphere import advance_co2_ppm


def build_health_rehearsal(manifest_path):
    """Reuse the canonical cabin model inputs in a separate, serviced drill."""
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    cabin = manifest["cabin"]
    nominal = cabin["nominal_removal_m3_h"]
    reduced = cabin["degraded_removal_m3_h"]
    co2 = cabin["initial_co2_ppm"]
    service_s, confirmation_s, relay_delay_s = 75, 105, 45
    source = f'Synthetic cabin model · {manifest["model_version"]}'
    packets = []
    frames = []
    for elapsed in range(0, confirmation_s + relay_delay_s + 1, 15):
        flow = reduced if 0 < elapsed <= service_s else nominal
        if elapsed:
            co2 = advance_co2_ppm(
                co2,
                duration_s=15,
                volume_m3=cabin["volume_m3"],
                generation_m3_h=cabin["generation_m3_h"],
                removal_m3_h=flow,
            )
        observation = {"value": round(co2, 2), "unit": "ppm", "observed_at_s": elapsed}
        report = {
            0: "Nominal cabin",
            15: "Primary scrubber degraded · Crew responding",
            confirmation_s: "Scrubber flow restored · CO₂ decline confirmed onboard",
        }.get(elapsed)
        if report:
            packets.append({
                "snapshot_id": f"flight-drill-{elapsed}",
                "decision_rev": len(packets) + 1,
                "co2": {**observation, "kind": "delivered_observation"},
                "delivery": {
                    "observed_at_s": elapsed,
                    "received_at_s": elapsed + relay_delay_s if elapsed else 0,
                    "link_status": "delayed",
                },
                "case_status": report,
            })
        frames.append({
            "co2": observation,
            "flow_m3_h": nominal if elapsed >= service_s else flow,
            "ground": next(packet for packet in reversed(packets) if packet["delivery"]["received_at_s"] <= elapsed),
        })

    return {"source": source, "frames": frames}

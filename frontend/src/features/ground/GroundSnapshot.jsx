function missionTime(seconds) {
  const sign = seconds < 0 ? "−" : "";
  const total = Math.abs(seconds);
  return sign + String(Math.floor(total / 60)).padStart(2, "0") + ":" + String(total % 60).padStart(2, "0");
}

function Value({ label, value, unit }) {
  return <div><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 text-lg font-semibold text-slate-900">{value ?? "Unknown"}{value !== null && value !== undefined ? " " + unit : ""}</dd></div>;
}

export default function GroundSnapshot({ packet, runMissionS }) {
  return (
    <section className="mt-6 rounded-lg border border-degraded/60 bg-white p-4" aria-labelledby="ground-snapshot-heading" data-testid="ground-snapshot">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Relay · delivered data only</p>
          <h2 id="ground-snapshot-heading" className="mt-1 text-lg font-semibold">Ground snapshot</h2>
        </div>
        <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">{packet?.delivery?.link_status === "delayed" ? "Delayed" : packet ? packet.delivery.link_status : "Awaiting delivery"}</span>
      </header>
      {!packet ? <p className="mt-3 text-sm text-slate-600" role="status">No snapshot has been delivered to Ground yet. Live onboard values are not shown here.</p> : <>
        <p className="mt-2 text-xs text-slate-500">Snapshot {packet.snapshot_id} · decision revision v{packet.decision_rev}</p>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Value label="Cabin CO₂" value={packet.co2?.value} unit={packet.co2?.unit} />
          <Value label="Power headroom" value={packet.power_headroom?.value} unit={packet.power_headroom?.unit} />
          <Value label="Observed at" value={missionTime(packet.delivery.observed_at_s)} unit="mission time" />
          <Value label="Received at" value={missionTime(packet.delivery.received_at_s)} unit="mission time" />
        </dl>
        <div className="mt-4 rounded-md bg-amber-50 p-3" data-testid="ground-snapshot-age">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-900">Sample age at current mission time</p>
          <p className="mt-1 text-2xl font-semibold text-amber-950">{missionTime(packet.delivery.age_s)}</p>
          <p className="mt-1 text-xs text-amber-900">The age is measured from observation time, not receipt time. Current mission time: {missionTime(runMissionS)}.</p>
        </div>
      </>}
    </section>
  );
}

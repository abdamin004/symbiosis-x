/**
 * Ground's delivered snapshot: the basis it was built on, the delivered values
 * and how old the sample is. Everything comes from the delivered packet, never
 * from Crew's live state, so Ground keeps showing an older basis (for example
 * v102 at 0.60 kW) until a newer packet arrives.
 */

function formatMissionTime(seconds) {
  const sign = seconds < 0 ? "−" : "";
  const total = Math.abs(seconds);
  const minutes = String(Math.floor(total / 60)).padStart(2, "0");
  return `${sign}${minutes}:${String(total % 60).padStart(2, "0")}`;
}

function formatValue(quantity) {
  return `${Number(quantity.value).toFixed(quantity.unit === "kW" ? 2 : 0)} ${quantity.unit}`;
}

const LINK_LABELS = { delayed: "Delayed" };

/** Normalize a published Ground snapshot (SX-01A shape) to the live packet shape. */
export function packetFromGroundFixture(snapshot) {
  if (!snapshot?.delivery) return null;
  return {
    snapshot_id: snapshot.snapshot_id,
    decision_rev: snapshot.decision_rev,
    delivery: snapshot.delivery,
    co2: snapshot.equipment?.co2,
    power_headroom: snapshot.equipment?.power_headroom ?? null,
    scrubber_removal: snapshot.equipment?.scrubber_removal ?? null,
  };
}

function Value({ label, quantity, testId }) {
  return (
    <div className="rounded-md border border-slate-200 p-3">
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 text-lg font-semibold text-slate-900" data-testid={testId}>
        {quantity ? formatValue(quantity) : "Not in this packet"}
      </dd>
      {quantity && (
        <dd className="text-xs text-slate-500">Observed {formatMissionTime(quantity.observed_at_s)}</dd>
      )}
    </div>
  );
}

export default function GroundSnapshot({ packet, missionS }) {
  if (!packet) {
    return (
      <section aria-labelledby="ground-snapshot-heading" data-testid="ground-snapshot" data-state="empty"
        className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
        <h2 id="ground-snapshot-heading" className="text-lg font-semibold">Delivered snapshot</h2>
        <p className="mt-2 text-sm text-slate-600" role="status">
          No Ground packet has been delivered yet. Ground sees data only after the relay delivers it.
        </p>
      </section>
    );
  }

  const { delivery } = packet;
  const ageS = delivery.age_s ?? (missionS != null ? missionS - delivery.observed_at_s : null);
  return (
    <section aria-labelledby="ground-snapshot-heading" data-testid="ground-snapshot" data-state="delivered"
      className="mt-6 rounded-lg border border-degraded/60 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div><p className="text-xs font-semibold uppercase tracking-wide text-amber-600">Ground receives approved operational snapshots</p><h2 id="ground-snapshot-heading" className="text-lg font-semibold">Delivered snapshot · What Ground sees</h2><p className="text-sm text-slate-600">Last received observation — not live onboard telemetry</p></div>
        <p className="text-sm text-slate-700">
          Basis <strong data-testid="ground-basis-snapshot">{packet.snapshot_id}</strong>
          {" · "}revision <strong data-testid="ground-basis-revision">v{packet.decision_rev}</strong>
        </p>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
        <dt className="text-slate-500">Observed</dt>
        <dd data-testid="ground-observed">{formatMissionTime(delivery.observed_at_s)}</dd>
        <dt className="text-slate-500">Received</dt>
        <dd data-testid="ground-received">{formatMissionTime(delivery.received_at_s)}</dd>
        <dt className="text-slate-500">Sample age</dt>
        <dd data-testid="ground-age">{ageS == null ? "Unknown" : formatMissionTime(ageS)}</dd>
        <dt className="text-slate-500">Link</dt>
        <dd data-testid="relay-link-status">{LINK_LABELS[delivery.link_status] ?? delivery.link_status}</dd>
      </dl>

      <dl className="mt-4 grid gap-3 sm:grid-cols-3">
        <Value label="Cabin CO₂" quantity={packet.co2} testId="ground-co2" />
        <Value label="Power headroom" quantity={packet.power_headroom} testId="ground-power" />
        {packet.scrubber_removal && (
          <Value label="Scrubber removal" quantity={packet.scrubber_removal} testId="ground-scrubber" />
        )}
      </dl>
      <p className="mt-3 text-xs text-slate-500">
        Delivered values only. The ship may have changed since this sample was observed.
      </p>
    </section>
  );
}

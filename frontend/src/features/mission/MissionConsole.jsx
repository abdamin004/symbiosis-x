import { Link, useParams } from "react-router-dom";
import { fixtureFor } from "../../api/fixtures.js";
import ServiceStatus from "./ServiceStatus.jsx";

const ROLE_TITLES = { crew: "Crew console", ground: "Ground console" };
const CO2_KINDS = {
  modeled_estimate: "Modeled estimate",
  delivered_observation: "Delivered observation",
};

/** Format signed mission seconds as mm:ss, for example 780 → 13:00 and −60 → −01:00. */
export function formatMissionTime(seconds) {
  const sign = seconds < 0 ? "−" : "";
  const total = Math.abs(seconds);
  const minutes = String(Math.floor(total / 60)).padStart(2, "0");
  return `${sign}${minutes}:${String(total % 60).padStart(2, "0")}`;
}

export default function MissionConsole({ role }) {
  const { runId } = useParams();
  const snapshot = fixtureFor(runId, role);
  const title = ROLE_TITLES[role];

  if (!snapshot) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-12">
        <ServiceStatus />
        <h1 className="mt-2 text-2xl font-semibold">{title}</h1>
        <p className="mt-3 text-slate-700" role="status">
          No fixture is available for run {runId}.
        </p>
        <Link className="mt-4 inline-block text-selection underline" to="/">
          Back to the run launcher
        </Link>
      </main>
    );
  }

  const { equipment } = snapshot;
  return (
    <main
      className="mx-auto max-w-4xl px-4 py-8"
      data-testid="console-shell"
      data-role={role}
      data-run-id={snapshot.run_id}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-slate-200 pb-4">
        <div>
          <div className="flex items-center gap-3">
            <Link className="text-sm text-slate-500 hover:underline" to="/">
              SYMBIOSIS X
            </Link>
            <ServiceStatus />
          </div>
          <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <Fact label="Run" value={snapshot.run_id} testId="console-run-id" />
          <Fact label="Mission time" value={formatMissionTime(snapshot.mission_s)} />
          <Fact label="Snapshot" value={snapshot.snapshot_id} testId="console-snapshot-id" />
          <Fact label="Decision revision" value={`v${snapshot.decision_rev}`} />
        </dl>
      </header>

      <p className="mt-3 text-xs text-slate-500">
        Synthetic fixture · scenario {snapshot.scenario_id} · seed {snapshot.seed}
      </p>

      <section aria-labelledby="equipment-heading" className="mt-6">
        <h2 id="equipment-heading" className="text-lg font-semibold">
          Cabin equipment
        </h2>
        <ul className="mt-3 grid gap-4 sm:grid-cols-3">
          <Reading
            label="Cabin CO₂"
            quantity={equipment.co2}
            note={CO2_KINDS[equipment.co2.kind]}
          />
          <Reading label="Scrubber removal" quantity={equipment.scrubber_removal} />
          <Reading label="Power headroom" quantity={equipment.power_headroom} />
        </ul>
      </section>

      {snapshot.delivery && <DeliveryPanel delivery={snapshot.delivery} />}
    </main>
  );
}

function Fact({ label, value, testId }) {
  return (
    <div className="flex gap-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-900" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

function Reading({ label, quantity, note }) {
  return (
    <li className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-telemetry">
        {quantity.value} <span className="text-base font-normal text-slate-600">{quantity.unit}</span>
      </p>
      <p className="mt-1 text-xs text-slate-500">
        {note ? `${note} · ` : ""}observed {formatMissionTime(quantity.observed_at_s)}
      </p>
    </li>
  );
}

function DeliveryPanel({ delivery }) {
  return (
    <section aria-labelledby="delivery-heading" className="mt-6 rounded-lg border border-degraded/60 bg-white p-4">
      <h2 id="delivery-heading" className="text-lg font-semibold">
        Delivered snapshot
      </h2>
      <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
        <dt className="text-slate-500">Observed</dt>
        <dd>{formatMissionTime(delivery.observed_at_s)}</dd>
        <dt className="text-slate-500">Received</dt>
        <dd>{formatMissionTime(delivery.received_at_s)}</dd>
        <dt className="text-slate-500">Age</dt>
        <dd>{formatMissionTime(delivery.age_s)}</dd>
        <dt className="text-slate-500">Link</dt>
        <dd data-testid="relay-link-status">
          {delivery.link_status === "delayed" ? "Delayed" : delivery.link_status}
        </dd>
      </dl>
    </section>
  );
}

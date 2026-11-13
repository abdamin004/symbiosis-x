export const STEP_LABELS = {
  incident_opened: "Opened an incident",
  fault_linked: "Linked a repeat fault",
  advice_queued: "Queued advice for Crew",
  advice_received: "Classified arriving advice",
};

/** Mission seconds as mm:ss. */
export function missionClock(seconds) {
  return String(Math.floor(seconds / 60)).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0");
}

/**
 * SX-10: a compact, ordered trace of the role-filtered milestones. Each row
 * is a recorded point in mission time; there are no durations to fabricate.
 */
export default function TraceTimeline({ trace = [] }) {
  return (
    <section aria-labelledby="trace-heading" className="mt-6 rounded-lg border border-slate-200 bg-white p-4" data-testid="trace-timeline">
      <h2 id="trace-heading" className="font-semibold">Operational trace</h2>
      {trace.length === 0 ? <p className="mt-2 text-sm text-slate-600">No operational milestones recorded.</p> : (
        <ol className="mt-2 space-y-1 text-sm">
          {trace.map((record, index) => (
            <li key={record.case_id + record.step + index} className="flex flex-wrap gap-x-2">
              <span className="font-mono text-xs text-slate-500">{missionClock(record.mission_s)}</span>
              <span className="font-medium">{record.actor}</span>
              <span>{STEP_LABELS[record.step] ?? record.step}</span>
              <span className="text-slate-700">{record.result}{record.reason_code ? " · " + record.reason_code : ""}</span>
              {record.next_owner && <span className="text-slate-500">→ {record.next_owner}</span>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

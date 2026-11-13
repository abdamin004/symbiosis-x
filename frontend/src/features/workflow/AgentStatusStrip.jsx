import { missionClock, STEP_LABELS } from "./TraceTimeline.jsx";

const ACTOR_LABELS = { monitor: "Monitor", ground: "Ground", relay: "Relay" };
const OWNER_LABELS = { crew: "Crew", commander: "Commander" };

function caseTitle(caseId) {
  return caseId.startsWith("advice-") ? "Ground advice " + caseId.slice("advice-".length) : "Incident " + caseId;
}

/** Group the role-filtered trace into cases, keeping journal order. */
export function casesFromTrace(trace = []) {
  const cases = new Map();
  for (const record of trace) {
    const entry = cases.get(record.case_id) ?? { caseId: record.case_id, records: [] };
    entry.records.push(record);
    cases.set(record.case_id, entry);
  }
  return [...cases.values()].map((entry) => ({
    ...entry, opened: entry.records[0], latest: entry.records.at(-1),
  }));
}

/**
 * SX-10: one card per case with its latest actor, result, reason and next
 * owner. Cases have no recorded completion, so they stay open with their
 * start time and no invented end. The trace is already role-filtered by the
 * server; this strip only renders what that role may see.
 */
export default function AgentStatusStrip({ trace }) {
  const cases = casesFromTrace(trace);
  const newest = trace?.at(-1)?.case_id;
  return (
    <section aria-labelledby="agent-status-heading" className="mt-6" data-testid="agent-status-strip">
      <h2 id="agent-status-heading" className="font-semibold">Agent handoffs</h2>
      {cases.length === 0 ? <p className="mt-2 text-sm text-slate-600">No case has been opened.</p> : (
        <ul className="mt-2 grid gap-3 sm:grid-cols-2">
          {cases.map(({ caseId, opened, latest }) => (
            <li key={caseId} data-testid="case-card" data-case-id={caseId}
              className={"rounded-lg border bg-white p-3 " + (caseId === newest ? "border-selection" : "border-slate-200")}>
              <p className="text-xs text-slate-500">{caseTitle(caseId)} · open since {missionClock(opened.mission_s)}</p>
              <p className="mt-1 font-medium text-slate-900">
                {ACTOR_LABELS[latest.actor] ?? latest.actor}: {STEP_LABELS[latest.step] ?? latest.step}
              </p>
              <p className="text-sm text-slate-700" data-testid="case-result">
                {latest.result}{latest.reason_code ? " · " + latest.reason_code : ""}
              </p>
              <p className="mt-1 text-sm" data-testid="case-next-owner">
                Next: <strong>{latest.next_owner ? OWNER_LABELS[latest.next_owner] ?? latest.next_owner : "Not assigned"}</strong>
                <span className="text-slate-500"> · as of {missionClock(latest.mission_s)}</span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

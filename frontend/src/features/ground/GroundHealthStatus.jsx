/** Mission seconds as mm:ss (delivery and acknowledgment times are never negative). */
function formatMissionTime(seconds) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

const PRIORITY_LABELS = { urgent: "Urgent review", routine: "Routine review" };
const STATUS_LABELS = { open: "Open onboard", acknowledged: "Responder acknowledged onboard" };

/**
 * Ground's view of onboard health cases: only the approved packet Relay delivered
 * (alias, generic priority, status, delivery time). Before delivery Ground shows a
 * pending state; it never sees who, what or when onboard. Acknowledging receipt is
 * Ground's own record and never gates the Crew's local response.
 */
export default function GroundHealthStatus({ cases = [], onAcknowledge, busyAlias = null }) {
  return (
    <section
      aria-labelledby="ground-health-heading"
      className="mt-6 rounded-lg border border-slate-200 bg-white p-4"
      data-testid="ground-health-status"
    >
      <h2 id="ground-health-heading" className="text-lg font-semibold">
        Crew health cases
      </h2>
      <p className="mt-1 text-xs text-slate-500">
        Delivered case status only. Details stay onboard, and the Crew responds locally without waiting for Ground.
      </p>
      {cases.length === 0 ? (
        <p className="mt-3 text-sm text-slate-700" data-testid="ground-health-pending" role="status">
          Pending · no case status has been delivered to Ground.
        </p>
      ) : (
        <ul className="mt-3 grid gap-3">
          {cases.map((item) => (
            <li
              key={item.case_alias}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-slate-50 p-3"
              data-testid="ground-health-case"
            >
              <div>
                <p className="font-medium text-slate-900">{item.case_alias}</p>
                <p className="text-sm text-slate-700">
                  {PRIORITY_LABELS[item.review_priority] ?? item.review_priority} ·{" "}
                  {STATUS_LABELS[item.status] ?? item.status}
                </p>
                <p className="text-xs text-slate-500">Delivered {formatMissionTime(item.delivered_at_s)}</p>
              </div>
              {item.ground_ack === "acknowledged" ? (
                <p className="text-sm text-slate-700" data-testid="ground-health-ack">
                  Receipt acknowledged {formatMissionTime(item.ground_acknowledged_at_s)}
                </p>
              ) : (
                <button
                  type="button"
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-white disabled:opacity-50"
                  disabled={!onAcknowledge || busyAlias === item.case_alias}
                  onClick={() => onAcknowledge?.(item.case_alias)}
                >
                  Acknowledge receipt
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

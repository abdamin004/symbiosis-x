import { useState } from "react";

function missionTime(seconds) {
  const minutes = String(Math.floor(seconds / 60)).padStart(2, "0");
  const remainder = String(seconds % 60).padStart(2, "0");
  return `${minutes}:${remainder}`;
}

export default function HealthReminders({ reminders = [], emergencyPrecedence = false, onAcknowledge }) {
  const [pending, setPending] = useState(null);
  const [error, setError] = useState(null);

  async function acknowledge(reminderId) {
    if (!onAcknowledge || pending) return;
    setPending(reminderId);
    setError(null);
    try {
      await onAcknowledge(reminderId);
    } catch {
      setError("The reminder could not be saved. Try again from the Crew console.");
    } finally {
      setPending(null);
    }
  }

  return (
    <section
      aria-labelledby="health-reminders-heading"
      className="mt-4 rounded-md border border-slate-200 bg-white p-3"
      data-testid="health-reminders"
    >
      {emergencyPrecedence && (
        <div role="alert" className="mb-3 rounded-md border border-rose-300 bg-rose-50 p-3 text-sm font-semibold text-rose-900">
          Emergency response takes priority. Act onboard now; routine reminders do not delay it.
        </div>
      )}
      <header>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Private · synthetic follow-up</p>
        <h3 id="health-reminders-heading" className="mt-1 text-sm font-semibold text-slate-900">Personal reminders</h3>
      </header>

      {reminders.length === 0 ? (
        <p className="mt-2 text-sm text-slate-600">A reminder appears after an accepted measurement has a personal due time.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {reminders.map((reminder) => {
            const statusText = reminder.status === "overdue"
              ? "Overdue"
              : reminder.status === "acknowledged" ? "Acknowledged" : "Scheduled";
            return (
              <li
                key={reminder.reminder_id}
                className="rounded-md border border-slate-200 p-3"
                data-testid="health-reminder"
                data-status={reminder.status}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-slate-900">{reminder.metric.replaceAll("_", " ")}</p>
                  <span className={`rounded-full px-2 py-1 text-xs font-semibold ${
                    reminder.status === "overdue" ? "bg-amber-100 text-amber-900" :
                      reminder.status === "acknowledged" ? "bg-emerald-100 text-emerald-900" :
                        "bg-slate-100 text-slate-700"
                  }`}>
                    {statusText}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-700">{reminder.action_text}</p>
                <p className="mt-1 text-xs text-slate-500">
                  Due at mission time {missionTime(reminder.due_at_s)} · last accepted at {missionTime(reminder.last_accepted_at_s)}
                </p>
                {reminder.assessment_id && (
                  <a className="mt-2 inline-block text-sm text-selection underline" href="#health-assessment">
                    Review linked assessment
                  </a>
                )}
                {reminder.status === "overdue" && (
                  <div className="mt-2">
                    <button
                      type="button"
                      className="rounded-md bg-selection px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                      disabled={!onAcknowledge || pending !== null || emergencyPrecedence}
                      onClick={() => acknowledge(reminder.reminder_id)}
                    >
                      {pending === reminder.reminder_id ? "Saving…" : "Acknowledge"}
                    </button>
                    {!onAcknowledge && <span className="ml-2 text-xs text-slate-500">Acknowledgment is unavailable in fixture mode.</span>}
                  </div>
                )}
                {reminder.acknowledgment && (
                  <p className="mt-1 text-xs text-emerald-800">
                    Acknowledged by {reminder.acknowledgment.acknowledged_by} at mission time {missionTime(reminder.acknowledgment.acknowledged_at_s)}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {error && <p className="mt-2 text-sm text-rose-800" role="alert">{error}</p>}
      <p className="mt-2 text-xs text-slate-500">Synthetic demo schedule only; it is not clinical guidance.</p>
    </section>
  );
}

import { useState } from "react";
import { Link, createSearchParams } from "react-router-dom";
import { acknowledgeReminder } from "../../api/client.js";

const STATUS = {
  overdue: { label: "Overdue", tone: "border-red-300 bg-red-50 text-red-900" },
  due: { label: "Due now", tone: "border-amber-300 bg-amber-50 text-amber-900" },
  scheduled: { label: "Scheduled", tone: "border-slate-200 bg-white text-slate-800" },
  acknowledged: { label: "Acknowledged", tone: "border-emerald-300 bg-emerald-50 text-emerald-900" },
};
const ACTIONS = {
  routine_check: "Routine check",
  repeat_measurement: "Repeat the measurement",
  review_with_designated_role: "Review with the crew medical officer",
};

function time(seconds) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function measurementLink(href, metric) {
  const [path, search] = href.split("?");
  const params = createSearchParams(search);
  params.set("metric", metric);
  return path + "?" + params;
}

/**
 * Crew-private reminders from the personal monitoring schedule. Each shows when
 * it is due, why, and the suggested action linked to the latest assessment.
 * An open emergency case takes precedence and defers routine reminders.
 */
export default function HealthReminders({ runId, followup, measureHref, emergencyHref, onChange }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  if (!followup) return null;
  const emergency = followup.precedence === "emergency" ? followup.emergency : null;

  async function acknowledge(reminder) {
    setBusy(reminder.reminder_id); setError("");
    try {
      await acknowledgeReminder(runId, reminder.reminder_id, {
        crew_id: followup.crew_id, acknowledged_by: followup.crew_id,
      });
      onChange?.();
    } catch (e) {
      setError(e.code ?? e.message);
    } finally {
      setBusy("");
    }
  }

  return (
    <section aria-labelledby="reminders-heading" data-testid="health-reminders" data-precedence={followup.precedence}
      className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="reminders-heading" className="text-lg font-semibold">Reminders and follow-up</h2>
        <p className="text-xs text-slate-500">Private · {followup.schedule_version} · synthetic demo cadence</p>
      </div>

      {emergency && (
        <div role="alert" data-testid="reminders-emergency"
          className="mt-3 rounded-md border-2 border-red-500 bg-red-50 p-3 text-sm text-red-900">
          <strong>Emergency takes precedence.</strong> Case {emergency.case_id} ({emergency.kind.replace("_", " ")})
          opened at {time(emergency.opened_at_s)}. Routine reminders are deferred; do not wait for a repeat reading.
          {emergencyHref && <> <Link className="font-semibold underline" to={emergencyHref}>Open Emergency Assist</Link></>}
        </div>
      )}

      <ul className="mt-3 grid gap-3">
        {followup.reminders.map((reminder) => {
          const status = STATUS[reminder.status] ?? STATUS.scheduled;
          return (
            <li key={reminder.reminder_id} data-testid={"reminder-" + reminder.metric} data-status={reminder.status}
              data-deferred={reminder.deferred_by_emergency ? "true" : "false"}
              className={`rounded-md border p-3 ${status.tone} ${reminder.deferred_by_emergency ? "opacity-60" : ""}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">{reminder.label}</p>
                <span className="rounded-full border border-current px-2 py-0.5 text-xs font-semibold"
                  data-testid={"reminder-" + reminder.metric + "-status"}>
                  {reminder.deferred_by_emergency ? `${status.label} · deferred` : status.label}
                </span>
              </div>
              <p className="mt-1 text-sm">
                Due {time(reminder.due_at_s)}
                {reminder.status === "overdue" && <> · overdue by {time(reminder.overdue_by_s)}</>}
                {" · "}last accepted {reminder.last_accepted_at_s == null ? "none yet" : time(reminder.last_accepted_at_s)}
                {" · "}every {time(reminder.every_s)}
              </p>
              <p className="mt-1 text-sm" data-testid={"reminder-" + reminder.metric + "-action"}>
                <strong>{ACTIONS[reminder.action] ?? reminder.action}:</strong> {reminder.reason}
              </p>
              {reminder.status === "acknowledged" ? (
                <p className="mt-2 text-xs">Acknowledged by {reminder.acknowledged_by} at {time(reminder.acknowledged_at_s)}.</p>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  {measureHref && (
                    <Link className="rounded border border-current px-3 py-1 text-xs font-semibold" to={measurementLink(measureHref, reminder.metric)}>
                      Take measurement
                    </Link>
                  )}
                  <button type="button" disabled={busy === reminder.reminder_id}
                    onClick={() => acknowledge(reminder)}
                    className="rounded bg-slate-900 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50">
                    Acknowledge
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {error && <p role="alert" className="mt-3 rounded bg-red-50 p-2 text-sm text-red-800">{error}</p>}
    </section>
  );
}

import { useEffect, useState } from "react";

const POLL_MS = 5000;
const TIMEOUT_MS = 3000;

// Service health is about this app's backend only. Cabin faults and the simulated
// Ground relay have their own indicators and never change this badge.
const STATES = {
  checking: { label: "Checking", tone: "border-slate-300 text-slate-600", dot: "bg-slate-400" },
  ready: { label: "Ready", tone: "border-emerald-300 text-emerald-800", dot: "bg-emerald-500" },
  starting: { label: "Starting", tone: "border-degraded text-amber-800", dot: "bg-degraded" },
  unreachable: { label: "Unreachable", tone: "border-red-300 text-red-800", dot: "bg-red-500" },
};

const STARTING_DETAILS = {
  STORE_UNAVAILABLE: "The local store is not ready.",
  SCHEMA_MISMATCH: "The local store has an unexpected schema.",
  MANIFEST_MISSING: "The golden scenario is missing.",
  MANIFEST_INVALID: "The golden scenario is invalid.",
};

/**
 * Classify one readiness probe.
 * 200 ready → Ready. 503 from the service with a reason → Starting.
 * No answer, a proxy error, or a browser that is offline → Unreachable.
 */
export async function probeService(fetchImpl = fetch) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { state: "unreachable", detail: "This browser is offline." };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl("/health/ready", {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    if (response.ok && body?.status === "ready") {
      return { state: "ready", detail: "The service is ready." };
    }
    if (response.status === 503 && body?.status === "not_ready") {
      return { state: "starting", detail: STARTING_DETAILS[body.reason] ?? "The service is not ready yet." };
    }
    return { state: "unreachable", detail: "The service did not answer its readiness check." };
  } catch {
    return { state: "unreachable", detail: "The service could not be reached." };
  } finally {
    clearTimeout(timer);
  }
}

export default function ServiceStatus() {
  const [status, setStatus] = useState({ state: "checking", detail: "Checking the service." });

  useEffect(() => {
    let active = true;
    let timer;
    let latest = 0;
    const check = async () => {
      clearTimeout(timer);
      const attempt = ++latest;
      const next = await probeService();
      // An older probe that answers late must not overwrite a newer result.
      if (!active || attempt !== latest) return;
      setStatus(next);
      timer = setTimeout(check, POLL_MS);
    };
    check();
    window.addEventListener("online", check);
    window.addEventListener("offline", check);
    return () => {
      active = false;
      clearTimeout(timer);
      window.removeEventListener("online", check);
      window.removeEventListener("offline", check);
    };
  }, []);

  const { label, tone, dot } = STATES[status.state];
  return (
    <p
      className={`inline-flex items-center gap-2 rounded-full border bg-white px-3 py-1 text-xs font-medium ${tone}`}
      data-testid="service-status"
      data-state={status.state}
      title={status.detail}
      aria-live="polite"
    >
      <span aria-hidden="true" className={`size-2 rounded-full ${dot}`} />
      <span>
        Service <span className="sr-only">status: </span>
        {label}
      </span>
      <span className="sr-only">{status.detail}</span>
    </p>
  );
}

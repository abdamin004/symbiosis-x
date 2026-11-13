const API_ROOT = "/api/v1";

let demoTokensPromise;

async function jsonRequest(path, role, options = {}) {
  const tokens = await getDemoTokens();
  const response = await fetch(API_ROOT + path, {
    ...options,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: "Bearer " + tokens[role],
      ...options.headers,
    },
    cache: "no-store",
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(body?.detail ?? "REQUEST_FAILED");
    error.status = response.status;
    error.code = body?.detail ?? "REQUEST_FAILED";
    throw error;
  }
  return body;
}

export function getDemoTokens() {
  if (!demoTokensPromise) {
    demoTokensPromise = fetch(API_ROOT + "/demo/session", {
      method: "POST",
      headers: { Accept: "application/json" },
      cache: "no-store",
    }).then(async (response) => {
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const error = new Error(body?.detail ?? "DEMO_SESSION_UNAVAILABLE");
        error.status = response.status;
        error.code = body?.detail ?? "DEMO_SESSION_UNAVAILABLE";
        throw error;
      }
      return body;
    }).catch((error) => {
      demoTokensPromise = null;
      throw error;
    });
  }
  return demoTokensPromise;
}

export function createOperationId(prefix) {
  if (globalThis.crypto?.randomUUID) return prefix + "-" + globalThis.crypto.randomUUID();
  return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
}

export function startRun(command) {
  return jsonRequest("/runs", "facilitator", { method: "POST", body: JSON.stringify(command) });
}
export function advanceRun(runId, command) {
  return jsonRequest("/runs/" + encodeURIComponent(runId) + "/advance", "facilitator", { method: "POST", body: JSON.stringify(command) });
}
export function resetRun(runId, command) {
  return jsonRequest("/runs/" + encodeURIComponent(runId) + "/reset", "facilitator", { method: "POST", body: JSON.stringify(command) });
}
export function readRunView(runId, role) {
  return jsonRequest("/runs/" + encodeURIComponent(runId) + "/" + role, role);
}
export function createPrivateCheckIn(runId, command) {
  return jsonRequest("/runs/" + encodeURIComponent(runId) + "/crew/check-ins", "crew", { method: "POST", body: JSON.stringify(command) });
}

export function saveCrewMeasurement(runId, command) {
  return jsonRequest("/runs/" + encodeURIComponent(runId) + "/crew/measurements", "crew", {
    method: "POST", body: JSON.stringify(command),
  });
}

export function openEmergencyCase(runId, command) {
  return jsonRequest("/runs/" + encodeURIComponent(runId) + "/crew/emergencies", "crew", {
    method: "POST", body: JSON.stringify(command),
  });
}
export function acknowledgeEmergencyCase(runId, caseId, command) {
  return jsonRequest("/runs/" + encodeURIComponent(runId) + "/crew/emergencies/" + encodeURIComponent(caseId) + "/acknowledgment", "crew", {
    method: "POST", body: JSON.stringify(command),
  });
}

export function setActiveRunId(runId) {
  try { sessionStorage.setItem("symbiosis-x-active-run", runId); } catch { /* private browsing may disable storage */ }
}
export function isActiveRunId(runId) {
  try { return sessionStorage.getItem("symbiosis-x-active-run") === runId; }
  catch { return false; }
}

// Facilitator session state. It lives in this browser tab's sessionStorage, so a
// reload keeps the run and any unconfirmed command ID, and a Crew or Ground
// session in another browser never sees it. Storage can be unavailable; then
// the state lasts only as long as the page.
const FACILITATOR_RUN_KEY = "symbiosis-x-facilitator-run";
const PENDING_COMMANDS_KEY = "symbiosis-x-pending-commands";
const memory = { run: null, pending: {} };

function readStored(key, fallback) {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function writeStored(key, value) {
  try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* keep the in-memory copy */ }
}

/** The run this facilitator last started, stepped or reset, or null. */
export function loadFacilitatorRun() {
  return readStored(FACILITATOR_RUN_KEY, memory.run);
}
export function saveFacilitatorRun(run) {
  memory.run = run;
  writeStored(FACILITATOR_RUN_KEY, run);
  setActiveRunId(run.runId);
}

/**
 * Return the stable ID for a facilitator command. A retry of the same command
 * (same kind and same request fields) reuses the stored ID, even after a reload,
 * so the server replays its first receipt instead of acting twice. A different
 * request gets a new ID, so an edited start never reuses an old start_id.
 */
export function pendingCommandId(kind, fingerprint) {
  const pending = readStored(PENDING_COMMANDS_KEY, memory.pending);
  const key = JSON.stringify(fingerprint);
  const prior = pending[kind];
  if (prior && prior.key === key) return prior.id;
  const id = createOperationId(kind);
  const next = { ...pending, [kind]: { key, id } };
  memory.pending = next;
  writeStored(PENDING_COMMANDS_KEY, next);
  return id;
}
/** Forget a command ID once its receipt has been accepted. */
export function clearPendingCommand(kind) {
  const pending = { ...readStored(PENDING_COMMANDS_KEY, memory.pending) };
  delete pending[kind];
  memory.pending = pending;
  writeStored(PENDING_COMMANDS_KEY, pending);
}

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
export function endRun(runId, command) {
  return jsonRequest("/runs/" + encodeURIComponent(runId) + "/end", "facilitator", { method: "POST", body: JSON.stringify(command) });
}
export function evaluatePlan(runId) {
  // A POST only because evaluation takes no client input; the server changes nothing.
  return jsonRequest("/runs/" + encodeURIComponent(runId) + "/plans/evaluate", "crew", { method: "POST" });
}
export function commitAction(runId, command) {
  return jsonRequest("/runs/" + encodeURIComponent(runId) + "/actions", "crew", { method: "POST", body: JSON.stringify(command) });
}
export function readActionReceipt(runId, operationId) {
  return jsonRequest("/runs/" + encodeURIComponent(runId) + "/actions/" + encodeURIComponent(operationId), "crew");
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

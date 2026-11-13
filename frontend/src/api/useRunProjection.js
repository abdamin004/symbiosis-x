import { useEffect, useState, useCallback } from "react";
import fixture from "../features/mission/fixtures/projections.json";

const allowedRoles = new Set(["crew", "ground"]);

/** Read-only role projection. Navigating to a role never grants authorization. */
export function useRunProjection(runId, role) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [state, setState] = useState(() => ({
    data: fixture[role] ?? null, source: "fixture", loading: true, error: null,
    runId, role,
  }));
  const refresh = useCallback(() => setRefreshKey(n => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    const fallback = fixture[role] ?? null;
    setState({ data: fallback, source: "fixture", loading: true, error: null, runId, role });

    if (!runId || !allowedRoles.has(role)) {
      setState({ data: null, source: "fixture", loading: false, error: "Invalid run or role", runId, role });
      return () => controller.abort();
    }

    // GET only. No local clock mutation, POST, or auto-advance.
    fetch(`/api/v1/runs/${encodeURIComponent(runId)}/${role}`, {
      method: "GET", signal: controller.signal, credentials: "same-origin",
      headers: { Accept: "application/json" },
    })
      .then(async response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then(data => {
        if (!controller.signal.aborted) {
          setState({ data, source: "api", loading: false, error: null, runId, role });
        }
      })
      .catch(error => {
        if (!controller.signal.aborted) {
          setState({ data: fallback, source: "fixture", loading: false, error: error.message, runId, role });
        }
      });
    return () => controller.abort();
  }, [runId, role, refreshKey]);

  // Guard the render immediately when props change, before the next effect runs.
  const current = state.runId === runId && state.role === role;
  return {
    ...(current ? state : { data: fixture[role] ?? null, source: "fixture", loading: true, error: null, runId, role }),
    refresh,
  };
}

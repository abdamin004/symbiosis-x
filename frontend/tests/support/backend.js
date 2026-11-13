// Shared by browser tests that need the real backend (SX-20E, SX-26A).
// CI's browser job has no backend, so each test file starts its own on a free
// port with a fresh SQLite file and routes each session's /api and /health
// calls to it.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** Start uvicorn on a free port with a fresh SQLite file; resolves once /health/ready answers. */
export async function startBackend(name = "backend") {
  const directory = mkdtempSync(join(tmpdir(), `${name}-`));
  const port = await freePort();
  const python = process.env.SX_TEST_PYTHON || "python3";
  const child = spawn(python, [
    "-m", "uvicorn", "symbiosis_x.main:app", "--host", "127.0.0.1", "--port", String(port), "--no-proxy-headers",
  ], {
    cwd: repoRoot,
    env: { ...process.env, SYMBIOSIS_X_DB_PATH: join(directory, `${name}.sqlite3`), SYMBIOSIS_X_LOCAL_DEMO: "1" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const origin = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null) throw new Error("backend exited: " + stderr);
    try {
      const response = await fetch(origin + "/health/ready");
      if (response.ok) return { origin, child, directory };
    } catch { /* not listening yet */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  child.kill();
  throw new Error("backend did not become ready: " + stderr);
}

export function stopBackend(backend) {
  backend?.child.kill();
  if (backend) rmSync(backend.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

/** Send this page's API calls to the test backend. Origin is dropped so the loopback check sees one host. */
export async function useBackend(page, origin) {
  // Match the path prefix only: Vite serves app modules such as /src/api/client.js.
  const isBackendPath = (url) => url.pathname.startsWith("/api/") || url.pathname.startsWith("/health/");
  await page.route(isBackendPath, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = { ...request.headers() };
    delete headers.origin;
    delete headers.host;
    const response = await route.fetch({ url: origin + url.pathname + url.search, headers });
    return route.fulfill({ response });
  });
}

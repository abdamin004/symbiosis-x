import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
// The backend from the README listens on 127.0.0.1:8766. Override it for another laptop.
const apiTarget = process.env.SYMBIOSIS_X_API_URL ?? "http://127.0.0.1:8766";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@contracts": fileURLToPath(new URL("../contracts", import.meta.url)) },
  },
  server: {
    // Allow the shared contract examples outside the frontend folder.
    fs: { allow: [repoRoot] },
    // Keep the browser's Host header. The backend's loopback check compares the
    // request Origin with its own base URL, and Vite's string shorthand would
    // rewrite Host to the backend address, so every POST failed ORIGIN_NOT_ALLOWED.
    proxy: {
      "/api": { target: apiTarget, changeOrigin: false },
      "/health": { target: apiTarget, changeOrigin: false },
    },
  },
});

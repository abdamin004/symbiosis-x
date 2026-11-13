
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// The backend listens on 127.0.0.1:8766.
const apiTarget =
  process.env.SYMBIOSIS_X_API_URL ?? "http://127.0.0.1:8766";

export default defineConfig({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      "@contracts": fileURLToPath(
        new URL("../contracts", import.meta.url)
      ),
      "@catalogs": fileURLToPath(
        new URL("../catalogs", import.meta.url)
      ),
    },
  },

  server: {
    fs: { allow: [repoRoot] },
    // Keep the browser's Host header: the backend's demo session only accepts a request
    // whose Origin matches the host it was sent to. The shorthand form rewrites Host.
    proxy: {
      "/api": { target: apiTarget, changeOrigin: false },
      "/health": { target: apiTarget, changeOrigin: false },
    },
  },
});

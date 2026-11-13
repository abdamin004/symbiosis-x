
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
    proxy: {
      "/api": apiTarget,
      "/health": apiTarget,
    },
  },
});

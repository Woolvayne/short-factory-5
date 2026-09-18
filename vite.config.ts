import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { handleGateRequest } from "./server/gate-core.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Dev-only: bedient /api/gate lokal (auf Vercel übernimmt das api/gate.js).
 * Liest APP_PASSWORD / GATE_TTL_HOURS aus der .env — ohne gesetztes
 * APP_PASSWORD meldet das Gate `enabled: false` (App fragt nicht, zeigt
 * nur den Verweis — exakt wie in Produktion ohne Variable).
 */
function gateDevPlugin(mode: string): Plugin {
  return {
    name: "sf-gate-dev",
    apply: "serve",
    configureServer(server) {
      const env = loadEnv(mode, process.cwd(), "");
      for (const key of ["APP_PASSWORD", "GATE_TTL_HOURS"]) {
        if (env[key] !== undefined && process.env[key] === undefined) {
          process.env[key] = env[key];
        }
      }
      server.middlewares.use("/api/gate", (req, res) => {
        void handleGateRequest(req, res).catch((e: unknown) => {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ ok: false, error: String((e as Error)?.message ?? e) }));
        });
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), viteSingleFile(), gateDevPlugin(mode)],
  server: {
    host: "0.0.0.0",
    allowedHosts: true as unknown as string[], // alle Sandbox-/Preview-Hosts (nur Dev, kein Prod-Effekt)
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
}));

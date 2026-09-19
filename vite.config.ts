import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import type { IncomingMessage, ServerResponse } from "node:http";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { handleGateRequest } from "./server/gate-core.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type DevRequest = IncomingMessage & { body?: unknown };
type ApiResponse = ServerResponse & {
  status?: (code: number) => ApiResponse;
  json?: (payload: unknown) => void;
};
type ApiHandler = (req: DevRequest, res: ApiResponse) => void | Promise<void>;

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  if (req.method === "GET" || req.method === "HEAD") return {};
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function withVercelResponse(res: ServerResponse): ApiResponse {
  const apiRes = res as ApiResponse;
  apiRes.status = (code: number) => {
    res.statusCode = code;
    return apiRes;
  };
  apiRes.json = (payload: unknown) => {
    if (!res.headersSent) {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
    }
    res.end(JSON.stringify(payload));
  };
  return apiRes;
}

function writeDevJson(res: ServerResponse, code: number, payload: unknown): void {
  if (!res.headersSent) {
    res.statusCode = code;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
  }
  res.end(JSON.stringify(payload));
}

/**
 * Dev-only: bedient die Vercel-API-Routen lokal im Vite-Server.
 *
 * Ohne diese Middleware antwortet `npm run dev` auf `/api/tts` mit Vites
 * HTML-Fallback/404 — die Factory zeigt dann beim Klick auf „Video erstellen"
 * nur „TTS relay failed". In Produktion übernimmt Vercel weiterhin die
 * Dateien unter `api/` direkt; diese Middleware gilt ausschließlich lokal.
 */
function apiDevPlugin(mode: string): Plugin {
  return {
    name: "sf-api-dev",
    apply: "serve",
    configureServer(server) {
      const env = loadEnv(mode, process.cwd(), "");
      for (const key of [
        "APP_PASSWORD",
        "GATE_TTL_HOURS",
        "POSTLAKE_API_KEY",
        "BUFFER_API_KEY",
      ]) {
        if (env[key] !== undefined && process.env[key] === undefined) {
          process.env[key] = env[key];
        }
      }

      server.middlewares.use("/api/gate", (req, res) => {
        void handleGateRequest(req, res).catch((e: unknown) => {
          writeDevJson(res, 500, { ok: false, error: String((e as Error)?.message ?? e) });
        });
      });

      server.middlewares.use("/api/tts", (req, res) => {
        void (async () => {
          const mod = (await import(pathToFileURL(path.resolve(__dirname, "api/tts.js")).href)) as {
            default: ApiHandler;
          };
          const devReq = req as DevRequest;
          devReq.body = await readJsonBody(req);
          await mod.default(devReq, withVercelResponse(res));
        })().catch((e: unknown) => {
          writeDevJson(res, 500, { ok: false, error: String((e as Error)?.message ?? e) });
        });
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), viteSingleFile(), apiDevPlugin(mode)],
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

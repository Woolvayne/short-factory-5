/**
 * ShortsFactory — Zugangs-Schutz (Gate)
 *
 *   GET    /api/gate  → { enabled, unlocked, ttlHours }
 *                     enabled=false: KEIN APP_PASSWORD in Vercel gesetzt →
 *                     die App fragt NICHT nach einem Passwort (nur Hinweis).
 *   POST   /api/gate  { password } → entsperren (setzt HttpOnly-Cookie)
 *   DELETE /api/gate  → wieder sperren (Cookie löschen)
 *
 * Das Passwort selbst lebt NUR als Umgebungsvariable auf dem Server:
 *
 *   Vercel → Project → Settings → Environment Variables → APP_PASSWORD
 *
 * Es wird serverseitig verglichen (timing-sicher) und nie ins Client-Bundle
 * gebaut. Nach dem Entsperren gelten auch /api/tts, /api/postlake und
 * /api/buffer als freigeschaltet (shared HttpOnly-Cookie-Session).
 */

export const config = {
  runtime: "nodejs",
};

import { handleGateRequest, json } from "../server/gate-core.js";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "content-type");
    res.statusCode = 204;
    return res.end();
  }
  try {
    return await handleGateRequest(req, res);
  } catch (e) {
    console.error("gate crashed", e);
    return json(res, 500, { ok: false, error: String(e?.message ?? e).slice(0, 200) });
  }
}

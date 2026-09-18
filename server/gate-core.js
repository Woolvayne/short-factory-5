/**
 * ShortsFactory — Zugangsschutz (Gate) · geteilte Kernlogik
 *
 * Die App lässt sich optional mit einem Passwort absichern. Das Passwort
 * lebt AUSSCHLIESSLICH serverseitig als Umgebungsvariable:
 *
 *   Vercel → Project → Settings → Environment Variables → APP_PASSWORD
 *
 * Verhalten:
 *   - APP_PASSWORD NICHT gesetzt → alles offen, es wird NICHT gefragt
 *     (die App zeigt im UI nur einen dezenten Verweis auf die Variable).
 *   - APP_PASSWORD gesetzt → Client zeigt beim Start einen Lock-Screen;
 *     alle Server-Routen (/api/gate, /api/tts, /api/postlake, /api/buffer)
 *     verlangen eine gültige Gate-Session (HMAC-signiertes HttpOnly-Cookie).
 *
 * Das Cookie wird aus dem Passwort selbst abgeleitet signiert (HMAC-SHA256
 * über den Ablauf-Zeitstempel) — Passwort ändern = alle Sessions ungültig.
 * Kein zusätzlicher Secret nötig, kein State auf dem Server.
 *
 * Diese Datei liegt bewusst AUSSERHALB von api/ — sie ist keine Route,
 * sondern wird von api/gate.js und den anderen Routen importiert (Vercel
 * bündelt importierte Dateien automatisch mit) und vom Vite-Dev-Middleware
 * (vite.config.ts) genutzt, damit `npm run dev` den Gate testbar macht.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "sf_gate";
const TTL_HOURS_DEFAULT = 168; // 7 Tage — wie lange eine Entsperrung hält

/* ------------------------------------------------------------------ */
/*  Umgebungsvariable                                                   */
/* ------------------------------------------------------------------ */

/** Das gesetzte Passwort oder null (dann ist das Gate komplett aus). */
export function gatePassword() {
  const pw = process.env.APP_PASSWORD;
  return typeof pw === "string" && pw.length > 0 ? pw : null;
}

export function gateEnabled() {
  return gatePassword() !== null;
}

function ttlHours() {
  const n = Number(process.env.GATE_TTL_HOURS);
  return Number.isFinite(n) && n >= 1 && n <= 24 * 365 ? Math.round(n) : TTL_HOURS_DEFAULT;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Timing-sicherer Vergleich zweier Strings über deren SHA-256-Digest
 *  (gleiche Länge garantiert → keine Längen-/Timing-Leaks). */
function digestEqual(a, b) {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}

const secretFor = (password) =>
  createHash("sha256").update(`sf-gate-v1:${password}`, "utf8").digest();

const sign = (secret, expStr) =>
  createHmac("sha256", secret).update(`sf-gate:${expStr}`, "utf8").digest("hex");

function readCookie(req, name) {
  const raw = req.headers?.cookie;
  if (typeof raw !== "string") return null;
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

function isSecureRequest(req) {
  if (req.socket?.encrypted) return true;
  const proto = req.headers?.["x-forwarded-proto"];
  return typeof proto === "string" ? proto.split(",")[0].trim() === "https" : false;
}

function clientIp(req) {
  const fwd = req.headers?.["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) return fwd.split(",")[0].trim();
  return req.socket?.remoteAddress || "?";
}

/** JSON antworten — funktioniert mit Vercels res (res.status) und mit
 *  plain node res (vite dev middleware). */
export function json(res, code, payload) {
  const body = JSON.stringify(payload);
  if (typeof res.status === "function") res.status(code);
  else res.statusCode = code;
  if (typeof res.setHeader === "function" && !res.headersSent) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
  }
  res.end(body);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Request-Body einsammeln (Vercel parst JSON vor; der vite dev server
 *  liefert einen rohen Stream). */
async function readBody(req) {
  if (req.body !== undefined) {
    if (typeof req.body === "string") {
      try {
        return JSON.parse(req.body || "{}");
      } catch {
        return {};
      }
    }
    return typeof req.body === "object" && req.body !== null ? req.body : {};
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    return {};
  }
}

/* ------------------------------------------------------------------ */
/*  Cookie-Session                                                      */
/* ------------------------------------------------------------------ */

/** Hat der Request eine gültige, nicht abgelaufene Gate-Session? */
export function cookieUnlocked(req) {
  const password = gatePassword();
  if (!password) return false;
  const token = readCookie(req, COOKIE_NAME);
  if (!token) return false;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return false;
  const expStr = token.slice(0, dot);
  if (!/^\d+$/.test(expStr)) return false;
  const expected = sign(secretFor(password), expStr);
  const got = token.slice(dot + 1);
  if (got.length !== expected.length) return false;
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(got))) return false;
  return Number(expStr) > Date.now();
}

function setGateCookie(req, res, password) {
  const maxAgeSec = ttlHours() * 3600;
  const expStr = String(Date.now() + maxAgeSec * 1000);
  const token = `${expStr}.${sign(secretFor(password), expStr)}`;
  const attrs = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSec}`,
  ];
  if (isSecureRequest(req)) attrs.push("Secure");
  res.setHeader("Set-Cookie", attrs.join("; "));
}

function clearGateCookie(req, res) {
  const attrs = [`${COOKIE_NAME}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (isSecureRequest(req)) attrs.push("Secure");
  res.setHeader("Set-Cookie", attrs.join("; "));
}

/* ------------------------------------------------------------------ */
/*  Schutz für die anderen Routen (tts / postlake / buffer)             */
/* ------------------------------------------------------------------ */

/**
 * Vor jeden geschützten Handler setzen. Liefert true, wenn der Request
 * abgewiesen wurde (Antwort 401 wurde bereits geschrieben), sonst false.
 * Ohne gesetztes APP_PASSWORD passiert gar nichts → alles wie bisher.
 */
export function gateBlocked(req, res) {
  if (!gateEnabled()) return false;
  if (cookieUnlocked(req)) return false;
  json(res, 401, {
    ok: false,
    error: "Zugang gesperrt — bitte zuerst in der App entsperren (APP_PASSWORD ist gesetzt).",
  });
  return true;
}

/* ------------------------------------------------------------------ */
/*  Best-effort Brute-Force-Bremse (pro Serverinstanz, im Speicher)     */
/* ------------------------------------------------------------------ */

const fails = new Map();
const sleepBeforeReject = (ip) => {
  const n = Math.min(fails.get(ip)?.count ?? 0, 10);
  return Math.min(2500, 350 * n);
};

/* ------------------------------------------------------------------ */
/*  Der /api/gate Endpoint (GET prüfen · POST entsperren · DELETE sperren) */
/* ------------------------------------------------------------------ */

export async function handleGateRequest(req, res) {
  const method = (req.method || "GET").toUpperCase();
  const password = gatePassword();

  /* GET: Status — braucht die App beim Start, um zu entscheiden ob sie
     nach dem Passwort fragt oder den "Verweis" auf die Variable zeigt. */
  if (method === "GET" || method === "HEAD") {
    const enabled = gateEnabled();
    return json(res, 200, {
      enabled,
      unlocked: enabled ? cookieUnlocked(req) : true,
      ttlHours: enabled ? ttlHours() : null,
    });
  }

  /* DELETE: wieder sperren (Cookie löschen) */
  if (method === "DELETE") {
    clearGateCookie(req, res);
    return json(res, 200, { ok: true, locked: true });
  }

  if (method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  /* POST: Passwort prüfen */
  if (method === "POST") {
    // Kein Passwort gesetzt? → Gate aus, nichts zu entsperren (kein Prompt).
    if (!password) return json(res, 200, { ok: true, enabled: false });

    const body = await readBody(req);
    const attempt = typeof body?.password === "string" ? body.password : "";
    if (attempt.length === 0) {
      return json(res, 400, { ok: false, error: "Passwort fehlt." });
    }

    const ip = clientIp(req);
    if (!digestEqual(attempt, password)) {
      fails.set(ip, { count: (fails.get(ip)?.count ?? 0) + 1, at: Date.now() });
      await sleep(sleepBeforeReject(ip)); // brute force bremsen
      return json(res, 401, { ok: false, error: "Falsches Passwort." });
    }

    fails.delete(ip);
    setGateCookie(req, res, password);
    return json(res, 200, { ok: true, enabled: true, ttlHours: ttlHours() });
  }

  return json(res, 405, { ok: false, error: "Methode nicht erlaubt." });
}

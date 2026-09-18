/**
 * ShortsFactory — Postlake Backend Route (EINZIGER Post- & Analyseweg)
 *
 * Exakt nach der offiziellen Postlake-Dokumentation
 * (https://docs.postlake.dev + https://postlake.dev/llms.txt):
 *
 *   Base : https://api.postlake.dev/v1
 *   Auth : Authorization: Bearer <POSTLAKE_API_KEY> (NUR serverseitig!)
 *
 *   - GET  /v1/me                        → Key-Check + Account-Info
 *   - GET  /v1/me/limits                 → Credits, verbundene Kanäle, Rate-Limits
 *   - GET  /v1/social-accounts           → verbundene Kanäle (acc_…)
 *   - GET  /v1/social-accounts/{id}/publish-info → z. B. TikTok privacyLevel-Werte
 *   - POST /v1/media/batch (JSON)        → signierte PUT-URLs für lokale Dateien
 *   - POST /v1/media                     → Bytes (raw/multipart) oder URL-Ingest
 *   - POST /v1/posts/validate            → kostenlose Pre-Publish-Prüfung
 *   - POST /v1/posts (+ Idempotency-Key) → posten / planen / Entwurf
 *   - GET  /v1/posts?state=&account=     → Postliste (Kalender-Sync)
 *   - GET  /v1/posts/{id}                → Status pollen (processing → published/partial/failed)
 *   - PATCH /v1/posts/{id}               → geplanten Post ändern
 *   - DELETE /v1/posts/{id}              → stornieren / löschen
 *   - POST /v1/posts/{id}/publish        → Entwurf senden
 *   - GET  /v1/analytics?period=30d      → Roll-up (7d/30d/90d, kostenlos)
 *   - GET  /v1/posts/{id}/analytics      → Kennzahlen eines Posts
 *
 * Security: POSTLAKE_API_KEY lebt ausschließlich hier (Vercel Env). Der
 * Browser sieht ihn NIE — alle Uploads laufen über signierte PUT-URLs.
 */

export const config = {
  runtime: "nodejs",
  maxDuration: 60,
};

import { gateBlocked } from "../server/gate-core.js";

const POSTLAKE_BASE_URL = "https://api.postlake.dev/v1";
const TIMEZONE = "Europe/Berlin";

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function lakeError(data, status) {
  // Postlake-Fehlerform: { error: { type, message, retryable, platform? } }
  const e = data?.error;
  if (typeof e === "string") return e;
  if (e && typeof e === "object") {
    const plat = e.platform ? ` [${e.platform}]` : "";
    return `${e.message || e.type || "Unbekannter Fehler"}${plat}`;
  }
  return data?.message || `Postlake API HTTP ${status}`;
}

async function lakeFetch(apiKey, path, { method = "GET", body, headers = {}, timeoutMs = 25000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // Binär-Bodies ROH durchlassen — kein JSON.stringify (bläht Bytes ~3× auf → HTTP 413
    // am Gateway), kein automatischer JSON-Content-Type. Header-Lookups case-insensitiv.
    const isBinary =
      (typeof Buffer !== "undefined" && Buffer.isBuffer(body)) ||
      body instanceof Uint8Array ||
      (typeof ArrayBuffer !== "undefined" && body instanceof ArrayBuffer) ||
      (typeof Blob !== "undefined" && body instanceof Blob);
    const hasContentType = Object.keys(headers).some((k) => k.toLowerCase() === "content-type");
    const res = await fetch(`${POSTLAKE_BASE_URL}${path}`, {
      method,
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(body !== undefined && !isBinary && !(body instanceof FormData) && !hasContentType
          ? { "Content-Type": "application/json" }
          : {}),
        ...headers,
      },
      body:
        body === undefined
          ? undefined
          : typeof body === "string" || isBinary || body instanceof FormData
            ? body
            : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  } finally {
    clearTimeout(timer);
  }
}

/** 429 ehren: genau EIN Retry mit Retry-After (max. 45 s). */
async function lakeFetchRetry(apiKey, path, opts = {}) {
  const first = await lakeFetch(apiKey, path, opts);
  if (first.res.status !== 429) return first;
  const waitSec = Math.min(45, Math.max(1, Number(first.res.headers.get("retry-after")) || 5));
  await new Promise((r) => setTimeout(r, waitSec * 1000));
  return lakeFetch(apiKey, path, opts);
}

function asArray(v) {
  if (Array.isArray(v)) return v;
  return [];
}

/** Listen-Antworten defensiv lesen (items/accounts/posts/socialAccounts…). */
function pickList(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  for (const k of ["accounts", "items", "posts", "socialAccounts", "results", "data"]) {
    if (Array.isArray(data[k])) return data[k];
  }
  return [];
}

function normAccount(a) {
  if (!a || typeof a !== "object") return null;
  const id = a.id || a.accountId || a.account || "";
  if (!id) return null;
  return {
    id: String(id),
    platform: String(a.platform || "").toLowerCase(),
    handle: a.handle || a.username || a.name || "",
    name: a.name || a.channelName || a.handle || a.username || "",
    avatarUrl: a.avatarUrl || a.avatar || "",
    profileId: a.profileId || a.profile || "",
    status: String(a.status || (a.connected === false ? "disconnected" : "connected")),
    connectVariant: a.connectVariant || "",
  };
}

/* ------------------------------------------------------------------ */
/*  Upload-Ziele aus /media/batch-Antworten defensiv parsen             */
/* ------------------------------------------------------------------ */

const UPLOAD_URL_KEYS = [
  "uploadUrl", "uploadURL", "upload_url",
  "putUrl", "putURL", "put_url",
  "signedUrl", "signed_url",
  "targetUrl", "target_url",
  "url",
];
const MEDIA_ID_KEYS = [
  "id", "mediaId", "media_id", "medId", "med_id", "assetId", "asset_id", "media",
];
const UPLOAD_HEADER_KEYS = ["headers", "uploadHeaders", "upload_headers", "putHeaders", "put_headers"];
const UPLOAD_NEST_KEYS = ["upload", "target", "put", "signedUpload", "uploadTarget"];

/** Ersten nicht-leeren String-Wert aus einer Key-Liste holen. */
function pickStringField(obj, keys) {
  if (!obj || typeof obj !== "object") return null;
  const lower = Object.fromEntries(Object.keys(obj).map((k) => [k.toLowerCase(), k]));
  for (const key of keys) {
    const actual = lower[key.toLowerCase()];
    if (actual === undefined) continue;
    const v = obj[actual];
    if (typeof v === "string" && v.trim()) return v;
  }
  return null;
}

/** Header-Objekte mergen (spätere Quellen gewinnen, nur String-Werte). */
function pickHeaderFields(obj) {
  const out = {};
  if (!obj || typeof obj !== "object") return out;
  const lower = Object.fromEntries(Object.keys(obj).map((k) => [k.toLowerCase(), k]));
  for (const key of UPLOAD_HEADER_KEYS) {
    const actual = lower[key.toLowerCase()];
    const h = actual !== undefined ? obj[actual] : undefined;
    if (!h || typeof h !== "object" || Array.isArray(h)) continue;
    for (const [hk, hv] of Object.entries(h)) {
      if (typeof hv === "string" && hv) out[hk] = hv;
    }
  }
  return out;
}

/**
 * Parst ein Item aus einer /media/batch-Antwort (oder die Antwort selbst) und
 * extrahiert { uploadUrl, headers, mediaId, expiresIn }. Toleriert verschachtelte
 * upload-/target-/put-Objekte sowie camelCase/snake_case-Varianten. Bevorzugt
 * med_…-IDs gegenüber anderen ID-Feldern.
 */
function pickUploadTarget(item) {
  const visit = (node, keySource = "") => {
    if (Array.isArray(node)) {
      for (const el of node) {
        const hit = visit(el, keySource);
        if (hit) return hit;
      }
      return null;
    }
    if (!node || typeof node !== "object") return null;
    const url = pickStringField(node, UPLOAD_URL_KEYS);
    const mediaId = pickStringField(node, MEDIA_ID_KEYS);
    if (url || mediaId) return { node, url, mediaId, keySource };
    for (const k of UPLOAD_NEST_KEYS) {
      const actual =
        node[k] !== undefined ? k : Object.keys(node).find((x) => x.toLowerCase() === k.toLowerCase());
      if (actual === undefined) continue;
      const hit = visit(node[actual], k);
      if (hit) return hit;
    }
    return null;
  };

  const primary = visit(item);
  if (!primary) return null;

  // med_…-ID bevorzugen: trägt der Primärtreffer eine andere Form, Geschwister prüfen.
  let best = primary;
  if (primary.mediaId && !/^med_/i.test(primary.mediaId)) {
    const candidates = [];
    const collect = (n) => {
      if (Array.isArray(n)) return n.forEach(collect);
      if (!n || typeof n !== "object") return;
      const id = pickStringField(n, MEDIA_ID_KEYS);
      if (id) candidates.push({ node: n, id });
      for (const k of UPLOAD_NEST_KEYS) {
        const actual =
          n[k] !== undefined ? k : Object.keys(n).find((x) => x.toLowerCase() === k.toLowerCase());
        if (actual !== undefined) collect(n[actual]);
      }
    };
    collect(item);
    const med = candidates.find((c) => /^med_/i.test(c.id));
    if (med) {
      const url = primary.url || pickStringField(med.node, UPLOAD_URL_KEYS);
      best = { node: med.node, url, mediaId: med.id, keySource: primary.keySource };
    }
  }

  const headers = { ...pickHeaderFields(item), ...pickHeaderFields(best.node) };
  const expiresIn =
    Number(best.node.expiresIn ?? best.node.expires_in ?? item?.expiresIn ?? item?.expires_in) || 300;
  return { uploadUrl: best.url || null, mediaId: best.mediaId || null, headers, expiresIn };
}

/** Kandidaten-Items einer /media/batch-Antwort (Erfolg steht meist vorn). */
function uploadTargetCandidates(data) {
  const out = [];
  for (const item of pickList(data)) out.push(item);
  if (data && typeof data === "object" && !Array.isArray(data)) {
    for (const k of ["media", "upload", "target", "item", "result"]) {
      if (data[k] && typeof data[k] === "object") out.push(data[k]);
    }
    out.push(data);
  }
  return out;
}

/** Ersten brauchbaren Treffer aus einer /media/batch-Antwort ziehen. */
function pickFirstUploadTarget(data) {
  for (const cand of uploadTargetCandidates(data)) {
    const hit = pickUploadTarget(cand);
    if (hit && (hit.uploadUrl || hit.mediaId)) return hit;
  }
  return null;
}

/** Medien-ID aus einer /media-Antwort ziehen (med_… bevorzugen). */
function pickMediaId(data) {
  const hit = pickUploadTarget(data);
  return hit?.mediaId || null;
}

/* ------------------------------------------------------------------ */
/*  Publish-Info (TikTok privacyLevel u. a.) — kurzlebiger Cache        */
/* ------------------------------------------------------------------ */

const publishInfoCache = new Map(); // accountId → { at, info }

async function getPublishInfo(apiKey, accountId) {
  const hit = publishInfoCache.get(accountId);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.info;
  const { res, data } = await lakeFetch(apiKey, `/social-accounts/${encodeURIComponent(accountId)}/publish-info`);
  const info = res.ok ? data : null;
  publishInfoCache.set(accountId, { at: Date.now(), info });
  if (publishInfoCache.size > 100) {
    const first = publishInfoCache.keys().next().value;
    publishInfoCache.delete(first);
  }
  return info;
}

/** Erlaubte TikTok privacyLevel aus der Publish-Info lesen (Doku-Pflichtfeld). */
function pickTikTokPrivacy(publishInfo) {
  const candidates = [];
  const walk = (v) => {
    if (!v) return;
    if (typeof v === "string") {
      if (/PUBLIC|PRIVATE|FRIENDS|SELF_ONLY/i.test(v)) candidates.push(v);
      return;
    }
    if (Array.isArray(v)) return v.forEach(walk);
    if (typeof v === "object") {
      for (const [k, val] of Object.entries(v)) {
        if (/privacy/i.test(k)) {
          if (typeof val === "string") candidates.push(val);
          else walk(val);
        } else walk(val);
      }
    }
  };
  walk(publishInfo);
  const pub = candidates.find((c) => /PUBLIC_TO_EVERYONE/i.test(c));
  if (pub) return pub;
  if (candidates.length > 0) return candidates[0];
  return "PUBLIC_TO_EVERYONE";
}

/* ------------------------------------------------------------------ */
/*  Post-Erstellung (1 Video → N Kanäle, 1 Call)                         */
/* ------------------------------------------------------------------ */

async function buildPlatformOptions(apiKey, job, accountsById) {
  const options = { ...(job.platformOptions || {}) };
  const platforms = new Set(
    (job.accounts || []).map((id) => accountsById.get(String(id))?.platform).filter(Boolean)
  );

  if (platforms.has("tiktok") && !options.tiktok?.privacyLevel) {
    // TikTok-Direktposts BRAUCHEN privacyLevel — kein Default (Doku).
    const ttAccount = (job.accounts || []).find((id) => accountsById.get(String(id))?.platform === "tiktok");
    let privacy = "PUBLIC_TO_EVERYONE";
    if (ttAccount) {
      try {
        privacy = pickTikTokPrivacy(await getPublishInfo(apiKey, ttAccount));
      } catch {
        /* Fallback unten */
      }
    }
    options.tiktok = { mode: "direct", privacyLevel: privacy, ...(options.tiktok || {}) };
  }

  if (platforms.has("youtube") && !options.youtube?.title) {
    // YouTube-Titel ist praktisch Pflicht (Doku).
    options.youtube = {
      title: String(job.title || job.text || "Short").slice(0, 100),
      privacyStatus: "public",
      ...(options.youtube || {}),
    };
  }

  return options;
}

async function createOnePost(apiKey, job, accountsById) {
  const platformOptions = await buildPlatformOptions(apiKey, job, accountsById);
  const body = {
    text: job.text,
    accounts: job.accounts,
    ...(job.media && job.media.length > 0 ? { media: job.media } : {}),
    ...(job.scheduledAt ? { scheduledAt: job.scheduledAt, ...(job.timezone ? { timezone: job.timezone } : {}) } : {}),
    ...(Object.keys(platformOptions).length > 0 ? { platformOptions } : {}),
    ...(job.draft ? { draft: true } : {}),
  };

  // 1) Kostenlose Validierung zuerst (Doku-Empfehlung) — exakt gleiche Checks wie beim Publish.
  const val = await lakeFetch(apiKey, "/posts/validate", { method: "POST", body });
  if (!val.res.ok) {
    throw new Error(`Validierung abgelehnt: ${lakeError(val.data, val.res.status)}`);
  }
  const warnings = asArray(val.data?.warnings);

  // 2) Echter Create mit Idempotency-Key (Retry kann nie doppelt posten).
  const created = await lakeFetchRetry(apiKey, "/posts", {
    method: "POST",
    body,
    headers: job.idempotencyKey ? { "Idempotency-Key": job.idempotencyKey } : {},
  });
  if (!created.res.ok) {
    throw new Error(lakeError(created.data, created.res.status));
  }
  const post = created.data?.post || created.data;
  return { post, warnings };
}

/* ------------------------------------------------------------------ */
/*  Handler                                                             */
/* ------------------------------------------------------------------ */

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  const apiKey = process.env.POSTLAKE_API_KEY || "";
  const hasApiKey = Boolean(apiKey.trim());

  try {
    /* ---------------- GET: Status ---------------- */
    if (req.method === "GET") {
      const { action } = req.query || {};
      if (action === "status" || action === undefined) {
        if (!hasApiKey) {
          return res.status(200).json({
            ok: true,
            hasApiKey: false,
            apiStatus: "missing_key",
            me: null,
            credits: null,
            accounts: [],
            rateLimits: null,
            timezone: TIMEZONE,
          });
        }
        try {
          const [me, limits, accs] = await Promise.all([
            lakeFetch(apiKey, "/me"),
            lakeFetch(apiKey, "/me/limits"),
            lakeFetch(apiKey, "/social-accounts"),
          ]);
          if (!me.res.ok) {
            return res.status(200).json({
              ok: true,
              hasApiKey: true,
              apiStatus: "invalid_key",
              keyError: lakeError(me.data, me.res.status),
              me: null,
              credits: null,
              accounts: [],
              rateLimits: null,
              timezone: TIMEZONE,
            });
          }
          const accounts = pickList(accs.data).map(normAccount).filter(Boolean);
          // /me/limits.connected als Ergänzung (falls Accounts-Liste leer ist)
          const connectedExtra = asArray(limits.data?.connected)
            .map((c) => ({ id: c.account, platform: c.platform, handle: c.handle, status: c.status }))
            .map(normAccount)
            .filter(Boolean);
          const merged = new Map();
          for (const a of [...accounts, ...connectedExtra]) if (!merged.has(a.id)) merged.set(a.id, a);
          return res.status(200).json({
            ok: true,
            hasApiKey: true,
            apiStatus: "connected",
            me: me.data && typeof me.data === "object" ? me.data : null,
            credits: limits.data?.credits ?? null,
            billing: limits.data?.billing ?? null,
            accounts: Array.from(merged.values()),
            rateLimits: limits.data?.rateLimits ?? null,
            timezone: TIMEZONE,
          });
        } catch (e) {
          return res.status(200).json({
            ok: true,
            hasApiKey: true,
            apiStatus: "unreachable",
            keyError: e instanceof Error ? e.message : String(e),
            me: null,
            credits: null,
            accounts: [],
            rateLimits: null,
            timezone: TIMEZONE,
          });
        }
      }
      return res.status(400).json({ ok: false, error: `Unbekannte GET-Aktion: ${action}` });
    }

    /* ---------------- POST: Aktionen ---------------- */
    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body ?? {});
      const { action } = body;

      const needKey = () => {
        if (!hasApiKey) {
          res.status(400).json({
            ok: false,
            error: "POSTLAKE_API_KEY fehlt auf dem Server (Vercel → Environment Variables). Key unter app.postlake.dev → API Keys erzeugen.",
          });
          return false;
        }
        return true;
      };

      /* ---- MEDIA-SIGN: signierte PUT-URL für 1 lokale Datei ----
       * POST /v1/media/batch mit JSON { items: [{ contentType, sizeBytes }] }
       * (Doku). Browser lädt Bytes direkt hoch — Key bleibt serverseitig. */
      if (action === "media-sign") {
        if (!needKey()) return;
        const contentType = String(body.contentType || "video/mp4");
        const sizeBytes = Number(body.sizeBytes) || undefined;
        const { res: bRes, data: bData } = await lakeFetch(apiKey, "/media/batch", {
          method: "POST",
          body: { items: [{ contentType, ...(sizeBytes ? { sizeBytes } : {}) }] },
        });
        if (!bRes.ok) {
          return res.status(bRes.status).json({
            ok: false,
            error: `Postlake Media-Sign fehlgeschlagen: ${lakeError(bData, bRes.status)}`,
          });
        }
        const target = pickFirstUploadTarget(bData);
        if (!target || !target.uploadUrl || !target.mediaId) {
          const first = pickList(bData)[0] || bData?.media || bData || {};
          return res.status(502).json({
            ok: false,
            error: `Postlake gab keine Upload-URL zurück (Felder: ${Object.keys(first).join(",") || "leer"}).`,
          });
        }
        return res.status(200).json({
          ok: true,
          uploadUrl: target.uploadUrl,
          headers: target.headers,
          mediaId: target.mediaId,
          expiresIn: target.expiresIn,
        });
      }

      /* ---- MEDIA-FROM-URL: öffentliche URL als Medienquelle ----
       * Kette (jeder Schritt wird für die Diagnose protokolliert):
       *  1) { url }-Ingest: POST /v1/media mit JSON-URL (MCP-Weg).
       *  2) Signierter PUT: Bytes serverseitig laden, via /media/batch eine
       *     signierte PUT-URL holen und die Bytes dorthin PUTen (Header exakt
       *     wie vorgegeben; Content-Type nur ergänzen, wenn case-insensitiv
       *     nicht schon vorhanden — sonst schlägt die Signatur fehl).
       *  3) RAW-Forward: rohe Bytes an POST /v1/media — NUR wenn ≤ 8 MB,
       *     darüber nimmt das Gateway die Payload nicht (HTTP 413). */
      if (action === "media-from-url") {
        if (!needKey()) return;
        const url = String(body.url || "");
        const contentType = String(body.contentType || "video/mp4");
        if (!/^https:\/\//i.test(url)) {
          return res.status(400).json({ ok: false, error: "Es wird eine öffentliche HTTPS-URL benötigt." });
        }
        const diag = [];
        let sizeMB = null;
        const mb = () => (sizeMB === null ? "?" : sizeMB.toFixed(1));

        // Schritt 1: direkter URL-Ingest
        try {
          const direct = await lakeFetch(apiKey, "/media", { method: "POST", body: { url } });
          const mid = direct.res.ok ? pickMediaId(direct.data) : null;
          if (direct.res.ok && mid) {
            return res.status(200).json({ ok: true, mediaId: mid, via: "url" });
          }
          diag.push(`url-ingest: HTTP ${direct.res.status} (${lakeError(direct.data, direct.res.status)})`);
        } catch (e) {
          diag.push(`url-ingest: ${e instanceof Error ? e.message : String(e)}`);
        }

        // Bytes serverseitig laden (Schritt 2 + 3 teilen sich den Download)
        let buf = null;
        try {
          const fetched = await fetch(url);
          if (!fetched.ok) throw new Error(`HTTP ${fetched.status}`);
          buf = Buffer.from(await fetched.arrayBuffer());
          if (buf.byteLength === 0) throw new Error("leere Datei");
          sizeMB = buf.byteLength / (1024 * 1024);
        } catch (e) {
          diag.push(`download: ${e instanceof Error ? e.message : String(e)}`);
          return res.status(502).json({
            ok: false,
            error: `Medien-Upload fehlgeschlagen (${mb()} MB) — ${diag.join(" · ")}`,
          });
        }

        // Schritt 2: signierte PUT-URL via /media/batch, Bytes serverseitig dorthin
        try {
          const { res: bRes, data: bData } = await lakeFetch(apiKey, "/media/batch", {
            method: "POST",
            body: { items: [{ contentType, sizeBytes: buf.byteLength }] },
          });
          const target = bRes.ok ? pickFirstUploadTarget(bData) : null;
          if (!bRes.ok) {
            diag.push(`batch-sign: HTTP ${bRes.status} (${lakeError(bData, bRes.status)})`);
          } else if (!target || !target.uploadUrl || !target.mediaId) {
            diag.push("batch-sign: Antwort ohne Upload-URL/Media-ID");
          } else {
            // Signierte URLs verlangen EXAKT die vorgegebenen Header — Content-Type
            // nur ergänzen, wenn er (case-insensitiv) nicht bereits gesetzt ist.
            const putHeaders = { ...target.headers };
            if (!Object.keys(putHeaders).some((k) => k.toLowerCase() === "content-type")) {
              putHeaders["Content-Type"] = contentType;
            }
            const putRes = await fetch(target.uploadUrl, { method: "PUT", headers: putHeaders, body: buf });
            if (putRes.ok) {
              return res.status(200).json({ ok: true, mediaId: target.mediaId, via: "signed-put" });
            }
            const errText = String(await putRes.text().catch(() => "")).slice(0, 160);
            diag.push(
              `signed-put: HTTP ${putRes.status}${errText ? ` (${errText})` : ""}`
            );
          }
        } catch (e) {
          diag.push(`signed-put: ${e instanceof Error ? e.message : String(e)}`);
        }

        // Schritt 3: rohe Bytes an POST /v1/media (nur kleine Dateien → 8-MB-Limit)
        if (sizeMB <= 8) {
          try {
            const up = await lakeFetch(apiKey, "/media", {
              method: "POST",
              body: buf,
              headers: { "Content-Type": contentType },
              timeoutMs: 55000,
            });
            const mid = up.res.ok ? pickMediaId(up.data) : null;
            if (up.res.ok && mid) {
              return res.status(200).json({ ok: true, mediaId: mid, via: "forward" });
            }
            diag.push(`raw-post: HTTP ${up.res.status} (${lakeError(up.data, up.res.status)})`);
          } catch (e) {
            diag.push(`raw-post: ${e instanceof Error ? e.message : String(e)}`);
          }
        } else {
          diag.push(`raw-post: übersprungen — ${mb()} MB > 8 MB (Gateway-Limit, sonst HTTP 413)`);
        }

        return res.status(502).json({
          ok: false,
          error: `Medien-Upload fehlgeschlagen (${mb()} MB) — ${diag.join(" · ")}`,
        });
      }

      /* ---- VALIDATE: kostenlose Pre-Publish-Prüfung ---- */
      if (action === "validate") {
        if (!needKey()) return;
        const { res: vRes, data: vData } = await lakeFetch(apiKey, "/posts/validate", {
          method: "POST",
          body: body.post || {},
        });
        if (!vRes.ok) {
          return res.status(200).json({ ok: false, error: lakeError(vData, vRes.status) });
        }
        return res.status(200).json({ ok: true, warnings: asArray(vData?.warnings) });
      }

      /* ---- CREATE-BATCH: 1..N Videos posten/planen (sequentiell, je mit eigenem Ergebnis) ---- */
      if (action === "create-batch") {
        if (!needKey()) return;
        const jobs = asArray(body.jobs);
        if (jobs.length === 0) {
          return res.status(400).json({ ok: false, error: "Keine Jobs übergeben." });
        }
        // Account-Karte für platformOptions (einmal laden)
        let accountsById = new Map();
        try {
          const acc = await lakeFetch(apiKey, "/social-accounts");
          for (const a of pickList(acc.data).map(normAccount).filter(Boolean)) accountsById.set(a.id, a);
        } catch {
          /* platformOptions-Fallbacks greifen */
        }
        // Falls Jobs Plattformen statt IDs nennen und Accounts bekannt sind: auflösen
        const results = [];
        let created = 0;
        let failed = 0;
        for (const job of jobs.slice(0, 100)) {
          const localId = job.localId || `job_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          try {
            if (!job.text || !Array.isArray(job.accounts) || job.accounts.length === 0) {
              throw new Error("Job braucht text + mindestens 1 Account (acc_…).");
            }
            const { post, warnings } = await createOnePost(apiKey, job, accountsById);
            created++;
            results.push({ ok: true, localId, post, warnings });
          } catch (e) {
            failed++;
            results.push({ ok: false, localId, error: e instanceof Error ? e.message : String(e) });
          }
        }
        return res.status(200).json({ ok: failed === 0, created, failed, results, hasApiKey: true });
      }

      /* ---- LIST-POSTS: Kalender-Sync (?state=&account=&profile=) ---- */
      if (action === "list-posts") {
        if (!needKey()) return;
        const qs = new URLSearchParams();
        if (body.state) qs.set("state", String(body.state));
        if (body.account) qs.set("account", String(body.account));
        if (body.profile) qs.set("profile", String(body.profile));
        if (body.limit) qs.set("limit", String(body.limit));
        const q = qs.toString();
        const { res: lRes, data: lData } = await lakeFetch(apiKey, `/posts${q ? `?${q}` : ""}`);
        if (!lRes.ok) {
          return res.status(lRes.status).json({ ok: false, error: lakeError(lData, lRes.status) });
        }
        const posts = pickList(lData);
        return res.status(200).json({ ok: true, posts, cursor: lData?.cursor ?? null, problems: lData?.problems ?? null });
      }

      /* ---- GET-POST / REFRESH: Status einzelner Posts pollen ---- */
      if (action === "get-post" || action === "refresh") {
        if (!needKey()) return;
        const ids = action === "get-post" ? [body.id] : asArray(body.ids);
        const posts = [];
        for (const id of ids.filter(Boolean).slice(0, 50)) {
          try {
            const { res: gRes, data: gData } = await lakeFetch(apiKey, `/posts/${encodeURIComponent(String(id))}`);
            if (gRes.ok) posts.push(gData?.post || gData);
          } catch {
            /* einzelne Fehler blockieren nicht */
          }
        }
        return res.status(200).json({ ok: true, posts });
      }

      /* ---- CANCEL: geplanten Post stornieren (DELETE) ---- */
      if (action === "cancel") {
        if (!needKey()) return;
        if (!body.id) return res.status(400).json({ ok: false, error: "Post-ID fehlt." });
        const { res: dRes, data: dData } = await lakeFetch(apiKey, `/posts/${encodeURIComponent(String(body.id))}`, {
          method: "DELETE",
        });
        if (!dRes.ok) {
          return res.status(dRes.status).json({ ok: false, error: lakeError(dData, dRes.status) });
        }
        return res.status(200).json({ ok: true });
      }

      /* ---- EDIT: geplanten Post ändern (PATCH: text/media/options/time) ---- */
      if (action === "edit") {
        if (!needKey()) return;
        if (!body.id) return res.status(400).json({ ok: false, error: "Post-ID fehlt." });
        const patch = {};
        for (const k of ["text", "media", "mediaAlt", "mediaOverrides", "platformOptions", "scheduledAt", "timezone"]) {
          if (body.patch && body.patch[k] !== undefined) patch[k] = body.patch[k];
        }
        const { res: pRes, data: pData } = await lakeFetch(apiKey, `/posts/${encodeURIComponent(String(body.id))}`, {
          method: "PATCH",
          body: patch,
        });
        if (!pRes.ok) {
          return res.status(pRes.status).json({ ok: false, error: lakeError(pData, pRes.status) });
        }
        return res.status(200).json({ ok: true, post: pData?.post || pData });
      }

      /* ---- PUBLISH-DRAFT: Entwurf senden ---- */
      if (action === "publish-draft") {
        if (!needKey()) return;
        if (!body.id) return res.status(400).json({ ok: false, error: "Post-ID fehlt." });
        const payload = {};
        if (body.scheduledAt !== undefined) payload.scheduledAt = body.scheduledAt;
        const { res: pRes, data: pData } = await lakeFetch(
          apiKey,
          `/posts/${encodeURIComponent(String(body.id))}/publish`,
          { method: "POST", body: payload }
        );
        if (!pRes.ok) {
          return res.status(pRes.status).json({ ok: false, error: lakeError(pData, pRes.status) });
        }
        return res.status(200).json({ ok: true, post: pData?.post || pData });
      }

      /* ---- ANALYTICS: Roll-up (7d/30d/90d, kostenlos) ---- */
      if (action === "analytics") {
        if (!needKey()) return;
        const period = ["7d", "30d", "90d"].includes(body.period) ? body.period : "30d";
        const { res: aRes, data: aData } = await lakeFetch(apiKey, `/analytics?period=${period}`);
        if (!aRes.ok) {
          return res.status(aRes.status).json({ ok: false, error: lakeError(aData, aRes.status) });
        }
        return res.status(200).json({ ok: true, period, analytics: aData });
      }

      /* ---- POST-ANALYTICS: Kennzahlen eines Posts (alle Targets) ---- */
      if (action === "post-analytics") {
        if (!needKey()) return;
        if (!body.id) return res.status(400).json({ ok: false, error: "Post-ID fehlt." });
        const { res: aRes, data: aData } = await lakeFetch(
          apiKey,
          `/posts/${encodeURIComponent(String(body.id))}/analytics`
        );
        if (!aRes.ok) {
          return res.status(aRes.status).json({ ok: false, error: lakeError(aData, aRes.status) });
        }
        return res.status(200).json({ ok: true, analytics: aData });
      }

      /* ---- PUBLISH-INFO: Optionen eines Kanals (z. B. TikTok privacyLevel) ---- */
      if (action === "publish-info") {
        if (!needKey()) return;
        if (!body.accountId) return res.status(400).json({ ok: false, error: "accountId fehlt." });
        const info = await getPublishInfo(apiKey, String(body.accountId));
        return res.status(200).json({ ok: true, info });
      }

      return res.status(400).json({ ok: false, error: `Unbekannte Aktion: ${action}` });
    }

    return res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (e) {
    console.error("Postlake API route error:", e);
    return res.status(500).json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

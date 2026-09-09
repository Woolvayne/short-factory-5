/**
 * ShortsFactory — TTS relay (Vercel Serverless Function, Node.js runtime)
 *
 * Why this exists: browsers cannot open a WebSocket to Microsoft's Edge Read
 * Aloud endpoint (browser handshakes always carry an Origin header, which the
 * endpoint rejects), and Supabase's Edge Function runtime unreliably drops
 * outbound third-party WebSockets ("EarlyDrop" after ~10ms CPU). The Node.js
 * runtime on Vercel has no such restriction — raw `ws` connections work.
 *
 * Implements the publicly documented open-source edge-tts protocol
 * (github.com/rany2/edge-tts), including the current hardening:
 *   - Sec-MS-GEC token: SHA-256 over Windows-epoch ticks (rounded to 5 min)
 *     + TrustedClientToken, BigInt math, with clock-skew correction on 403
 *   - Read-Aloud extension Origin + matching Chromium/143 User-Agent
 *   - muid cookie, permessage-deflate, JS-style X-Timestamp frames
 *
 *   POST { "text": "...", "voice": "en-US-AndrewNeural", "rate": 2, "pitch": 0 }
 *   → 200 { "ok": true, "format": "audio/mpeg", "audioBase64": "…",
 *           "words": [{ "text": "...", "offset": 0.42, "duration": 0.21 }, …] }
 *
 * audioBase64 is a concatenated MP3 stream (audio-24khz-48kbitrate-mono-mp3).
 * offsets/durations are SECONDS (converted from the 100-ns WordBoundary ticks).
 *
 * Same-origin with the app → no CORS, no apikey, no auth.
 */

// Explicitly pin the Node.js runtime (NOT edge) — raw outbound WebSocket via "ws".
export const config = {
  runtime: "nodejs",
  // Story texts are a few hundred words; 60s covers slow synthesis runs.
  maxDuration: 60,
};

import { createHash } from "node:crypto";
import WebSocket from "ws";

/* ------------------------------------------------------------------ */
/*  constants — mirrors edge-tts src/edge_tts/constants.py              */
/* ------------------------------------------------------------------ */

const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const CHROMIUM_FULL_VERSION = "143.0.3650.75";
const CHROMIUM_MAJOR_VERSION = CHROMIUM_FULL_VERSION.split(".")[0];
const SEC_MS_GEC_VERSION = `1-${CHROMIUM_FULL_VERSION}`;
const OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";
const DEFAULT_VOICE = "en-US-AndrewNeural";

const BASE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
    `Chrome/${CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR_VERSION}.0.0.0`,
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "Accept-Language": "en-US,en;q=0.9",
};

const WS_HEADERS = {
  Pragma: "no-cache",
  "Cache-Control": "no-cache",
  Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
  "Sec-WebSocket-Version": "13",
  ...BASE_HEADERS,
};

const WIN_EPOCH = 11644473600n;
const TICKS_PER_SECOND = 10_000_000n;
const ROUNDING_SECONDS = 300n; // token rotates every 5 minutes

/* ------------------------------------------------------------------ */
/*  DRM — Sec-MS-GEC token with clock-skew correction                  */
/* ------------------------------------------------------------------ */

let clockSkewMs = 0;

const hex32 = () =>
  [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

/** SHA-256(ticks rounded down to 5min + trusted token), uppercase hex. BigInt
 *  is required — the tick value (~1.34e17) exceeds 2^53. */
function generateSecMsGec() {
  const nowSeconds = BigInt(Math.floor((Date.now() + clockSkewMs) / 1000));
  let ticks = (nowSeconds + WIN_EPOCH) * TICKS_PER_SECOND;
  ticks -= ticks % (ROUNDING_SECONDS * TICKS_PER_SECOND);
  const strToHash = `${ticks}${TRUSTED_CLIENT_TOKEN}`;
  return createHash("sha256").update(strToHash, "utf8").digest("hex").toUpperCase();
}

/** Fresh muid cookie per connection, like the reference client. */
const generateMuid = () =>
  [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();

const wssUrl = (gec, connId) =>
  "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1" +
  `?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}` +
  `&ConnectionId=${connId}` +
  `&Sec-MS-GEC=${gec}` +
  `&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;

/* ------------------------------------------------------------------ */
/*  frames — mirrors edge-tts src/edge_tts/communicate.py               */
/* ------------------------------------------------------------------ */

/** JS-style date string, exactly like the reference client sends it. */
function dateToString() {
  const d = new Date();
  const parts = [
    "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat",
  ][d.getUTCDay()];
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ][d.getUTCMonth()];
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${parts} ${months} ${d.getUTCDate()} ${d.getUTCFullYear()} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} ` +
    `GMT+0000 (Coordinated Universal Time)`
  );
}

function speechConfigFrame() {
  const body = JSON.stringify({
    context: {
      synthesis: {
        audio: {
          metadataoptions: { sentenceBoundaryEnabled: "false", wordBoundaryEnabled: "true" },
          outputFormat: OUTPUT_FORMAT,
        },
      },
    },
  });
  return (
    `X-Timestamp:${dateToString()}\r\n` +
    "Content-Type:application/json; charset=utf-8\r\n" +
    "Path:speech.config\r\n\r\n" +
    body
  );
}

const escapeXml = (s) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/'/g, "&apos;")
    .replace(/"/g, "&quot;");

const signed = (n) => `${n >= 0 ? "+" : "-"}${Math.abs(Math.round(n))}`;

function ssmlFrame(text, voice, rate, pitch) {
  const ssml =
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>` +
    `<voice name='${voice}'>` +
    `<prosody pitch='${signed(pitch)}Hz' rate='${signed(rate)}%' volume='+0%'>${escapeXml(text)}</prosody>` +
    `</voice></speak>`;
  return (
    `X-RequestId:${hex32()}\r\n` +
    "Content-Type:application/ssml+xml\r\n" +
    `X-Timestamp:${dateToString()}Z\r\n` + // trailing Z is an upstream quirk, kept on purpose
    "Path:ssml\r\n\r\n" +
    ssml
  );
}

function parseTextFrame(raw) {
  const idx = raw.indexOf("\r\n\r\n");
  const head = idx === -1 ? raw : raw.slice(0, idx);
  const body = idx === -1 ? "" : raw.slice(idx + 4);
  const headers = {};
  for (const line of head.split("\r\n")) {
    const c = line.indexOf(":");
    if (c > 0) headers[line.slice(0, c).trim().toLowerCase()] = line.slice(c + 1).trim();
  }
  return { headers, body };
}

/* ------------------------------------------------------------------ */
/*  synthesis — one WebSocket per request                               */
/* ------------------------------------------------------------------ */

function speakOnce(text, voice, rate, pitch) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const chunks = [];
    const words = [];

    const headers = { ...WS_HEADERS, Cookie: `muid=${generateMuid()};` };
    const ws = new WebSocket(wssUrl(generateSecMsGec(), hex32()), {
      headers,
      perMessageDeflate: true,
    });

    const timer = setTimeout(() => {
      finish(new Error("TTS socket timed out after 45s"));
    }, 45_000);

    const finish = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
      } catch {
        /* noop */
      }
      if (err) {
        reject(err);
        return;
      }
      const total = chunks.reduce((n, c) => n + c.length, 0);
      const audio = Buffer.alloc(total);
      let off = 0;
      for (const c of chunks) {
        c.copy(audio, off);
        off += c.length;
      }
      resolve({ audio, words });
    };

    ws.on("open", () => {
      ws.send(speechConfigFrame());
      ws.send(ssmlFrame(text, voice, rate, pitch));
    });

    ws.on("error", (err) => finish(err instanceof Error ? err : new Error(String(err))));
    ws.on("close", (code) => {
      if (settled) return;
      if (chunks.length > 0) finish(); // server dropped after streaming — use what we have
      else finish(new Error(`TTS socket closed early (code ${code})`));
    });

    ws.on("message", (data, isBinary) => {
      try {
        if (!isBinary) {
          const { headers: frameHeaders, body } = parseTextFrame(data.toString("utf8"));
          const path = frameHeaders["path"];
          if (path === "audio.metadata") {
            const payload = JSON.parse(body);
            for (const meta of payload?.Metadata ?? []) {
              if (meta?.Type === "WordBoundary" && meta?.Data) {
                words.push({
                  text: meta.Data.text?.Text ?? "",
                  offset: Number(meta.Data.Offset ?? 0) / 1e7,
                  duration: Number(meta.Data.Duration ?? 0) / 1e7,
                });
              }
            }
          } else if (path === "turn.end") {
            finish();
          }
        } else {
          const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
          if (buf.length < 3) return;
          const headerLen = (buf[0] << 8) | buf[1];
          if (2 + headerLen > buf.length) return;
          const head = buf.toString("utf8", 2, 2 + headerLen);
          if (/^Path:audio\r\n/im.test(head)) {
            chunks.push(buf.subarray(2 + headerLen));
          }
        }
      } catch {
        /* a malformed frame must not kill the render */
      }
    });
  });
}

/**
 * Speak with one 403 retry: on a skew-induced 403, read the server's Date
 * header, correct the clock, and try once more (same as the reference).
 */
async function synthesize(text, voice, rate, pitch) {
  try {
    return await speakOnce(text, voice, rate, pitch);
  } catch (e) {
    const status = e?.message?.match(/response: (\d+)/)?.[1];
    const serverDate = e?.httpResponse?.headers?.date;
    if (status === "403" && serverDate) {
      const skew = Date.parse(serverDate) - Date.now();
      if (Number.isFinite(skew) && Math.abs(skew) > 1000) {
        clockSkewMs += skew;
        console.warn(`tts: clock skew ${skew}ms detected via 403, retrying`);
        return await speakOnce(text, voice, rate, pitch);
      }
    }
    throw e;
  }
}

const toBase64 = (buf) => buf.toString("base64");
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/* ------------------------------------------------------------------ */
/*  handler                                                             */
/* ------------------------------------------------------------------ */

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "content-type");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    return res.status(204).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "POST only" });
  }

  try {
    const body =
      typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body ?? {});
    const text = body?.text;
    if (typeof text !== "string" || text.trim().length < 3) {
      return res.status(400).json({ ok: false, error: "text (string, ≥3 chars) is required" });
    }
    if (text.length > 4000) {
      return res.status(400).json({ ok: false, error: "text is too long (max 4000 chars)" });
    }

    const rawVoice = body?.voice;
    const voice =
      typeof rawVoice === "string" && /^[A-Za-z0-9_-]+$/.test(rawVoice)
        ? rawVoice
        : DEFAULT_VOICE;
    const rate = clamp(Number(body?.rate ?? 0) || 0, -50, 50);
    const pitch = clamp(Number(body?.pitch ?? 0) || 0, -50, 50);

    const { audio, words } = await synthesize(text.trim(), voice, rate, pitch);
    if (audio.length === 0) {
      return res.status(502).json({ ok: false, error: "TTS returned no audio frames" });
    }

    return res.status(200).json({
      ok: true,
      format: "audio/mpeg",
      sampleRate: 24000,
      audioBase64: toBase64(audio),
      words,
    });
  } catch (e) {
    console.error("tts relay crashed", e);
    return res.status(500).json({ ok: false, error: String(e?.message ?? e).slice(0, 300) });
  }
}

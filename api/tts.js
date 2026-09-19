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
 * Offline fallback: if the Edge upstream is unreachable (403/429/5xx, DNS,
 * TLS, socket errors), narration is synthesized locally with meSpeak (a JS
 * port of eSpeak, zero network). The fallback answers with the same shape
 * but format "audio/wav" (11025 Hz 8-bit mono — small enough for the
 * serverless response limit), estimated word timings, plus
 * { "fallback": "mespeak", "warning": "…" }. Video creation therefore no
 * longer fails just because the TTS upstream is down.
 *
 * Same-origin with the app → no CORS, no apikey, no auth.
 */

// Explicitly pin the Node.js runtime (NOT edge) — raw outbound WebSocket via "ws".
export const config = {
  runtime: "nodejs",
  // Story texts are a few hundred words; 60s covers slow synthesis runs.
  maxDuration: 60,
};

import { createHash, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import WebSocket from "ws";
import { gateBlocked } from "../server/gate-core.js";

// meSpeak ships as CommonJS; this file is ESM ("type": "module").
const cjsRequire = createRequire(import.meta.url);

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

const hex32 = () => randomBytes(16).toString("hex");

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
const generateMuid = () => randomBytes(16).toString("hex").toUpperCase();

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
    body +
    "\r\n"
  );
}

const sanitizeText = (s) =>
  s
    // Edge rejects XML-invalid C0 controls; keep normal whitespace usable.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const escapeXml = (s) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/'/g, "&apos;")
    .replace(/"/g, "&quot;");

const unescapeXml = (s) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");

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

function makeTtsError(message, extra = {}) {
  const err = new Error(message);
  Object.assign(err, extra);
  return err;
}

function upstreamStatus(e) {
  const direct = Number(e?.statusCode ?? e?.status);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const msg = String(e?.message ?? "");
  const m = msg.match(/(?:response|status|HTTP)[: ]+(\d{3})/i);
  return m ? Number(m[1]) : null;
}

function upstreamDate(e) {
  return (
    e?.responseHeaders?.date ??
    e?.httpResponse?.headers?.date ??
    e?.headers?.date ??
    null
  );
}

function retryableUpstreamError(e) {
  const status = upstreamStatus(e);
  if (status && [408, 425, 429, 500, 502, 503, 504].includes(status)) return true;
  const code = String(e?.code ?? "");
  if (["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ENOTFOUND", "ECONNREFUSED"].includes(code)) return true;
  return /timed out|socket closed early|network socket|TLS connection|aborted/i.test(String(e?.message ?? ""));
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function speakOnce(text, voice, rate, pitch) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const chunks = [];
    const words = [];

    const headers = { ...WS_HEADERS, Cookie: `muid=${generateMuid()};` };
    const ws = new WebSocket(wssUrl(generateSecMsGec(), hex32()), {
      headers,
      perMessageDeflate: true,
      handshakeTimeout: 15_000,
    });

    const timer = setTimeout(() => {
      finish(makeTtsError("TTS socket timed out after 45s", { code: "ETIMEDOUT" }));
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

    ws.on("unexpected-response", (_req, response) => {
      const statusCode = response.statusCode ?? 0;
      response.resume();
      finish(
        makeTtsError(`TTS socket unexpected response: ${statusCode}`, {
          statusCode,
          responseHeaders: response.headers,
        })
      );
    });

    ws.on("error", (err) => finish(err instanceof Error ? err : new Error(String(err))));
    ws.on("close", (code) => {
      if (settled) return;
      if (chunks.length > 0) finish(); // server dropped after streaming — use what we have
      else finish(makeTtsError(`TTS socket closed early (code ${code})`, { closeCode: code }));
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
                  text: unescapeXml(String(meta.Data.text?.Text ?? "")),
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
            const audio = buf.subarray(2 + headerLen);
            if (audio.length > 0) chunks.push(audio);
          }
        }
      } catch {
        /* a malformed frame must not kill the render */
      }
    });
  });
}

/**
 * Speak with hardening from edge-tts:
 * - on skew-induced 403, read the upstream Date header and retry once
 * - on one-off socket/TLS hiccups, retry once before surfacing a 502
 */
async function synthesize(text, voice, rate, pitch) {
  const cleaned = sanitizeText(text);
  let lastErr = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await speakOnce(cleaned, voice, rate, pitch);
    } catch (e) {
      lastErr = e;
      const status = upstreamStatus(e);
      const serverDate = upstreamDate(e);

      if (status === 403 && serverDate) {
        const skew = Date.parse(serverDate) - Date.now();
        if (Number.isFinite(skew) && Math.abs(skew) > 1000) {
          clockSkewMs += skew;
          console.warn(`tts: clock skew ${skew}ms detected via 403, retrying`);
          return await speakOnce(cleaned, voice, rate, pitch);
        }
      }

      if (attempt === 0 && retryableUpstreamError(e)) {
        await wait(700);
        continue;
      }
      throw e;
    }
  }

  throw lastErr;
}

const toBase64 = (buf) => buf.toString("base64");
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/* ------------------------------------------------------------------ */
/*  offline fallback — meSpeak/eSpeak (zero network)                     */
/*                                                                     */
/*  Only used when the Edge upstream fails. meSpeak renders a WAV fully */
/*  locally; it is downsampled to 11025 Hz 8-bit mono so even a max-    */
/*  length text stays within the serverless response-size limit         */
/*  (~2.9 MB PCM → ~3.9 MB base64). Word timings are estimated ∝ word   */
/*  length so captions keep working (slightly off-beat, but present).   */
/* ------------------------------------------------------------------ */

const MESPEAK_OFFLINE_RATE = 11025;
const MESPEAK_PCM_BUDGET = 2_900_000; // bytes — keeps base64 JSON < ~4 MB
const MESPEAK_DEFAULT_SPEED = 175; // eSpeak words per minute

// Static require paths on purpose: the Vercel file tracer only picks up
// literal module paths (see also vercel.json → functions → includeFiles).
const mespeakConfigLoader = () => cjsRequire("mespeak/src/mespeak_config.json");
const MESPEAK_VOICE_LOADERS = {
  "en/en-us": () => cjsRequire("mespeak/voices/en/en-us.json"),
  "en/en": () => cjsRequire("mespeak/voices/en/en.json"),
  de: () => cjsRequire("mespeak/voices/de.json"),
  fr: () => cjsRequire("mespeak/voices/fr.json"),
  es: () => cjsRequire("mespeak/voices/es.json"),
  it: () => cjsRequire("mespeak/voices/it.json"),
  nl: () => cjsRequire("mespeak/voices/nl.json"),
  pl: () => cjsRequire("mespeak/voices/pl.json"),
  pt: () => cjsRequire("mespeak/voices/pt.json"),
  tr: () => cjsRequire("mespeak/voices/tr.json"),
};

/** Map an Edge voice name ("de-DE-KatjaNeural") to a meSpeak voice id. */
function mespeakVoiceId(edgeVoice) {
  const v = String(edgeVoice || "");
  if (/^en-US/i.test(v)) return "en/en-us";
  if (/^en-/i.test(v)) return "en/en";
  const lang = v.slice(0, 2).toLowerCase();
  if (MESPEAK_VOICE_LOADERS[lang]) return lang;
  return "en/en-us";
}

// Lazily initialized once per warm function instance (the eSpeak engine +
// config weigh ~5 MB — never pay that on the happy path).
let mespeakCache = null; // { api, voices: Set<string> }

function ensureMespeak(voiceId) {
  if (!mespeakCache) {
    const api = cjsRequire("mespeak");
    api.loadConfig(mespeakConfigLoader());
    if (!api.isConfigLoaded()) throw new Error("meSpeak config failed to load");
    mespeakCache = { api, voices: new Set() };
  }
  const { api, voices } = mespeakCache;
  if (!voices.has(voiceId)) {
    api.loadVoice(MESPEAK_VOICE_LOADERS[voiceId]());
    voices.add(voiceId);
  }
  api.setDefaultVoice(voiceId);
  return api;
}

/** Split long texts at sentence boundaries (eSpeak handles ~1k chars best). */
function splitForOffline(text, maxLen = 900) {
  const sentences = String(text).match(/[^.!?;:\n]+[.!?;:\n]*\s*/g) || [String(text)];
  const chunks = [];
  let cur = "";
  for (const s of sentences) {
    if ((cur + s).trim().length > maxLen && cur.trim()) {
      chunks.push(cur.trim());
      cur = s;
    } else {
      cur += s;
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  // hard-split pathological single-sentence blobs on word boundaries
  const out = [];
  for (const c of chunks) {
    if (c.length <= maxLen) {
      out.push(c);
      continue;
    }
    let part = "";
    for (const w of c.split(/\s+/)) {
      if ((`${part} ${w}`).trim().length > maxLen && part) {
        out.push(part.trim());
        part = w;
      } else {
        part = part ? `${part} ${w}` : w;
      }
    }
    if (part.trim()) out.push(part.trim());
  }
  return out.filter(Boolean);
}

/** Tolerant RIFF/WAVE parser → { sampleRate, channels, bits, pcm }. */
function parseWavPcm(buf) {
  if (
    buf.length < 44 ||
    buf.toString("ascii", 0, 4) !== "RIFF" ||
    buf.toString("ascii", 8, 12) !== "WAVE"
  ) {
    throw new Error("meSpeak returned invalid WAV data");
  }
  let sampleRate = 0;
  let channels = 0;
  let bits = 0;
  let pcm = null;
  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === "fmt " && size >= 16) {
      channels = buf.readUInt16LE(off + 10);
      sampleRate = buf.readUInt32LE(off + 12);
      bits = buf.readUInt16LE(off + 22);
    } else if (id === "data") {
      pcm = buf.subarray(off + 8, off + 8 + size);
    }
    off += 8 + size + (size % 2);
  }
  if (!sampleRate || !pcm || pcm.length === 0) {
    throw new Error("meSpeak WAV contains no audio frames");
  }
  return { sampleRate, channels: channels || 1, bits: bits || 16, pcm: Buffer.from(pcm) };
}

/** Decimate 16-bit PCM to 11025 Hz 8-bit unsigned mono (universally decodable). */
function downsampleToOffline(pcm, inRate) {
  const factor = Math.max(1, Math.round(inRate / MESPEAK_OFFLINE_RATE));
  const outRate = Math.round(inRate / factor);
  const inSamples = Math.floor(pcm.length / 2);
  const outSamples = Math.ceil(inSamples / factor);
  const out = Buffer.alloc(outSamples);
  for (let i = 0; i < outSamples; i++) {
    const s = pcm.readInt16LE(Math.min(i * factor, inSamples - 1) * 2);
    out[i] = clamp((s >> 8) + 128, 0, 255);
  }
  return { outRate, pcm8: out };
}

function buildWav8(pcm8, sampleRate) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm8.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate, 28); // byteRate = rate × 1ch × 1B
  header.writeUInt16LE(1, 32); // blockAlign
  header.writeUInt16LE(8, 34); // bitsPerSample
  header.write("data", 36);
  header.writeUInt32LE(pcm8.length, 40);
  return Buffer.concat([header, pcm8]);
}

/**
 * Offline synthesis — same contract as synthesize(), but local.
 * Exported for the local smoke test; the handler calls it on upstream failure.
 */
export async function synthesizeOffline(text, voice, rate, pitch) {
  const cleaned = sanitizeText(text);
  if (!cleaned) throw new Error("nothing to synthesize");
  const voiceId = mespeakVoiceId(voice);
  const api = ensureMespeak(voiceId);

  // requested rate (Edge-style ±%) → eSpeak words-per-minute
  let speed = clamp(Math.round(MESPEAK_DEFAULT_SPEED * (1 + rate / 100)), 80, 450);
  // …but never so slow that the WAV would blow the response-size budget
  const wordCount = Math.max(1, cleaned.split(/\s+/).length);
  const minSpeed = Math.ceil((60 * wordCount * MESPEAK_OFFLINE_RATE) / MESPEAK_PCM_BUDGET);
  if (speed < minSpeed) speed = Math.min(450, minSpeed);
  const p = clamp(50 + Math.round(pitch), 0, 99);

  const chunks = splitForOffline(cleaned);
  const parts = [];
  const words = [];
  let cursor = 0;
  for (const chunk of chunks) {
    const raw = api.speak(chunk, {
      voice: voiceId,
      speed,
      pitch: p,
      wordgap: 2,
      rawdata: "array", // plain number[] — Buffer.from() it, no deprecated `new Buffer`
    });
    if (!raw || raw.length === 0) throw new Error("meSpeak returned no audio");
    const { sampleRate, pcm } = parseWavPcm(Buffer.from(raw));
    const { outRate, pcm8 } = downsampleToOffline(pcm, sampleRate);
    const dur = pcm8.length / outRate;
    parts.push({ outRate, pcm8 });

    const chunkWords = chunk.split(/\s+/).filter(Boolean);
    const weights = chunkWords.map((w) => w.replace(/[^\p{L}\p{N}]/gu, "").length + 1);
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    for (let i = 0; i < chunkWords.length; i++) {
      const d = (weights[i] / total) * dur;
      words.push({ text: chunkWords[i], offset: cursor, duration: d });
      cursor += d;
    }
  }

  const outRate = parts[0].outRate;
  const audio = buildWav8(Buffer.concat(parts.map((x) => x.pcm8)), outRate);
  return { audio, words, voiceId, sampleRate: outRate };
}

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

  // APP_PASSWORD gesetzt & Session ungültig? → 401 (Gate-Schutz, siehe server/gate-core.js)
  if (gateBlocked(req, res)) return;

  try {
    let body = req.body ?? {};
    if (typeof body === "string") {
      try {
        body = JSON.parse(body || "{}");
      } catch {
        return res.status(400).json({ ok: false, error: "Invalid JSON body" });
      }
    }

    const rawText = body?.text;
    const text = typeof rawText === "string" ? sanitizeText(rawText) : "";
    if (text.length < 3) {
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

    let audio;
    let words;
    let offline = false;
    let offlineRate = 0;
    let offlineWarning = "";
    try {
      ({ audio, words } = await synthesize(text, voice, rate, pitch));
      if (!audio || audio.length === 0) throw new Error("TTS returned no audio frames");
    } catch (upstreamErr) {
      // Upstream down → still render the video, with a local eSpeak voice.
      console.error("tts upstream failed, using offline fallback", upstreamErr);
      const fb = await synthesizeOffline(text, voice, rate, pitch);
      audio = fb.audio;
      words = fb.words;
      offline = true;
      offlineRate = fb.sampleRate;
      offlineWarning =
        `Edge-TTS war nicht erreichbar (${String(upstreamErr?.message ?? upstreamErr).slice(0, 160)}). ` +
        "Offline-Ersatzstimme (eSpeak) verwendet.";
    }

    return res.status(200).json({
      ok: true,
      format: offline ? "audio/wav" : "audio/mpeg",
      sampleRate: offline ? offlineRate : 24000,
      audioBase64: toBase64(audio),
      words,
      ...(offline ? { fallback: "mespeak", warning: offlineWarning } : {}),
    });
  } catch (e) {
    // Reached only when BOTH the upstream and the offline fallback failed.
    const status = upstreamStatus(e);
    const code = (status && status >= 400) || retryableUpstreamError(e) ? 502 : 500;
    const message = String(e?.message ?? e).slice(0, 300);
    console.error("tts relay failed (upstream + offline fallback)", e);
    return res.status(code).json({
      ok: false,
      error: status
        ? `TTS failed (HTTP ${status}): ${message}`
        : `TTS failed (upstream + offline fallback): ${message}`,
    });
  }
}

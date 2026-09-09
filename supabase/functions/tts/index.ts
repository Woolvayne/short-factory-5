/**
 * ShortsFactory — tts (Supabase Edge Function, Deno runtime)
 *
 * Narration relay for the browser app. Browsers cannot open a WebSocket to
 * Microsoft's Edge Read Aloud endpoint because every browser WebSocket
 * handshake carries an Origin header, which the endpoint rejects. A
 * server-to-server WebSocket client doesn't send one — so the exact same
 * protocol that fails in the browser succeeds here.
 *
 *   POST  { "text": "...", "voice": "en-US-AndrewNeural", "rate": 2, "pitch": 0 }
 *   → 200 { "ok": true, "audioBase64": "…", "words": [{ text, offset, duration }] }
 *
 * audioBase64 is a concatenated MP3 stream (audio-24khz-48kbitrate-mono-mp3).
 * offsets/durations are SECONDS (converted from the 100-ns WordBoundary ticks).
 *
 * Deploy:  supabase functions deploy tts --no-verify-jwt
 */

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve: (handler: (req: Request) => Promise<Response> | Response) => void;
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

/* ------------------------------------------------------------------ */
/*  Microsoft Edge Read Aloud protocol (public edge-tts protocol)       */
/* ------------------------------------------------------------------ */

const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const CHROMIUM_FULL_VERSION = "143.0.3650.75";
const SEC_MS_GEC_VERSION = `1-${CHROMIUM_FULL_VERSION}`;
const OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";
const DEFAULT_VOICE = Deno.env.get("TTS_VOICE") ?? "en-US-AndrewNeural";

const WIN_EPOCH = 11644473600n;
const TICKS_PER_SECOND = 10_000_000n;
const TOKEN_ROUNDING = 3_000_000_000n;

const hex32 = () => crypto.randomUUID().replaceAll("-", "");

/* BigInt math required — the tick value (~1.34e17) exceeds 2^53. */
async function generateSecMsGec(): Promise<string> {
  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
  let ticks = (nowSeconds + WIN_EPOCH) * TICKS_PER_SECOND;
  ticks -= ticks % TOKEN_ROUNDING;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${ticks}${TRUSTED_CLIENT_TOKEN}`)
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

const wssUrl = (gec: string, connId: string) =>
  "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1" +
  `?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}` +
  `&Sec-MS-GEC=${gec}` +
  `&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}` +
  `&ConnectionId=${connId}`;

const tsHeader = () => new Date().toUTCString();

function speechConfigFrame(): string {
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
  return `X-Timestamp:${tsHeader()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n${body}`;
}

const escapeXml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/'/g, "&apos;")
    .replace(/"/g, "&quot;");

const signed = (n: number) => `${n >= 0 ? "+" : "-"}${Math.abs(Math.round(n))}`;

function ssmlFrame(text: string, voice: string, rate: number, pitch: number): string {
  const ssml =
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>` +
    `<voice name='${voice}'>` +
    `<prosody pitch='${signed(pitch)}Hz' rate='${signed(rate)}%' volume='+0%'>${escapeXml(text)}</prosody>` +
    `</voice></speak>`;
  return `X-RequestId:${hex32()}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${tsHeader()}\r\nPath:ssml\r\n\r\n${ssml}`;
}

function parseTextFrame(raw: string): { headers: Record<string, string>; body: string } {
  const idx = raw.indexOf("\r\n\r\n");
  const head = idx === -1 ? raw : raw.slice(0, idx);
  const body = idx === -1 ? "" : raw.slice(idx + 4);
  const headers: Record<string, string> = {};
  for (const line of head.split("\r\n")) {
    const c = line.indexOf(":");
    if (c > 0) headers[line.slice(0, c).trim().toLowerCase()] = line.slice(c + 1).trim();
  }
  return { headers, body };
}

interface WordTs {
  text: string;
  offset: number;   // seconds from the start of the returned audio
  duration: number; // seconds
}

function synthesize(
  text: string,
  voice: string,
  rate: number,
  pitch: number
): Promise<{ audio: Uint8Array; words: WordTs[] }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let ws: WebSocket;
    const chunks: Uint8Array[] = [];
    const words: WordTs[] = [];

    const timer = setTimeout(() => finish(new Error("TTS socket timed out after 60s")), 60_000);

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws?.close();
      } catch {
        /* noop */
      }
      if (err) {
        reject(err);
        return;
      }
      const total = chunks.reduce((n, c) => n + c.length, 0);
      const audio = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) {
        audio.set(c, off);
        off += c.length;
      }
      resolve({ audio, words });
    };

    (async () => {
      const gec = await generateSecMsGec();
      ws = new WebSocket(wssUrl(gec, hex32()));
      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        ws.send(speechConfigFrame());
        ws.send(ssmlFrame(text, voice, rate, pitch));
      };
      ws.onerror = () => finish(new Error("TTS websocket error"));
      ws.onclose = (ev) => {
        if (settled) return;
        if (chunks.length > 0) finish();
        else finish(new Error(`TTS socket closed early (code ${ev.code})`));
      };
      ws.onmessage = (ev: MessageEvent) => {
        try {
          if (typeof ev.data === "string") {
            const { headers, body } = parseTextFrame(ev.data);
            const path = headers["path"];
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
            const buf = new Uint8Array(ev.data as ArrayBuffer);
            const headerLen = (buf[0] << 8) | buf[1];
            const head = new TextDecoder().decode(buf.subarray(2, 2 + headerLen));
            if (/^Path:audio\r\n/im.test(head)) chunks.push(buf.slice(2 + headerLen));
          }
        } catch {
          /* a malformed frame must not kill the render */
        }
      };
    })().catch((e) => finish(e instanceof Error ? e : new Error(String(e))));
  });
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/* ------------------------------------------------------------------ */
/*  handler                                                             */
/* ------------------------------------------------------------------ */

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);

  try {
    const body = await req.json().catch(() => null);
    const text: unknown = body?.text;
    if (typeof text !== "string" || text.trim().length < 3) {
      return json({ ok: false, error: "text (string, ≥3 chars) is required" }, 400);
    }
    if (text.length > 4000) {
      return json({ ok: false, error: "text is too long (max 4000 chars per request)" }, 400);
    }

    const rawVoice: unknown = body?.voice;
    const voice =
      typeof rawVoice === "string" && /^[A-Za-z0-9_-]+$/.test(rawVoice)
        ? rawVoice
        : DEFAULT_VOICE;
    const rate = clamp(Number(body?.rate ?? 0) || 0, -50, 50);
    const pitch = clamp(Number(body?.pitch ?? 0) || 0, -50, 50);

    const { audio, words } = await synthesize(text.trim(), voice, rate, pitch);
    if (audio.byteLength === 0) {
      return json({ ok: false, error: "TTS returned no audio frames" }, 502);
    }

    return json({
      ok: true,
      format: "audio/mpeg",
      sampleRate: 24000,
      audioBase64: toBase64(audio),
      words,
    });
  } catch (e) {
    console.error("tts crashed", e);
    return json(
      { ok: false, error: String(e instanceof Error ? e.message : e).slice(0, 300) },
      500
    );
  }
});

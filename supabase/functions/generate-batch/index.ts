/**
 * ShortsFactory — generate-batch (Supabase Edge Function, Deno runtime)
 *
 * Pipeline per video (x10, concurrency 3):
 *   1. SCRIPT   Qwen (DashScope OpenAI-compatible) / Mistral, alternating
 *   2. VOICE    Microsoft Edge Read Aloud TTS over a native WebSocket
 *               (public edge-tts protocol — Sec-MS-GEC token, no API key)
 *               + word-boundary timestamps -> 2–4 word caption cues
 *   3. RENDER   Shotstack PRODUCTION render API (no watermark)
 *               bg loop trimmed/looped + voice + quiet soundtrack + captions
 *
 * Secrets (never exposed to the frontend):
 *   QWEN_API_KEY, MISTRAL_API_KEY, SHOTSTACK_API_KEY
 * Auto-provisioned by Supabase: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 *
 * Deploy:  supabase functions deploy generate-batch --no-verify-jwt
 */

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve: (handler: (req: Request) => Promise<Response> | Response) => void;
};
declare const EdgeRuntime: { waitUntil: (promise: Promise<unknown>) => void } | undefined;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const QWEN_API_KEY = Deno.env.get("QWEN_API_KEY") ?? "";
const MISTRAL_API_KEY = Deno.env.get("MISTRAL_API_KEY") ?? "";
const SHOTSTACK_API_KEY = Deno.env.get("SHOTSTACK_API_KEY") ?? "";

/* International (Singapore) DashScope accounts use dashscope-intl.aliyuncs.com —
 * override with the optional QWEN_API_BASE secret if your key lives there. */
const QWEN_URL =
  Deno.env.get("QWEN_API_BASE") ??
  "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const MISTRAL_URL = "https://api.mistral.ai/v1/chat/completions";
const QWEN_MODEL = "qwen-turbo";
const MISTRAL_MODEL = "mistral-small-latest";

/* production environment on purpose — the sandbox renders a watermark */
const SHOTSTACK_BASE = "https://api.shotstack.io/v1";

const TTS_VOICE = Deno.env.get("TTS_VOICE") ?? "en-US-AndrewNeural";
const MUSIC_VOLUME = 0.12;
const MAX_VIDEO_SECONDS = 90;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

/* ------------------------------------------------------------------ */
/*  Supabase REST helpers (service role — bypasses RLS by design)       */
/* ------------------------------------------------------------------ */

async function db(path: string, init: RequestInit = {}): Promise<Response> {
  return await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
      ...(init.headers ?? {}),
    },
  });
}

async function updateRender(id: string, patch: Record<string, unknown>) {
  const res = await db(`renders?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(patch) });
  if (!res.ok) console.error("renders PATCH failed", res.status, await res.text());
}

const publicUrl = (bucket: string, path: string) =>
  `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;

async function uploadAudio(path: string, bytes: Uint8Array) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/audio/${path}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "audio/mpeg",
      "x-upsert": "true",
    },
    body: bytes as unknown as BodyInit,
  });
  if (!res.ok) throw new Error(`voice upload failed (${res.status}): ${(await res.text()).slice(0, 160)}`);
}

/* ------------------------------------------------------------------ */
/*  1. STORY — Qwen / Mistral alternation                               */
/* ------------------------------------------------------------------ */

const STORY_SYSTEM = [
  "You write viral first-person Reddit stories (r/AmItheAsshole, r/pettyrevenge, r/TrueOffMyChest energy).",
  "Rules: 150–220 words. First person. English only. Start mid-action with a punchy hook sentence.",
  "Escalate fast, land a satisfying twist or kicker at the end.",
  "Plain spoken language — it will be read aloud by a text-to-speech voice.",
  "Return ONLY the story text. No title, no quotation marks wrapping the story, no 'EDIT:', no hashtags, no emojis.",
].join(" ");

interface StoryResult {
  text: string;
  provider: "qwen" | "mistral";
}

async function callChat(
  provider: "qwen" | "mistral",
  url: string,
  apiKey: string,
  model: string,
  idea: string
): Promise<string> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 1.05,
      max_tokens: 700,
      messages: [
        { role: "system", content: STORY_SYSTEM },
        {
          role: "user",
          content: `Story premise: ${idea}\n\nWrite the story now (150–220 words, first person).`,
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`${provider} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const text: string | undefined = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error(`${provider} returned an empty story`);
  return text.trim().replace(/^["'“”]+|["'“”]+$/g, "").trim();
}

async function generateStory(idea: string, preferQwen: boolean): Promise<StoryResult> {
  const order: { provider: "qwen" | "mistral"; url: string; key: string; model: string }[] = [
    { provider: "qwen", url: QWEN_URL, key: QWEN_API_KEY, model: QWEN_MODEL },
    { provider: "mistral", url: MISTRAL_URL, key: MISTRAL_API_KEY, model: MISTRAL_MODEL },
  ];
  if (!preferQwen) order.reverse();

  let lastErr: unknown = null;
  for (const p of order) {
    if (!p.key) continue;
    try {
      return { text: await callChat(p.provider, p.url, p.key, p.model, idea), provider: p.provider };
    } catch (e) {
      console.error(`${p.provider} failed, falling back`, e);
      lastErr = e;
    }
  }
  throw new Error(`all LLM providers failed — ${lastErr instanceof Error ? lastErr.message : lastErr}`);
}

/* ------------------------------------------------------------------ */
/*  2. VOICE — Microsoft Edge Read Aloud protocol (native WebSocket)    */
/*  Implements the publicly documented open-source edge-tts protocol:   */
/*   - TrustedClientToken + Sec-MS-GEC (SHA-256 clock-skew token)       */
/*   - speech.config frame requests word-boundary metadata              */
/*   - SSML frame; response = binary audio frames + JSON word timings   */
/* ------------------------------------------------------------------ */

const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const CHROMIUM_FULL_VERSION = "130.0.2849.68";
const SEC_MS_GEC_VERSION = `1-${CHROMIUM_FULL_VERSION}`;
const WIN_EPOCH = 11644473600n;
const TICKS_PER_SECOND = 10_000_000n;
const TOKEN_ROUNDING = 3_000_000_000n;

function hex32(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

/* BigInt math required — the tick value (~1.34e17) exceeds 2^53. */
async function generateSecMsGec(): Promise<string> {
  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
  let ticks = (nowSeconds + WIN_EPOCH) * TICKS_PER_SECOND;
  ticks -= ticks % TOKEN_ROUNDING;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${ticks}${TRUSTED_CLIENT_TOKEN}`)
  );
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
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
          outputFormat: "audio-24khz-48kbitrate-mono-mp3",
        },
      },
    },
  });
  return `X-Timestamp:${tsHeader()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n${body}`;
}

const escapeXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
   .replace(/'/g, "&apos;").replace(/"/g, "&quot;");

function ssmlFrame(text: string, voice: string): string {
  const ssml =
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>` +
    `<voice name='${voice}'><prosody pitch='+0Hz' rate='+2%' volume='+0%'>${escapeXml(text)}</prosody></voice>` +
    `</speak>`;
  return `X-RequestId:${hex32()}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${tsHeader()}\r\nPath:ssml\r\n\r\n${ssml}`;
}

function parseFrameHeaders(raw: string): { headers: Record<string, string>; body: string } {
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
  offset: number;   // seconds from start of the audio file
  duration: number; // seconds
}

function synthesizeSpeech(
  text: string,
  voice: string
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
      try { ws?.close(); } catch { /* noop */ }
      if (err) {
        reject(err);
        return;
      }
      const total = chunks.reduce((n, c) => n + c.length, 0);
      const audio = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) { audio.set(c, off); off += c.length; }
      resolve({ audio, words });
    };

    (async () => {
      const gec = await generateSecMsGec();
      ws = new WebSocket(wssUrl(gec, hex32()));
      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        ws.send(speechConfigFrame());
        ws.send(ssmlFrame(text, voice));
      };
      ws.onerror = () => finish(new Error("TTS websocket error"));
      ws.onclose = (ev) => {
        if (settled) return;
        if (chunks.length > 0) finish();         // server dropped after streaming — use what we have
        else finish(new Error(`TTS socket closed early (code ${ev.code})`));
      };
      ws.onmessage = (ev) => {
        try {
          if (typeof ev.data === "string") {
            const { headers, body } = parseFrameHeaders(ev.data);
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
        } catch { /* a malformed frame must not kill the render */ }
      };
    })().catch((e) => finish(e instanceof Error ? e : new Error(String(e))));
  });
}

/* ------------------------------------------------------------------ */
/*  captions — group word boundaries into 2–4 word cues                 */
/* ------------------------------------------------------------------ */

interface Cue {
  text: string;
  start: number;
  end: number;
}

function buildCues(words: WordTs[], maxEnd: number): Cue[] {
  const usable = words.filter((w) => w.text && w.offset < maxEnd);
  if (!usable.length) return [];
  const groups: WordTs[][] = [];
  for (let i = 0; i < usable.length; i += 3) groups.push(usable.slice(i, i + 3));
  /* a trailing single word merges into the previous group → every cue has 2–4 words */
  if (groups.length > 1 && groups[groups.length - 1].length === 1) {
    const last = groups.pop()!;
    groups[groups.length - 1].push(...last);
  }
  return groups.map((g) => ({
    text: g.map((w) => w.text).join(" "),
    start: g[0].offset,
    end: Math.min(g[g.length - 1].offset + g[g.length - 1].duration, maxEnd),
  }));
}

/* ------------------------------------------------------------------ */
/*  3. RENDER — Shotstack timeline                                      */
/* ------------------------------------------------------------------ */

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

function captionClip(cue: Cue) {
  return {
    asset: {
      type: "html",
      html: `<div class="root"><p>${escapeXml(cue.text)}</p></div>`,
      css:
        ".root{box-sizing:border-box;width:100%;height:100%;display:flex;flex-direction:column;" +
        "align-items:center;justify-content:flex-start;padding:1150px 90px 0}" +
        "p{margin:0;font-family:'Arial Black',Arial,Helvetica,sans-serif;font-weight:900;font-size:76px;" +
        "line-height:1.12;color:#ffffff;text-align:center;text-transform:uppercase;letter-spacing:0.5px;" +
        "-webkit-text-stroke:5px #000000;paint-order:stroke fill;" +
        "text-shadow:-5px -5px 0 #000,5px -5px 0 #000,-5px 5px 0 #000,5px 5px 0 #000,0 10px 30px rgba(0,0,0,.75)}",
      width: 1080,   /* matches hd 9:16 output → ~60% vertical placement via padding-top */
      height: 1920,
    },
    start: r3(cue.start),
    length: r3(Math.max(0.4, cue.end - cue.start)),
  };
}

function buildEdit(opts: {
  bgUrl: string;
  voiceUrl: string;
  musicUrl?: string;
  duration: number;
  cues: Cue[];
}) {
  const { bgUrl, voiceUrl, musicUrl, duration, cues } = opts;
  const LOOP = 8;

  /* loop the trim-heavy background until it covers the voiceover */
  const videoClips: Record<string, unknown>[] = [];
  let t = 0;
  let trim = r2(Math.random() * 4);
  while (t < duration - 0.05) {
    const len = Math.min(LOOP, duration - t);
    videoClips.push({
      asset: { type: "video", src: bgUrl, volume: 0, trim },
      start: r2(t),
      length: r2(len),
      fit: "crop",
    });
    t += len;
    trim = 0;
  }

  return {
    timeline: {
      background: "#000000",
      ...(musicUrl
        ? { soundtrack: { src: musicUrl, effect: "fadeOut", volume: MUSIC_VOLUME } }
        : {}),
      tracks: [
        { clips: videoClips },
        {
          clips: [
            {
              asset: { type: "audio", src: voiceUrl, volume: 1 },
              start: 0,
              length: r2(duration),
            },
          ],
        },
        { clips: cues.map(captionClip) },
      ],
    },
    output: {
      format: "mp4",
      resolution: "hd",
      aspectRatio: "9:16",
      fps: 30,
      quality: "high",
    },
  };
}

async function submitShotstack(edit: unknown): Promise<string> {
  const res = await fetch(`${SHOTSTACK_BASE}/render`, {
    method: "POST",
    headers: { "x-api-key": SHOTSTACK_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(edit),
  });
  const data = await res.json().catch(() => ({}));
  const id = data?.response?.id;
  if (!res.ok || !id) {
    throw new Error(`Shotstack rejected (${res.status}): ${JSON.stringify(data).slice(0, 240)}`);
  }
  return id as string;
}

/* ------------------------------------------------------------------ */
/*  per-video pipeline                                                  */
/* ------------------------------------------------------------------ */

async function processVideo(job: {
  index: number;
  idea: string;
  backgroundPath: string;
  musicPath?: string;
  batchId: string;
  rowId: string;
}) {
  const { index, idea, backgroundPath, musicPath, batchId, rowId } = job;
  try {
    /* 1 — script (alternate providers across the 10 ideas) */
    await updateRender(rowId, { status: "script" });
    const story = await generateStory(idea, index % 2 === 0);
    await updateRender(rowId, { story_text: story.text });

    /* 2 — voice + word timings */
    await updateRender(rowId, { status: "voice" });
    const { audio, words } = await synthesizeSpeech(story.text, TTS_VOICE);
    if (audio.byteLength === 0) throw new Error("TTS returned no audio frames");
    const audioPath = `${batchId}/${String(index + 1).padStart(2, "0")}.mp3`;
    await uploadAudio(audioPath, audio);

    /* 3 — captions + render */
    const lastWord = words[words.length - 1];
    const rawDuration = lastWord ? lastWord.offset + lastWord.duration + 0.7 : 30;
    const duration = Math.min(Math.max(rawDuration, 4), MAX_VIDEO_SECONDS);
    const cues = buildCues(words, duration);

    await updateRender(rowId, { status: "rendering" });
    const edit = buildEdit({
      bgUrl: publicUrl("backgrounds", backgroundPath),
      voiceUrl: publicUrl("audio", audioPath),
      musicUrl: musicPath ? publicUrl("music", musicPath) : undefined,
      duration,
      cues,
    });
    const renderId = await submitShotstack(edit);
    await updateRender(rowId, { shotstack_render_id: renderId });
    console.log(`video ${index + 1} queued on Shotstack (${story.provider}) → ${renderId}`);
  } catch (e) {
    console.error(`video ${index + 1} failed`, e);
    await updateRender(rowId, {
      status: "error",
      error_message: String(e instanceof Error ? e.message : e).slice(0, 400),
    });
  }
}

const shuffle = <T,>(arr: T[]): T[] => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

/* ------------------------------------------------------------------ */
/*  handler                                                             */
/* ------------------------------------------------------------------ */

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);

  try {
    const body = await req.json();
    const batchId: string = body?.batch_id;
    const ideas: string[] = body?.ideas;
    const backgrounds: string[] = body?.background_paths;
    const musicPath: string | undefined = body?.music_path;

    if (!batchId || typeof batchId !== "string") {
      return json({ ok: false, error: "batch_id (uuid) is required" }, 400);
    }
    if (!Array.isArray(ideas) || ideas.length !== 10 || !ideas.every((i) => typeof i === "string" && i.trim().length > 2)) {
      return json({ ok: false, error: "exactly 10 non-empty ideas are required" }, 400);
    }
    if (!Array.isArray(backgrounds) || backgrounds.length !== 10) {
      return json({ ok: false, error: "exactly 10 background_paths are required" }, 400);
    }
    if (!SHOTSTACK_API_KEY) return json({ ok: false, error: "SHOTSTACK_API_KEY secret is not set" }, 500);
    if (!QWEN_API_KEY && !MISTRAL_API_KEY) {
      return json({ ok: false, error: "set QWEN_API_KEY and/or MISTRAL_API_KEY secrets" }, 500);
    }
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return json({ ok: false, error: "function is missing SUPABASE_URL / SERVICE_ROLE env" }, 500);
    }

    /* seed the 10 rows up-front so check-status has something to report */
    const rows = ideas.map((_, i) => ({ batch_id: batchId, idea_index: i, status: "script" }));
    const ins = await db("renders", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(rows),
    });
    if (!ins.ok) {
      return json({ ok: false, error: `renders insert failed: ${(await ins.text()).slice(0, 240)}` }, 500);
    }
    const inserted = (await ins.json()) as { id: string; idea_index: number }[];
    inserted.sort((a, b) => a.idea_index - b.idea_index);

    /* one background per story, shuffled — no repeats */
    const deal = shuffle([...backgrounds]);

    const work = async () => {
      const queue = inserted.map((row, i) => ({
        index: row.idea_index,
        idea: ideas[row.idea_index],
        backgroundPath: deal[i],
        musicPath,
        batchId,
        rowId: row.id,
      }));
      /* tiny worker pool of 3 — fast yet gentle on every upstream API */
      const POOL = 3;
      await Promise.all(
        Array.from({ length: Math.min(POOL, queue.length) }, async (_, w) => {
          if (w > 0) await new Promise((r) => setTimeout(r, w * 800));
          while (queue.length > 0) {
            const job = queue.shift()!;
            await processVideo(job);
          }
        })
      );
    };

    /* run in background; the frontend polls check-status */
    const pending = work();
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
      EdgeRuntime.waitUntil(pending);
    } else {
      await pending; // local or runtimes without waitUntil — respond when done
    }
    pending.catch((e) => console.error("background batch crashed", e));

    return json({ ok: true, batch_id: batchId, queued: inserted.length });
  } catch (e) {
    console.error("generate-batch crashed", e);
    return json({ ok: false, error: String(e instanceof Error ? e.message : e) }, 500);
  }
});

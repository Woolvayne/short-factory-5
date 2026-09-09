/**
 * Narration engine — Microsoft Edge Read Aloud (free, no API key).
 *
 * Browsers cannot open this WebSocket directly: every browser WebSocket
 * handshake automatically carries an Origin header, which Microsoft's
 * endpoint rejects. Supabase's Edge Function runtime proved unreliable for
 * outbound third-party WebSockets (invocations die with "EarlyDrop" after
 * ~10ms CPU). The synthesis therefore runs inside a Vercel Serverless
 * Function in the Node.js runtime (api/tts.js), which has no such
 * restriction, and this client simply POSTs to that same-origin endpoint.
 *
 * Same origin on the same Vercel deployment → no CORS, no apikey,
 * no Supabase anon key, no environment configuration needed at all.
 */

const TTS_ENDPOINT = "/api/tts";

export interface WordTs {
  text: string;
  offset: number;   // seconds from the start of the returned MP3
  duration: number; // seconds
}

export interface Cue {
  text: string;
  start: number;
  end: number;
}

export interface TtsResult {
  /** concatenated MP3 bytes */
  audio: ArrayBuffer;
  words: WordTs[];
  /** voice duration incl. tail padding, seconds */
  duration: number;
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export async function synthesizeSpeech(
  text: string,
  voice: string,
  rate = 0,
  pitch = 0
): Promise<TtsResult> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 75_000);
  try {
    const res = await fetch(TTS_ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice, rate, pitch }),
    });

    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.audioBase64) {
      throw new Error(
        typeof data?.error === "string"
          ? data.error
          : `TTS relay failed (HTTP ${res.status ?? "?"})`
      );
    }

    const audio = base64ToArrayBuffer(data.audioBase64 as string);
    if (audio.byteLength === 0) throw new Error("TTS relay returned no audio");

    const words: WordTs[] = (Array.isArray(data.words) ? data.words : []).map(
      (w: { text?: string; offset?: number; duration?: number }) => ({
        text: String(w?.text ?? ""),
        offset: Number(w?.offset ?? 0),
        duration: Number(w?.duration ?? 0),
      })
    );

    const last = words[words.length - 1];
    return {
      audio,
      words,
      duration: last ? last.offset + last.duration + 0.7 : 4,
    };
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new Error("TTS relay timed out after 75s");
    }
    throw e instanceof Error ? e : new Error(String(e));
  } finally {
    window.clearTimeout(timer);
  }
}

/** group word boundaries into caption cues of N words (default 3) */
export function buildCues(words: WordTs[], maxEnd: number, perCue = 3): Cue[] {
  const usable = words.filter((w) => w.text && w.offset < maxEnd);
  if (!usable.length) return [];
  const size = Math.max(1, Math.min(6, Math.round(perCue)));
  const groups: WordTs[][] = [];
  for (let i = 0; i < usable.length; i += size) groups.push(usable.slice(i, i + size));
  /* avoid a lonely trailing word when grouping 2+ */
  if (size > 1 && groups.length > 1 && groups[groups.length - 1].length === 1) {
    const last = groups.pop()!;
    groups[groups.length - 1].push(...last);
  }
  return groups.map((g) => ({
    text: g.map((w) => w.text).join(" "),
    start: g[0].offset,
    end: Math.min(g[g.length - 1].offset + g[g.length - 1].duration, maxEnd),
  }));
}

export const cueAt = (cues: Cue[], t: number): Cue | undefined =>
  cues.find((c) => t >= c.start - 0.04 && t < c.end + 0.12);

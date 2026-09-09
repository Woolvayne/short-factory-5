/**
 * Clip Mill — turn ONE long source video into 10 distinct background clips.
 *
 * Two legal, CORS-honest ways to feed it:
 *   a) pick a long video from this device (camera roll / Files)
 *   b) paste a DIRECT video URL (…/something.mp4) that sends CORS headers —
 *      your own hosting, an S3/R2 bucket, Pexels/Coverr/Mixkit downloads, etc.
 *
 * Platform page links (YouTube, TikTok, Instagram, …) are deliberately NOT
 * ripped: browsers cannot fetch those streams (no CORS, signed URLs), and
 * bypassing that protection would breach those platforms' terms and, for
 * material you don't own, copyright. We detect them and explain the legal
 * one-step workaround instead.
 */

import type { ClipMode, Settings } from "./settings";
import { uid } from "./media";

export interface ClipPlan {
  id: string;
  index: number;
  start: number;  // seconds into the source
  length: number; // planned seconds
}

export interface ClipSource {
  id: string;
  name: string;
  origin: "file" | "url";
  file?: File;
  url: string;      // object URL (file) or remote direct URL
  duration: number;
  width: number;
  height: number;
  size?: number;
  portrait: boolean;
}

export interface PlatformInfo {
  platform: string;
  note: string;
  steps: string[];
}

const PLATFORM_PATTERNS: { re: RegExp; platform: string }[] = [
  { re: /(youtube\.com|youtu\.be)/i, platform: "YouTube" },
  { re: /(tiktok\.com)/i, platform: "TikTok" },
  { re: /(instagram\.com)/i, platform: "Instagram" },
  { re: /(facebook\.com|fb\.watch)/i, platform: "Facebook" },
  { re: /(twitter\.com|x\.com)/i, platform: "X / Twitter" },
  { re: /(vimeo\.com)/i, platform: "Vimeo" },
  { re: /(twitch\.tv)/i, platform: "Twitch" },
];

/** Returns guidance if the URL is a platform *page* rather than a video file. */
export function detectPlatform(url: string): PlatformInfo | null {
  const hit = PLATFORM_PATTERNS.find((p) => p.re.test(url));
  if (!hit) return null;
  return {
    platform: hit.platform,
    note:
      `${hit.platform} links can't be fetched by a browser — the streams are signed and send no CORS ` +
      `headers, and working around that would breach ${hit.platform}'s terms (and copyright for material ` +
      `you don't own). Use a source you have the rights to instead:`,
    steps:
      hit.platform === "YouTube"
        ? [
            "Your own video? Download the original in YouTube Studio → Content → ⋮ → Download.",
            "Creative-Commons or licensed footage? Grab the file from the rights holder / stock site.",
            "Then drop that file into the picker on the left — it gets sliced into 10 clips automatically.",
            "Or paste a DIRECT .mp4 link (your own hosting, S3/R2, Pexels, Coverr, Mixkit).",
          ]
        : [
            `Export or download the file from ${hit.platform} only if it is yours or licensed to you.`,
            "Then drop that file into the picker on the left — it gets sliced into 10 clips automatically.",
            "Or paste a DIRECT .mp4 link that allows cross-origin requests.",
          ],
  };
}

export const looksLikeDirectVideo = (url: string) =>
  /\.(mp4|mov|m4v|webm|ogv)(\?|#|$)/i.test(url);

/** Probe any playable URL for dimensions + duration. */
export function probeUrl(
  url: string
): Promise<{ width: number; height: number; duration: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = "anonymous";
    const timer = window.setTimeout(
      () => reject(new Error("Timed out — the server may block cross-origin requests")),
      20000
    );
    video.onloadedmetadata = () => {
      window.clearTimeout(timer);
      resolve({
        width: video.videoWidth,
        height: video.videoHeight,
        duration: isFinite(video.duration) ? video.duration : 0,
      });
    };
    video.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error("Could not load that URL as a video (CORS or unsupported format)"));
    };
    video.src = url;
  });
}

/**
 * Fetch a remote direct video URL into a local blob so the canvas stays
 * untainted (required for MediaRecorder capture).
 */
export async function fetchRemoteVideo(
  url: string,
  onProgress?: (received: number, total: number) => void
): Promise<{ blob: Blob; name: string }> {
  const res = await fetch(url, { mode: "cors", credentials: "omit" });
  if (!res.ok) throw new Error(`HTTP ${res.status} — the host refused the download`);

  const total = Number(res.headers.get("content-length") ?? 0);
  const name = decodeURIComponent(url.split("/").pop()?.split("?")[0] || "source.mp4");

  if (!res.body || !total) {
    const blob = await res.blob();
    onProgress?.(blob.size, blob.size);
    return { blob, name };
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.length;
      onProgress?.(received, total);
    }
  }
  const blob = new Blob(chunks as BlobPart[], {
    type: res.headers.get("content-type") || "video/mp4",
  });
  return { blob, name };
}

/**
 * Slice a source into 10 non-overlapping-ish clip windows.
 *  · even       — spread evenly across the usable range (default, most varied)
 *  · random     — random start points, still inside the usable range
 *  · sequential — back-to-back from the first usable second
 */
export function planClips(
  source: ClipSource,
  settings: Settings,
  count = 10,
  targetLengths?: number[]
): ClipPlan[] {
  const skipIn = Math.max(0, settings.clipSkipIntro);
  const skipOut = Math.max(0, settings.clipSkipOutro);
  const usableStart = Math.min(skipIn, Math.max(0, source.duration - 2));
  const usableEnd = Math.max(usableStart + 1, source.duration - skipOut);
  const usable = Math.max(1, usableEnd - usableStart);

  const lengthFor = (i: number) => {
    if (settings.clipLengthMode === "fixed") return Math.max(3, settings.clipFixedLength);
    const t = targetLengths?.[i];
    return Math.max(3, t && isFinite(t) ? t : 35);
  };

  const mode: ClipMode = settings.clipMode;
  const plans: ClipPlan[] = [];

  for (let i = 0; i < count; i++) {
    const len = lengthFor(i);
    let start: number;

    if (mode === "sequential") {
      start = usableStart + (i * usable) / count;
    } else if (mode === "random") {
      const room = Math.max(0, usable - Math.min(len, usable));
      start = usableStart + Math.random() * room;
    } else {
      /* even: centre each slot, nudge slightly so repeats never line up */
      const slot = usable / count;
      const jitter = slot > 2 ? (Math.random() - 0.5) * slot * 0.35 : 0;
      start = usableStart + i * slot + jitter;
    }

    start = Math.min(Math.max(usableStart, start), Math.max(usableStart, usableEnd - 0.5));
    plans.push({ id: uid(), index: i, start, length: len });
  }

  return plans;
}

export function rerollClip(
  plan: ClipPlan,
  source: ClipSource,
  settings: Settings
): ClipPlan {
  const skipIn = Math.max(0, settings.clipSkipIntro);
  const skipOut = Math.max(0, settings.clipSkipOutro);
  const usableStart = Math.min(skipIn, Math.max(0, source.duration - 2));
  const usableEnd = Math.max(usableStart + 1, source.duration - skipOut);
  const room = Math.max(0, usableEnd - usableStart - 0.5);
  return { ...plan, id: uid(), start: usableStart + Math.random() * room };
}

export const timecode = (s: number) => {
  const total = Math.max(0, Math.floor(s));
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
};

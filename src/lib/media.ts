/** Media probing + formatting helpers — all local, all Safari-safe. */

import { snapFrameRate } from "./quality";

export interface VideoProbe {
  width: number;
  height: number;
  duration: number;
  /** measured frame rate of the source, `null` when the browser can't tell */
  fps: number | null;
}

function probeVideoMeta(file: File): Promise<{ width: number; height: number; duration: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const objectUrl = URL.createObjectURL(file);
    const timer = window.setTimeout(() => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Timed out reading video metadata"));
    }, 10000);
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.onloadedmetadata = () => {
      window.clearTimeout(timer);
      const meta = {
        width: video.videoWidth,
        height: video.videoHeight,
        duration: isFinite(video.duration) ? video.duration : 0,
      };
      URL.revokeObjectURL(objectUrl);
      resolve(meta);
    };
    video.onerror = () => {
      window.clearTimeout(timer);
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Unreadable video file"));
    };
    video.src = objectUrl;
  });
}

/**
 * Reads width/height/duration — and, on request, the real frame rate.
 *
 * The FPS pass costs about a second of playback (the browser exposes no frame
 * rate in metadata, so the only honest way is to watch the decoder present
 * frames). It is deliberately measured once per source, never per render.
 */
export async function probeVideo(
  file: File,
  opts: { measureFps?: boolean } = {}
): Promise<VideoProbe> {
  const meta = await probeVideoMeta(file);
  if (!opts.measureFps) return { ...meta, fps: null };
  const fps = await measureVideoFps(file);
  return { ...meta, fps };
}

/* ------------------------------------------------------------------ */
/*  Frame-rate probe                                                   */
/* ------------------------------------------------------------------ */

type VideoFrameMeta = { mediaTime: number; presentedFrames: number; duration: number };

type FrameClockVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: VideoFrameMeta) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
  getVideoPlaybackQuality?: () => { totalVideoFrames: number; droppedVideoFrames: number };
};

/**
 * Counts presented frames over a short window and converts that into a frame
 * rate. Uses `requestVideoFrameCallback` (Chromium, Safari 15+, WebKit) because
 * its `mediaTime` is the media clock — immune to a busy main thread — and falls
 * back to `getVideoPlaybackQuality`. Firefox has neither, so it gets `null`,
 * which downstream simply means "no automatic quality boost, still 60 FPS out".
 */
export function measureVideoFps(
  source: File | Blob | string,
  opts: { windowMs?: number; timeoutMs?: number } = {}
): Promise<number | null> {
  const windowMs = Math.max(250, opts.windowMs ?? 850);
  const timeoutMs = Math.max(1500, opts.timeoutMs ?? 7000);

  return new Promise((resolve) => {
    if (typeof document === "undefined" || !document.body) {
      resolve(null);
      return;
    }

    const ownsUrl = typeof source !== "string";
    const url = ownsUrl ? URL.createObjectURL(source) : source;
    const video = document.createElement("video") as FrameClockVideo;

    let settled = false;
    let rvfcHandle = 0;
    let guard = 0;

    const finish = (raw: number | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(guard);
      if (rvfcHandle && video.cancelVideoFrameCallback) {
        try {
          video.cancelVideoFrameCallback(rvfcHandle);
        } catch {
          /* noop */
        }
      }
      try {
        video.pause();
      } catch {
        /* noop */
      }
      video.removeAttribute("src");
      try {
        video.load();
      } catch {
        /* noop */
      }
      video.remove();
      if (ownsUrl) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          /* noop */
        }
      }
      resolve(raw === null ? null : snapFrameRate(raw));
    };

    guard = window.setTimeout(() => finish(null), timeoutMs);

    video.preload = "auto";
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    /* off-screen but really rendered — display:none / detached elements stop
       presenting frames, which would read as 0 fps */
    video.style.cssText =
      "position:fixed;left:-10000px;top:0;width:180px;height:320px;opacity:0.01;pointer-events:none;object-fit:cover";
    document.body.appendChild(video);
    video.onerror = () => finish(null);

    const sample = () => {
      video.playbackRate = 1;
      void video.play().catch(() => finish(null)); // autoplay refused → unknown

      if (typeof video.requestVideoFrameCallback === "function") {
        let frames = 0;
        let firstMedia = -1;
        let lastMedia = 0;
        const t0 = performance.now();
        const onFrame = (_now: number, meta: VideoFrameMeta) => {
          if (settled) return;
          frames += 1;
          const mt = Number.isFinite(meta?.mediaTime) ? meta.mediaTime : 0;
          if (firstMedia < 0) firstMedia = mt;
          else lastMedia = mt;
          const mediaSpan = lastMedia - firstMedia;
          const wallSpan = (performance.now() - t0) / 1000;
          if (frames >= 5 && (mediaSpan >= windowMs / 1000 || wallSpan >= windowMs / 1000)) {
            const span = mediaSpan > 0.08 ? mediaSpan : wallSpan;
            finish(span > 0 ? (frames - 1) / span : null);
            return;
          }
          rvfcHandle = video.requestVideoFrameCallback!(onFrame);
        };
        rvfcHandle = video.requestVideoFrameCallback!(onFrame);
        return;
      }

      if (typeof video.getVideoPlaybackQuality === "function") {
        const start = video.getVideoPlaybackQuality!().totalVideoFrames;
        window.setTimeout(() => {
          const end = video.getVideoPlaybackQuality!().totalVideoFrames;
          const dt = windowMs / 1000;
          finish(end > start ? (end - start) / dt : null);
        }, windowMs);
        return;
      }

      finish(null);
    };

    const start = () => {
      const dur = isFinite(video.duration) ? video.duration : 0;
      if (dur > 4) {
        /* skip the head — black leader frames would read as a stalled decode */
        const onSeeked = () => {
          video.removeEventListener("seeked", onSeeked);
          window.setTimeout(sample, 140);
        };
        video.addEventListener("seeked", onSeeked);
        video.currentTime = Math.min(dur * 0.25, Math.max(0, dur - 2));
      } else {
        window.setTimeout(sample, 220);
      }
    };

    if (video.readyState >= 1) start();
    else video.onloadedmetadata = start;
    video.src = url;
  });
}

export function probeAudio(file: File): Promise<number> {
  return new Promise((resolve) => {
    const audio = document.createElement("audio");
    const objectUrl = URL.createObjectURL(file);
    const timer = window.setTimeout(() => {
      URL.revokeObjectURL(objectUrl);
      resolve(0);
    }, 8000);
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      window.clearTimeout(timer);
      const d = audio.duration;
      URL.revokeObjectURL(objectUrl);
      resolve(isFinite(d) ? d : 0);
    };
    audio.onerror = () => {
      window.clearTimeout(timer);
      URL.revokeObjectURL(objectUrl);
      resolve(0);
    };
    audio.src = objectUrl;
  });
}

export const isPortrait916 = (w: number, h: number) =>
  w > 0 && h > 0 && Math.abs(w / h - 9 / 16) < 0.03;

export function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDuration(s: number): string {
  if (!isFinite(s) || s <= 0) return "—";
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return m > 0 ? `${m}:${String(sec).padStart(2, "0")}` : `0:${String(sec).padStart(2, "0")}`;
}

export const formatClock = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

export const uid = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const shuffle = <T,>(arr: T[]): T[] => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

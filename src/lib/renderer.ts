/**
 * Local renderer — composites background clip + neural voice + quiet music
 * + word-synced captions onto a 9:16 canvas, captures it with MediaRecorder,
 * then re-encodes with ffmpeg.wasm to force a genuinely constant frame rate
 * (see cfr.ts) before handing back the final file. No server, no cloud —
 * everything runs in the browser. Safari-first (prefers MP4).
 */

import { buildCues, cueAt, type Cue, type WordTs } from "./tts";
import type { Settings } from "./settings";
import { resolveBitrate, resolveCaptionLook } from "./settings";
import { forceConstantFrameRate } from "./cfr";

export interface RenderJobOptions {
  /** object URL of the background source (file blob or fetched remote blob) */
  bgUrl: string;
  /** where inside the source this clip begins, in seconds */
  clipStart: number;
  /** story title shown on the opening "fake post" hook card, if any */
  introTitle?: string;
  voiceMp3: ArrayBuffer;
  words: WordTs[];
  musicFile?: File | null;
  width: number;
  height: number;
  audioCtx: AudioContext;
  settings: Settings;
  onProgress?: (ratio: number) => void;
  signal?: { cancelled: boolean };
}

export interface LocalRenderResult {
  blob: Blob;
  mimeType: string;
  duration: number;
}

const MIME_CANDIDATES = [
  'video/mp4;codecs="avc1.42E028,mp4a.40.2"',
  'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
  "video/mp4;codecs=avc1,mp4a",
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

export function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
}

export const recorderSupported = () => pickMimeType() !== "";

function drawCaption(
  ctx: CanvasRenderingContext2D,
  text: string,
  w: number,
  h: number,
  s: Settings
): void {
  const look = resolveCaptionLook(s);
  const fs = Math.round(w * look.scale);
  ctx.font = `900 ${fs}px "Arial Black", Arial, Helvetica, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const maxW = w * 0.85;
  const words = (look.uppercase ? text.toUpperCase() : text).split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    const test = cur ? `${cur} ${word}` : word;
    if (cur && ctx.measureText(test).width > maxW) {
      lines.push(cur);
      cur = word;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);

  const lineH = fs * 1.18;
  const centerY = h * look.y;
  const total = (lines.length - 1) * lineH;

  ctx.lineJoin = "round";
  ctx.miterLimit = 2;

  if (look.shadow) {
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = fs * 0.4;
    ctx.shadowOffsetY = Math.round(fs * 0.07);
  }

  const stroke = Math.round(fs * look.outlineWidth);
  lines.forEach((ln, i) => {
    const y = centerY - total / 2 + i * lineH;

    /* "highlight" style paints a rounded plate behind each line */
    if (look.highlight) {
      const tw = ctx.measureText(ln).width;
      const padX = fs * 0.28;
      const padY = fs * 0.2;
      ctx.save();
      ctx.shadowColor = "transparent";
      ctx.fillStyle = s.captionColor === "#ffffff" ? "rgba(239,48,36,0.92)" : s.captionColor;
      const rx = w / 2 - tw / 2 - padX;
      const ry = y - lineH / 2 - padY / 2;
      const rw = tw + padX * 2;
      const rh = lineH + padY;
      const r = Math.min(fs * 0.22, rh / 2);
      ctx.beginPath();
      ctx.moveTo(rx + r, ry);
      ctx.arcTo(rx + rw, ry, rx + rw, ry + rh, r);
      ctx.arcTo(rx + rw, ry + rh, rx, ry + rh, r);
      ctx.arcTo(rx, ry + rh, rx, ry, r);
      ctx.arcTo(rx, ry, rx + rw, ry, r);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    if (stroke > 0) {
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = stroke;
      ctx.strokeText(ln, w / 2, y);
    }
    ctx.fillStyle = look.highlight ? "#ffffff" : look.color;
    ctx.fillText(ln, w / 2, y);
  });

  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

/** Default duration the opening "fake social post" hook card is shown, in seconds. */
const DEFAULT_INTRO_DURATION = 1;

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/**
 * Draws the opening hook card: a mocked-up social post (avatar, handle,
 * timestamp, bold title, like/comment/share row) floating as a white
 * rounded card *on top of* the already-playing background footage — the
 * classic "storytime" TikTok/Reels opener that stops the scroll before
 * the viewer even registers the video has started.
 */
function drawIntroOverlay(ctx: CanvasRenderingContext2D, title: string, w: number, h: number): void {
  const marginX = w * 0.065;
  const cardW = w - marginX * 2;
  const pad = cardW * 0.06;
  const avatarR = cardW * 0.052;

  /* ---- wrap the title first so we know how tall the card needs to be */
  const titleFs = Math.round(cardW * 0.072);
  ctx.font = `800 ${titleFs}px Arial, Helvetica, sans-serif`;
  const maxTextW = cardW - pad * 2;
  const clean = (title || "").trim() || "Storytime";
  const words = clean.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    const test = cur ? `${cur} ${word}` : word;
    if (cur && ctx.measureText(test).width > maxTextW) {
      lines.push(cur);
      cur = word;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  const cappedLines = lines.slice(0, 3);
  if (lines.length > 3) {
    let last = cappedLines[2];
    while (last.length > 3 && ctx.measureText(last + "…").width > maxTextW) {
      last = last.slice(0, -1);
    }
    cappedLines[2] = last.replace(/\s+$/, "") + "…";
  }
  const titleLineH = titleFs * 1.3;

  const headerH = avatarR * 2;
  const gapAfterHeader = cardW * 0.05;
  const titleBlockH = cappedLines.length * titleLineH;
  const gapAfterTitle = cardW * 0.04;
  const dividerGap = cardW * 0.035;
  const iconRowH = cardW * 0.07;

  const cardH = pad + headerH + gapAfterHeader + titleBlockH + gapAfterTitle + dividerGap + iconRowH + pad;
  const cardX = marginX;
  const cardY = h * 0.5 - cardH / 2;

  /* ---- card background: white rounded rect with a soft drop shadow */
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.28)";
  ctx.shadowBlur = cardW * 0.035;
  ctx.shadowOffsetY = cardW * 0.014;
  roundRectPath(ctx, cardX, cardY, cardW, cardH, cardW * 0.045);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.restore();

  const cx = cardX + pad;
  let cy = cardY + pad;

  /* ---- avatar: pink → orange gradient circle */
  const avatarCx = cx + avatarR;
  const avatarCy = cy + avatarR;
  const grad = ctx.createLinearGradient(
    avatarCx - avatarR,
    avatarCy - avatarR,
    avatarCx + avatarR,
    avatarCy + avatarR
  );
  grad.addColorStop(0, "#d6249f");
  grad.addColorStop(0.5, "#e2496a");
  grad.addColorStop(1, "#f79c42");
  ctx.beginPath();
  ctx.arc(avatarCx, avatarCy, avatarR, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();

  /* ---- handle + timestamp */
  const textX = avatarCx + avatarR + cardW * 0.03;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#000000";
  ctx.font = `700 ${Math.round(cardW * 0.046)}px Arial, Helvetica, sans-serif`;
  ctx.fillText("storyteller", textX, avatarCy - avatarR * 0.42);
  ctx.fillStyle = "#8e8e8e";
  ctx.font = `400 ${Math.round(cardW * 0.036)}px Arial, Helvetica, sans-serif`;
  ctx.fillText("just now", textX, avatarCy + avatarR * 0.5);

  cy += headerH + gapAfterHeader;

  /* ---- title: bold, left-aligned, up to 3 lines */
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#000000";
  ctx.font = `800 ${titleFs}px Arial, Helvetica, sans-serif`;
  cappedLines.forEach((ln, i) => {
    ctx.fillText(ln, cx, cy + titleLineH * i + titleLineH / 2);
  });
  cy += titleBlockH + gapAfterTitle;

  /* ---- divider */
  ctx.strokeStyle = "#ececec";
  ctx.lineWidth = Math.max(1, cardW * 0.0025);
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cardX + cardW - pad, cy);
  ctx.stroke();
  cy += dividerGap;

  /* ---- like / comment / share row */
  const iconSize = cardW * 0.062;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = "#000000";
  ctx.fillStyle = "#000000";
  ctx.lineWidth = Math.max(1.5, cardW * 0.006);
  const s = iconSize / 24;
  const iy = cy + iconRowH / 2;

  /* heart */
  let ix = cx;
  ctx.save();
  ctx.translate(ix, iy);
  ctx.beginPath();
  ctx.moveTo(0, 6 * s);
  ctx.bezierCurveTo(-2 * s, 2 * s, -8 * s, 2 * s, -8 * s, 8 * s);
  ctx.bezierCurveTo(-8 * s, 14 * s, -2 * s, 17 * s, 0, 20 * s);
  ctx.bezierCurveTo(2 * s, 17 * s, 8 * s, 14 * s, 8 * s, 8 * s);
  ctx.bezierCurveTo(8 * s, 2 * s, 2 * s, 2 * s, 0, 6 * s);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();

  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${Math.round(cardW * 0.038)}px Arial, Helvetica, sans-serif`;
  ctx.fillText("17,719", ix + iconSize * 1.05, iy + iconSize * 0.42);

  /* comment bubble */
  ix += iconSize * 3.7;
  ctx.save();
  ctx.translate(ix, iy);
  ctx.beginPath();
  ctx.ellipse(0, 8 * s, 9 * s, 8 * s, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-2 * s, 15 * s);
  ctx.lineTo(-5 * s, 20 * s);
  ctx.lineTo(1 * s, 15.5 * s);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.fillText("9,154", ix + iconSize * 1.05, iy + iconSize * 0.42);

  /* share (paper plane) */
  ix += iconSize * 3.7;
  ctx.save();
  ctx.translate(ix, iy - iconSize * 0.05);
  ctx.beginPath();
  ctx.moveTo(-9 * s, -2 * s);
  ctx.lineTo(10 * s, 8 * s);
  ctx.lineTo(-9 * s, 18 * s);
  ctx.lineTo(-4 * s, 8 * s);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();

  /* bookmark, top-right of the row */
  const bx = cardX + cardW - pad;
  ctx.save();
  ctx.translate(bx, iy - iconSize * 0.15);
  ctx.beginPath();
  ctx.moveTo(-7 * s, -2 * s);
  ctx.lineTo(7 * s, -2 * s);
  ctx.lineTo(7 * s, 20 * s);
  ctx.lineTo(0, 13 * s);
  ctx.lineTo(-7 * s, 20 * s);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  w: number,
  h: number,
  zoom: number,
  vignette: boolean
): void {
  const vw = video.videoWidth || 1;
  const vh = video.videoHeight || 1;
  const scale = Math.max(w / vw, h / vh) * zoom;
  const dw = vw * scale;
  const dh = vh * scale;
  ctx.drawImage(video, (w - dw) / 2, (h - dh) / 2, dw, dh);

  if (vignette) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "rgba(0,0,0,0.30)");
    g.addColorStop(0.18, "rgba(0,0,0,0)");
    g.addColorStop(0.76, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.38)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
}

export async function renderLocal(opts: RenderJobOptions): Promise<LocalRenderResult> {
  const { width: w, height: h, audioCtx: ac, settings: s } = opts;

  const mimeType = pickMimeType();
  if (!mimeType) {
    throw new Error(
      "MediaRecorder is unavailable — use iOS/iPadOS 17+, or a current Chrome/Edge/Firefox."
    );
  }

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Canvas 2D is unavailable");

  /* ---- background element (hidden but attached — iOS needs it in the DOM) */
  const video = document.createElement("video");
  video.src = opts.bgUrl;
  video.muted = !(s.originalAudio > 0);
  video.loop = false;
  video.playsInline = true;
  video.preload = "auto";
  video.crossOrigin = "anonymous";
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  video.style.cssText =
    "position:fixed;left:-9999px;top:0;width:4px;height:4px;opacity:0;pointer-events:none";
  document.body.appendChild(video);

  const cleanup = () => {
    try {
      video.pause();
    } catch { /* noop */ }
    video.removeAttribute("src");
    try {
      video.load();
    } catch { /* noop */ }
    video.remove();
  };

  try {
    await new Promise<void>((res, rej) => {
      const t = window.setTimeout(() => rej(new Error("background clip failed to load")), 20000);
      video.oncanplay = () => {
        window.clearTimeout(t);
        res();
      };
      video.onerror = () => {
        window.clearTimeout(t);
        rej(new Error("background clip failed to decode"));
      };
      video.load();
    });

    /* ---- audio graph */
    if (ac.state !== "running") {
      try {
        await ac.resume();
      } catch { /* best effort */ }
    }
    const voiceBuf = await ac.decodeAudioData(opts.voiceMp3.slice(0));
    let musicBuf: AudioBuffer | null = null;
    if (opts.musicFile && s.musicVolume > 0 && s.musicEnabled !== false) {
      try {
        musicBuf = await ac.decodeAudioData(await opts.musicFile.arrayBuffer());
      } catch {
        musicBuf = null; /* unreadable soundtrack — render voice only */
      }
    }

    const duration = Math.max(voiceBuf.duration + Math.max(0, s.tailPadding), 3);
    const cues: Cue[] = s.captionsOn
      ? buildCues(opts.words, voiceBuf.duration + 0.4, s.wordsPerCue)
      : [];

    const dest = ac.createMediaStreamDestination();

    /* master bus lets the new master volume trim everything at once */
    const master = ac.createGain();
    master.gain.value = s.masterVolume ?? 1;
    master.connect(dest);

    const voiceSrc = ac.createBufferSource();
    voiceSrc.buffer = voiceBuf;
    const voiceGain = ac.createGain();
    voiceGain.gain.value = s.voiceVolume;
    voiceSrc.connect(voiceGain).connect(master);

    /* optional: mix in the background clip's own audio */
    let originalNode: MediaElementAudioSourceNode | null = null;
    if ((s.originalAudio ?? 0) > 0) {
      try {
        originalNode = ac.createMediaElementSource(video);
        const origGain = ac.createGain();
        origGain.gain.value = s.originalAudio;
        originalNode.connect(origGain).connect(master);
      } catch {
        /* element already routed — ignore and keep it muted */
      }
    }

    let musicSrc: AudioBufferSourceNode | null = null;
    let musicGain: GainNode | null = null;
    if (musicBuf) {
      musicSrc = ac.createBufferSource();
      musicSrc.buffer = musicBuf;
      musicSrc.loop = true;
      musicGain = ac.createGain();
      musicGain.gain.value = s.musicVolume;
      musicSrc.connect(musicGain).connect(master);
    }

    /* ---- recorder */
    /* Fest auf 60 verdrahtet — nicht aus s.fps gelesen, damit auch bereits im
       Browser gespeicherte, ältere Settings (z.B. fps: 30 aus einem alten
       localStorage-Stand) niemals eine andere Framerate erzwingen können. */
    const fps = 60;
    const canvasStream = canvas.captureStream(fps);
    const mixed = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...dest.stream.getAudioTracks(),
    ]);
    const recorder = new MediaRecorder(mixed, {
      mimeType,
      videoBitsPerSecond: resolveBitrate(s.bitrate, w),
      audioBitsPerSecond: 128_000,
    });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    const stopped = new Promise<void>((res) => {
      recorder.onstop = () => res();
    });

    /* ---- clip window inside the source */
    const srcDuration = isFinite(video.duration) && video.duration > 0 ? video.duration : duration;
    const segStart = Math.max(0, Math.min(opts.clipStart, Math.max(0, srcDuration - 0.4)));
    const segEnd = srcDuration;

    await new Promise<void>((res) => {
      const done = () => {
        video.removeEventListener("seeked", done);
        res();
      };
      video.addEventListener("seeked", done);
      video.currentTime = segStart;
      window.setTimeout(done, 3000);
    });

    /* ---- run */
    const startAt = ac.currentTime + 0.25;
    const endAt = startAt + duration;

    const introDuration = Math.min(
      Math.max(0, s.introDurationSec ?? DEFAULT_INTRO_DURATION),
      duration * 0.4
    );
    const drawFrame = () => {
      const t = Math.max(0, ac.currentTime - startAt);
      const zoom = s.zoomEffect ? 1 + 0.06 * Math.min(1, t / Math.max(1, duration)) : 1;
      if (video.readyState >= 2) drawCover(ctx, video, w, h, zoom, s.vignette);
      else {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, w, h);
      }
      if (t < introDuration) {
        drawIntroOverlay(ctx, opts.introTitle || "", w, h);
        return;
      }
      if (s.captionsOn) {
        const cue = cueAt(cues, t);
        if (cue) drawCaption(ctx, cue.text, w, h, s);
      }
    };

    let raf = 0;
    const loop = () => {
      /* keep the playhead inside the clip window */
      if (video.currentTime >= segEnd - 0.06 || video.ended) {
        try {
          video.currentTime = segStart;
          void video.play();
        } catch { /* noop */ }
      }
      drawFrame();
      if (ac.currentTime < endAt + 0.1) raf = requestAnimationFrame(loop);
    };

    try {
      await video.play();
    } catch {
      /* muted + playsinline should be allowed; continue regardless */
    }

    voiceSrc.start(startAt);
    if (musicSrc && musicGain) {
      /* music start point: beginning · after intro · random · custom offset */
      const musicLen = musicBuf?.duration ?? 0;
      let offset = 0;
      if (s.musicStartMode === "afterIntro") offset = Math.min(4, Math.max(0, musicLen - 1));
      else if (s.musicStartMode === "random") offset = musicLen > 2 ? Math.random() * (musicLen - 1) : 0;
      else if (s.musicStartMode === "custom")
        offset = Math.min(Math.max(0, s.musicStartOffset ?? 0), Math.max(0, musicLen - 0.5));

      musicSrc.start(startAt, offset);

      /* sidechain ducking: drop the bed while the narrator speaks */
      if (s.duckingEnabled) {
        const base = s.musicVolume;
        const ducked = Math.max(0.0001, base * (1 - Math.min(0.95, s.duckingAmount ?? 0.6)));
        const ramp = Math.max(0.05, s.duckingSpeed ?? 0.35);
        const speechEnd = startAt + voiceBuf.duration;
        musicGain.gain.setValueAtTime(base, startAt);
        musicGain.gain.linearRampToValueAtTime(ducked, startAt + ramp);
        musicGain.gain.setValueAtTime(ducked, Math.max(startAt + ramp, speechEnd));
        musicGain.gain.linearRampToValueAtTime(base, speechEnd + ramp);
      }

      /* tail: fade out or hard-stop with the video */
      const fadeLen = Math.max(0.2, s.musicFadeOutLength ?? 1.4);
      const wantsFade = s.musicEndMode ? s.musicEndMode === "fadeOut" : s.musicFade;
      if (wantsFade) {
        const fadeStart = Math.max(startAt, endAt - fadeLen);
        musicGain.gain.setValueAtTime(musicGain.gain.value, fadeStart);
        musicGain.gain.linearRampToValueAtTime(0.0001, endAt);
      }
    }
    recorder.start(250);
    raf = requestAnimationFrame(loop);

    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    while (ac.currentTime < endAt) {
      if (opts.signal?.cancelled) break;
      opts.onProgress?.(Math.min(1, (ac.currentTime - startAt) / duration));
      await sleep(120);
    }

    cancelAnimationFrame(raf);
    drawFrame();
    recorder.stop();
    await stopped;
    opts.onProgress?.(1);

    try {
      voiceSrc.stop();
    } catch { /* already ended */ }
    try {
      musicSrc?.stop();
    } catch { /* noop */ }

    const rawBlob = new Blob(chunks, { type: mimeType.split(";")[0] || "video/mp4" });
    if (rawBlob.size === 0) throw new Error("recorder produced an empty file");
    /* CRASH-FIX: drop the per-chunk references before the heavy ffmpeg.wasm
       pass — rawBlob keeps the data alive, but the pinned chunk array would
       otherwise hold a second full copy of the capture in memory exactly at
       the pipeline's memory peak (batch renders on iOS/Safari). */
    chunks.length = 0;

    /* The browser's own capture timing can never be perfectly even (see
       cfr.ts for why) — re-encode with ffmpeg.wasm to force a genuinely
       constant frame rate before this file goes anywhere near an upload. */
    opts.onProgress?.(0.92);
    let finalBlob = rawBlob;
    let finalMime = rawBlob.type || mimeType;
    try {
      finalBlob = await forceConstantFrameRate(rawBlob, Math.round(fps), (p) =>
        opts.onProgress?.(0.92 + p * 0.08)
      );
      finalMime = "video/mp4";
    } catch (e) {
      /* If the CFR pass itself fails for some reason (e.g. ffmpeg-core
         failed to load), fall back to the raw capture rather than losing
         the render entirely — better a possibly-VFR file than none. */
      console.warn("CFR re-encode failed, using raw capture instead:", e);
    }

    opts.onProgress?.(1);
    return { blob: finalBlob, mimeType: finalMime, duration };
  } finally {
    cleanup();
  }
}

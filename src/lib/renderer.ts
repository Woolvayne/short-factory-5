/**
 * Local renderer — composites background clip + neural voice + quiet music
 * + word-synced captions onto a 9:16 canvas. No server, no ffmpeg, no cloud.
 *
 * Primary path: WebCodecs via Mediabunny, with every frame given an exact,
 * evenly spaced synthetic timestamp (frameIndex / fps) and the full audio
 * track pre-rendered deterministically via OfflineAudioContext. This
 * guarantees a genuinely constant frame rate and correct total duration in
 * the output file regardless of real-time drawing/scheduling jitter — the
 * previous MediaRecorder + captureStream() approach timestamped frames by
 * real wall-clock capture time, which under load (slow devices, backgrounded
 * tabs, long batch runs) produced variable/out-of-range frame rates that
 * TikTok's ingestion rejects.
 *
 * Fallback path: the classic MediaRecorder + captureStream() pipeline is
 * kept only for the "mix in the original clip's own audio" feature, which
 * needs a live MediaElementAudioSourceNode and can't be pre-rendered
 * offline the same way.
 */

import { buildCues, cueAt, type Cue, type WordTs } from "./tts";
import type { Settings } from "./settings";
import { resolveBitrate, resolveCaptionLook } from "./settings";
import { Output, Mp4OutputFormat, BufferTarget, CanvasSource, AudioBufferSource } from "mediabunny";

export interface RenderJobOptions {
  /** object URL of the background source (file blob or fetched remote blob) */
  bgUrl: string;
  /** where inside the source this clip begins, in seconds */
  clipStart: number;
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

export const webCodecsSupported = () =>
  typeof VideoEncoder !== "undefined" && typeof AudioEncoder !== "undefined";

/** True if either rendering path (WebCodecs primary, MediaRecorder fallback) is usable. */
export const recorderSupported = () => webCodecsSupported() || pickMimeType() !== "";

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
  /* Mixing in the background clip's own audio needs a live
     MediaElementAudioSourceNode, which can't be pre-rendered offline the
     way voice/music buffers can — fall back to the classic real-time
     MediaRecorder pipeline for that one (opt-in, default-off) feature. */
  if ((opts.settings.originalAudio ?? 0) > 0 || !webCodecsSupported()) {
    return renderLocalRealtime(opts);
  }
  return renderLocalDeterministic(opts);
}

/**
 * Primary rendering path. Every video frame and the whole audio track carry
 * exact, pre-computed timestamps — nothing here depends on how fast or
 * evenly the browser actually manages to draw/schedule in real time, so the
 * output always has a genuinely constant frame rate and correct duration.
 */
async function renderLocalDeterministic(opts: RenderJobOptions): Promise<LocalRenderResult> {
  const { width: w, height: h, audioCtx: ac, settings: s } = opts;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Canvas 2D is unavailable");

  /* ---- background element (hidden but attached — iOS needs it in the DOM) */
  const video = document.createElement("video");
  video.src = opts.bgUrl;
  video.muted = true;
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

    /* ---- audio: rendered once, deterministically, via OfflineAudioContext.
       Same graph (voice + music + ducking + fades) as before, just scheduled
       from t=0 instead of the live AudioContext's real-time clock. This
       fully decouples the final audio timing — and therefore the file's
       total duration — from real-time playback jitter. */
    const sampleRate = ac.sampleRate;
    const offline = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate);

    const master = offline.createGain();
    master.gain.value = s.masterVolume ?? 1;
    master.connect(offline.destination);

    const voiceSrc = offline.createBufferSource();
    voiceSrc.buffer = voiceBuf;
    const voiceGain = offline.createGain();
    voiceGain.gain.value = s.voiceVolume;
    voiceSrc.connect(voiceGain).connect(master);
    voiceSrc.start(0);

    let musicGain: GainNode | null = null;
    if (musicBuf) {
      const musicSrc = offline.createBufferSource();
      musicSrc.buffer = musicBuf;
      musicSrc.loop = true;
      musicGain = offline.createGain();
      musicGain.gain.value = s.musicVolume;
      musicSrc.connect(musicGain).connect(master);

      /* music start point: beginning · after intro · random · custom offset */
      const musicLen = musicBuf.duration;
      let offset = 0;
      if (s.musicStartMode === "afterIntro") offset = Math.min(4, Math.max(0, musicLen - 1));
      else if (s.musicStartMode === "random") offset = musicLen > 2 ? Math.random() * (musicLen - 1) : 0;
      else if (s.musicStartMode === "custom")
        offset = Math.min(Math.max(0, s.musicStartOffset ?? 0), Math.max(0, musicLen - 0.5));
      musicSrc.start(0, offset);

      /* sidechain ducking: drop the bed while the narrator speaks */
      if (s.duckingEnabled) {
        const base = s.musicVolume;
        const ducked = Math.max(0.0001, base * (1 - Math.min(0.95, s.duckingAmount ?? 0.6)));
        const ramp = Math.max(0.05, s.duckingSpeed ?? 0.35);
        const speechEnd = voiceBuf.duration;
        musicGain.gain.setValueAtTime(base, 0);
        musicGain.gain.linearRampToValueAtTime(ducked, ramp);
        musicGain.gain.setValueAtTime(ducked, Math.max(ramp, speechEnd));
        musicGain.gain.linearRampToValueAtTime(base, speechEnd + ramp);
      }

      /* tail: fade out or hard-stop with the video */
      const fadeLen = Math.max(0.2, s.musicFadeOutLength ?? 1.4);
      const wantsFade = s.musicEndMode ? s.musicEndMode === "fadeOut" : s.musicFade;
      if (wantsFade) {
        const fadeStart = Math.max(0, duration - fadeLen);
        musicGain.gain.setValueAtTime(musicGain.gain.value, fadeStart);
        musicGain.gain.linearRampToValueAtTime(0.0001, duration);
      }
    }

    const renderedAudio = await offline.startRendering();

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

    /* ---- muxed output */
    const fps = Math.max(24, Math.min(60, Math.round(s.fps)));
    const frameDuration = 1 / fps;
    const totalFrames = Math.max(1, Math.round(duration * fps));

    const output = new Output({
      format: new Mp4OutputFormat(),
      target: new BufferTarget(),
    });
    const videoSource = new CanvasSource(canvas, {
      codec: "avc",
      bitrate: resolveBitrate(s.bitrate, w),
    });
    output.addVideoTrack(videoSource, { frameRate: fps });
    const audioSource = new AudioBufferSource({ codec: "aac", bitrate: 128_000 });
    output.addAudioTrack(audioSource);

    await output.start();
    await audioSource.add(renderedAudio);

    const drawFrame = (t: number) => {
      const zoom = s.zoomEffect ? 1 + 0.06 * Math.min(1, t / Math.max(1, duration)) : 1;
      if (video.readyState >= 2) drawCover(ctx, video, w, h, zoom, s.vignette);
      else {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, w, h);
      }
      if (s.captionsOn) {
        const cue = cueAt(cues, t);
        if (cue) drawCaption(ctx, cue.text, w, h, s);
      }
    };

    try {
      await video.play();
    } catch {
      /* muted + playsinline should be allowed; continue regardless */
    }

    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    /* Real-time-paced capture loop so the background video decodes at a
       natural rate — but every emitted frame gets an exact, evenly spaced
       *synthetic* timestamp (frameIndex * frameDuration), not the real
       capture time. A slow tick (main-thread jank, backgrounded tab, a
       big batch of renders back to back) just means we catch up on the
       next iteration; it can never desync the file's declared frame rate. */
    const startWall = performance.now();
    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
      if (opts.signal?.cancelled) break;

      if (video.currentTime >= segEnd - 0.06 || video.ended) {
        try {
          video.currentTime = segStart;
          void video.play();
        } catch { /* noop */ }
      }

      const t = frameIndex * frameDuration;
      drawFrame(t);
      await videoSource.add(t, frameDuration);
      opts.onProgress?.(Math.min(1, (frameIndex + 1) / totalFrames));

      const targetWall = startWall + (frameIndex + 1) * frameDuration * 1000;
      const waitMs = targetWall - performance.now();
      if (waitMs > 0) await sleep(waitMs);
    }

    await output.finalize();
    const buffer = output.target.buffer;
    if (!buffer || buffer.byteLength === 0) throw new Error("renderer produced an empty file");
    opts.onProgress?.(1);
    return { blob: new Blob([buffer], { type: "video/mp4" }), mimeType: "video/mp4", duration };
  } finally {
    cleanup();
  }
}

/**
 * Fallback path — only used when mixing in the background clip's own audio
 * (a live MediaElementAudioSourceNode can't be pre-rendered offline) or
 * when WebCodecs isn't available in the current browser. Frame timing here
 * still depends on real-time capture, so it remains more susceptible to
 * frame-rate irregularities under heavy load than the deterministic path.
 */
async function renderLocalRealtime(opts: RenderJobOptions): Promise<LocalRenderResult> {
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
    const fps = Math.max(24, Math.min(60, Math.round(s.fps)));
    /* `captureStream(fps)` sounds like it guarantees a constant frame rate,
       but it actually re-samples the canvas on the browser's own schedule
       (tied to the display refresh rate / rAF timing), which produces a
       *variable* frame rate container. TikTok's ingestion explicitly
       validates for a constant rate and rejects the result with "frame
       rate doesn't meet requirements" even when the nominal fps looks
       fine. Fix: capture in manual mode (`captureStream()` with no
       argument) and push exactly one frame per fixed-interval tick via
       `track.requestFrame()`, driven by a plain `setInterval` instead of
       `requestAnimationFrame` (which is throttled/variable across
       devices and display Hz). This yields evenly spaced frames and a
       properly constant frame rate in the recorded file. */
    const canvasStream = canvas.captureStream();
    const videoTrack = canvasStream.getVideoTracks()[0] as MediaStreamTrack & {
      requestFrame?: () => void;
    };
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

    const drawFrame = () => {
      const t = Math.max(0, ac.currentTime - startAt);
      const zoom = s.zoomEffect ? 1 + 0.06 * Math.min(1, t / Math.max(1, duration)) : 1;
      if (video.readyState >= 2) drawCover(ctx, video, w, h, zoom, s.vignette);
      else {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, w, h);
      }
      if (s.captionsOn) {
        const cue = cueAt(cues, t);
        if (cue) drawCaption(ctx, cue.text, w, h, s);
      }
    };

    let timer: number | undefined;
    const tick = () => {
      /* keep the playhead inside the clip window */
      if (video.currentTime >= segEnd - 0.06 || video.ended) {
        try {
          video.currentTime = segStart;
          void video.play();
        } catch { /* noop */ }
      }
      drawFrame();
      videoTrack.requestFrame?.();
      if (ac.currentTime >= endAt + 0.1 && timer !== undefined) {
        window.clearInterval(timer);
        timer = undefined;
      }
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
    tick(); // draw + capture the very first frame immediately
    timer = window.setInterval(tick, 1000 / fps);

    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    while (ac.currentTime < endAt) {
      if (opts.signal?.cancelled) break;
      opts.onProgress?.(Math.min(1, (ac.currentTime - startAt) / duration));
      await sleep(120);
    }

    if (timer !== undefined) window.clearInterval(timer);
    drawFrame();
    videoTrack.requestFrame?.();
    recorder.stop();
    await stopped;
    opts.onProgress?.(1);

    try {
      voiceSrc.stop();
    } catch { /* already ended */ }
    try {
      musicSrc?.stop();
    } catch { /* noop */ }

    const blob = new Blob(chunks, { type: mimeType.split(";")[0] || "video/mp4" });
    if (blob.size === 0) throw new Error("recorder produced an empty file");
    return { blob, mimeType: blob.type || mimeType, duration };
  } finally {
    cleanup();
  }
}

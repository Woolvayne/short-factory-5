/**
 * Frame-rate policy + automatic quality compensation.
 *
 * Two rules live here:
 *
 * 1. **Output is always exactly 60 FPS.** The renderer captures at 60, the
 *    CFR re-encode (cfr.ts) forces evenly spaced frames at 60, and the frame
 *    rate is no longer a user-facing choice — stored settings from older
 *    builds get normalised on load. TikTok/Instagram/YouTube all re-time
 *    variable-frame-rate uploads badly, so a fixed 60 is the safe delivery
 *    rate for this pipeline.
 *
 * 2. **If the uploaded source has too few frames, the render quietly gets
 *    better instead of worse.** A 24 fps clip blown up to a 60 fps file is
 *    mostly duplicated frames, which softens motion and exposes every
 *    compression artefact. So when the probe measures a source below
 *    `LOW_FPS_CEILING`, the render plan lifts the resolution by a step (and
 *    jumps straight to full HD on desktop), raises the bitrate one notch and
 *    asks the encoder for a sharper, lightly unsharpened pass. Phones keep one
 *    step less, because 1080p60 + a wasm re-encode on an iPhone is a good way
 *    to drop frames — which is exactly what we are trying to avoid.
 *
 * Frame-rate *measurement* is inherently approximate in a browser (there is no
 * metadata API for it), so everything below snaps the measurement to a
 * real-world rate and treats "unknown" as "no boost" rather than guessing.
 */

import {
  LOW_FPS_CEILING,
  TARGET_FPS,
  isCoarsePointer,
  resolveDimensions,
  type Bitrate,
  type Quality,
  type Settings,
} from "./settings";

export { LOW_FPS_CEILING, TARGET_FPS };

/** Frame rates that actually occur in the wild, for snapping a measurement. */
const STANDARD_FPS = [
  23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 90, 100, 120,
];

/**
 * Turns a noisy frame count into the nearest sensible frame rate. Returns
 * `null` for anything unusable so callers can distinguish "no idea" from
 * "definitely low frame rate".
 */
export function snapFrameRate(measured: number): number | null {
  if (!Number.isFinite(measured) || measured <= 0) return null;
  let best = STANDARD_FPS[0];
  let bestErr = Infinity;
  for (const f of STANDARD_FPS) {
    const err = Math.abs(measured - f);
    if (err < bestErr) {
      bestErr = err;
      best = f;
    }
  }
  /* close enough to a standard rate → snap; otherwise trust the raw count */
  if (bestErr / best < 0.1) return best;
  const rounded = Math.round(measured);
  return rounded > 0 && rounded < 240 ? rounded : null;
}

/** True when a source is known to carry fewer frames than we deliver. */
export const isLowFrameRate = (fps?: number | null): boolean =>
  typeof fps === "number" && Number.isFinite(fps) && fps > 0 && fps < LOW_FPS_CEILING;

export interface RenderPlan {
  /** settings with the boosted resolution/bitrate already applied */
  settings: Settings;
  /** whether the automatic quality boost kicked in for this source */
  boost: boolean;
  width: number;
  height: number;
  sourceFps: number | null;
  outputFps: number;
}

const nextQuality = (q: Quality, coarse: boolean): Quality => {
  if (q === "540") return "720";
  if (q === "auto") return coarse ? "720" : "1080";
  if (q === "720") return coarse ? "720" : "1080";
  return "1080";
};

const nextBitrate = (b: Bitrate): Bitrate => (b === "low" ? "med" : "high");

/**
 * Resolves how one unit should be rendered, given what the source footage
 * actually delivers. Always returns a 60 FPS plan.
 */
export function planRenderQuality(settings: Settings, sourceFps: number | null): RenderPlan {
  const boost = settings.fpsAutoBoost !== false && isLowFrameRate(sourceFps);

  if (!boost) {
    const { width, height } = resolveDimensions(settings.quality, settings.aspectRatio);
    return {
      settings,
      boost: false,
      width,
      height,
      sourceFps,
      outputFps: TARGET_FPS,
    };
  }

  const coarse = isCoarsePointer();
  const quality = nextQuality(settings.quality, coarse);
  const bitrate = nextBitrate(settings.bitrate);
  const next: Settings = { ...settings, quality, bitrate };
  const { width, height } = resolveDimensions(quality, settings.aspectRatio);

  return { settings: next, boost: true, width, height, sourceFps, outputFps: TARGET_FPS };
}

/** 23.976 → "23.98", 60 → "60". Keeps the UI free of float noise. */
export function sourceFpsLabel(fps: number): string {
  return Number.isInteger(fps) ? String(fps) : fps.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

/** Short human note about what the probe found, for the UI. */
export function frameRateNote(sourceFps: number | null, boost: boolean): string {
  if (sourceFps === null) return "FPS UNBEKANNT · 60 FPS ÜBER DUPLIKATE";
  if (boost) return `${sourceFpsLabel(sourceFps)} FPS QUELLE · AUTO-QUALITÄT AKTIV`;
  return `${sourceFpsLabel(sourceFps)} FPS QUELLE · PASSEND ZU 60 FPS`;
}

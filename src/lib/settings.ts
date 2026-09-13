/**
 * Machine settings — everything lives in localStorage on THIS device.
 * API keys are never sent anywhere except the matching LLM endpoint.
 */

/* ------------------------------------------------------------------ */
/*  Delivery policy — deliberately NOT user-configurable               */
/* ------------------------------------------------------------------ */

/** Every short is delivered at exactly this frame rate (see quality.ts). */
export const TARGET_FPS = 60;

/** Anything measured below this counts as "the source has too few frames". */
export const LOW_FPS_CEILING = 57;

/**
 * The description attached to EVERY finished video when it goes out through
 * Buffer or Zernio. Fixed on purpose — the whole point is that no short ever
 * ships without the hook, so it is not editable in the post editors and any
 * value stored by an older build is overwritten on load.
 */
export const FIXED_VIDEO_DESCRIPTION = [
  "You won't believe how this story ends...",
  "",
  "Stay until the end because the plot twist is INSANE.",
  "",
  "Would you have done the same?",
  "",
  "#reddit #redditstories #storytime",
  "",
  "#stories #fyp",
].join("\n");

/** The hashtag block of the fixed description, for platforms with a tag field. */
export const FIXED_HASHTAGS: string[] = FIXED_VIDEO_DESCRIPTION
  .split(/\s+/)
  .filter((t) => t.startsWith("#"));

export const FIXED_HASHTAGS_STRING = FIXED_HASHTAGS.join(" ");

export const INTRO_SECONDS_MIN = 0.3;
export const INTRO_SECONDS_MAX = 3;

export const clampIntroSeconds = (v: number): number =>
  Number.isFinite(v)
    ? Math.min(INTRO_SECONDS_MAX, Math.max(INTRO_SECONDS_MIN, Math.round(v * 10) / 10))
    : 1.5;

/** How long the Reddit intro card runs for this settings set (0 = off). */
export const introDuration = (s: Settings): number =>
  s.introEnabled ? clampIntroSeconds(s.introSeconds) : 0;

export type StoryStyle =
  | "aita"
  | "revenge"
  | "confession"
  | "creepy"
  | "wholesome"
  | "workplace"
  | "custom";

export type ClipMode = "even" | "random" | "sequential";
export type MusicStartMode = "start" | "afterIntro" | "random" | "custom";
export type MusicEndMode = "withVideo" | "fadeOut";
export type CaptionStyle = "standard" | "bold" | "minimal" | "highlight";
export type CaptionSize = "small" | "medium" | "large";
export type CaptionPosition = "top" | "middle" | "bottom";
export type AspectRatio = "9:16" | "16:9" | "1:1";
export type Quality = "auto" | "540" | "720" | "1080";
export type Bitrate = "low" | "med" | "high";

export interface Settings {
  /* ---- AI ---- */
  qwenKey: string;
  mistralKey: string;
  storyStyle: StoryStyle;
  storyWords: number;
  temperature: number;
  customPrompt: string;

  /* ---- voice ---- */
  voice: string;
  rate: number;  // -40 … +40 (%)
  pitch: number; // -20 … +20 (Hz)

  /* ---- captions ---- */
  captionsOn: boolean;
  wordsPerCue: number;   // 1 … 5
  captionScale: number;  // 0.045 … 0.11 of width
  captionY: number;      // 0.25 … 0.85
  captionColor: string;
  outlineWidth: number;  // 0 … 0.26 relative to font size
  uppercase: boolean;
  captionShadow: boolean;

  /* ---- video ---- */
  quality: Quality;
  /** legacy field — the renderer always delivers TARGET_FPS (60). */
  fps: number;
  bitrate: Bitrate;
  vignette: boolean;
  zoomEffect: boolean;
  tailPadding: number; // seconds of silence after the voice
  /** lift resolution/bitrate automatically when the source has < 60 FPS */
  fpsAutoBoost: boolean;

  /* ---- reddit intro card ---- */
  introEnabled: boolean;
  introSeconds: number;
  introSubreddit: string;
  introHook: string;

  /* ---- video extras (opt-in) ---- */
  aspectRatio: AspectRatio;
  captionStyle: CaptionStyle;
  captionSize: CaptionSize;
  captionPosition: CaptionPosition;

  /* ---- audio ---- */
  voiceVolume: number; // 0 … 1.4
  musicVolume: number; // 0 … 0.5
  musicFade: boolean;

  /* ---- audio extras (opt-in, defaults preserve previous behaviour) ---- */
  musicEnabled: boolean;
  masterVolume: number;      // 0 … 1.5 overall output trim
  originalAudio: number;     // 0 … 1  background clip's own audio
  duckingEnabled: boolean;
  duckingAmount: number;     // 0 … 1  how far music drops under speech
  duckingSpeed: number;      // 0.05 … 1.2 seconds ramp
  musicStartMode: MusicStartMode;
  musicStartOffset: number;  // seconds, used by "custom"
  musicEndMode: MusicEndMode;
  musicFadeOutLength: number; // seconds

  /* ---- clip mill ---- */
  clipMode: ClipMode;
  clipSkipIntro: number;
  clipSkipOutro: number;
  clipLengthMode: "auto" | "fixed";
  clipFixedLength: number;

  /* ---- publishing ---- */
  defaultVideoDescription: string;
  defaultHashtags: string;
}

const STORE_KEY = "shortsfactory.settings.v3";

export const DEFAULT_SETTINGS: Settings = {
  qwenKey: "",
  mistralKey: "",
  storyStyle: "aita",
  storyWords: 185,
  temperature: 1.05,
  customPrompt: "",

  voice: "en-US-AndrewNeural",
  rate: 2,
  pitch: 0,

  captionsOn: true,
  wordsPerCue: 3,
  captionScale: 0.074,
  captionY: 0.6,
  captionColor: "#ffffff",
  outlineWidth: 0.16,
  uppercase: true,
  captionShadow: true,

  quality: "auto",
  fps: TARGET_FPS,
  bitrate: "med",
  vignette: true,
  zoomEffect: false,
  tailPadding: 0.6,
  fpsAutoBoost: true,

  introEnabled: true,
  introSeconds: 1.5,
  introSubreddit: "r/Stories",
  introHook: "You won't believe how this story ends...",

  aspectRatio: "9:16",
  captionStyle: "standard",
  captionSize: "medium",
  captionPosition: "middle",

  voiceVolume: 1,
  musicVolume: 0.13,
  musicFade: true,

  musicEnabled: true,
  masterVolume: 1,
  originalAudio: 0,
  duckingEnabled: false,
  duckingAmount: 0.6,
  duckingSpeed: 0.35,
  musicStartMode: "start",
  musicStartOffset: 0,
  musicEndMode: "fadeOut",
  musicFadeOutLength: 1.4,

  clipMode: "even",
  clipSkipIntro: 5,
  clipSkipOutro: 5,
  clipLengthMode: "auto",
  clipFixedLength: 35,

  defaultVideoDescription: FIXED_VIDEO_DESCRIPTION,
  defaultHashtags: FIXED_HASHTAGS_STRING,
};

export function loadSettings(): Settings {
  let merged: Settings;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    merged = raw
      ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) }
      : { ...DEFAULT_SETTINGS };
  } catch {
    merged = { ...DEFAULT_SETTINGS };
  }

  /* Two values are policy, not preference — re-assert them so a stored
     settings blob from an older build can never ship a 24/30 FPS file or a
     short without the standard description. */
  return {
    ...merged,
    fps: TARGET_FPS,
    defaultVideoDescription: FIXED_VIDEO_DESCRIPTION,
    defaultHashtags: FIXED_HASHTAGS_STRING,
    introSeconds: clampIntroSeconds(merged.introSeconds),
  };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch {
    /* private mode — non-fatal */
  }
}

export const hasAnyLLMKey = (s: Settings) => Boolean(s.qwenKey.trim() || s.mistralKey.trim());

/** Edge Read-Aloud neural voices (free, no API key). */
export const VOICES: { id: string; label: string }[] = [
  { id: "en-US-AndrewNeural", label: "Andrew · US male (Reddit classic)" },
  { id: "en-US-ChristopherNeural", label: "Christopher · US male, deep" },
  { id: "en-US-GuyNeural", label: "Guy · US male, newscast" },
  { id: "en-US-BrianNeural", label: "Brian · US male, warm" },
  { id: "en-US-SteffanNeural", label: "Steffan · US male, young" },
  { id: "en-US-JennyNeural", label: "Jenny · US female, casual" },
  { id: "en-US-AriaNeural", label: "Aria · US female, narration" },
  { id: "en-US-MichelleNeural", label: "Michelle · US female, bright" },
  { id: "en-GB-RyanNeural", label: "Ryan · British male" },
  { id: "en-GB-SoniaNeural", label: "Sonia · British female" },
  { id: "en-AU-NatashaNeural", label: "Natasha · Australian female" },
  { id: "en-IE-ConnorNeural", label: "Connor · Irish male" },
];

export const STORY_STYLES: { id: StoryStyle; label: string; blurb: string }[] = [
  { id: "aita", label: "AITA", blurb: "moral dilemma, asks the internet to judge" },
  { id: "revenge", label: "PETTY REVENGE", blurb: "slow-burn payback with a punchline" },
  { id: "confession", label: "CONFESSION", blurb: "off-my-chest secret, raw and personal" },
  { id: "creepy", label: "UNSETTLING", blurb: "eerie true-ish encounter, tense build" },
  { id: "wholesome", label: "WHOLESOME", blurb: "feel-good twist, warm ending" },
  { id: "workplace", label: "WORKPLACE", blurb: "office/boss chaos and malicious compliance" },
  { id: "custom", label: "CUSTOM", blurb: "your own instruction below" },
];

export const CAPTION_PRESETS: {
  id: string;
  label: string;
  patch: Partial<Settings>;
}[] = [
  {
    id: "hormozi",
    label: "BOLD PUNCH",
    patch: { captionScale: 0.082, outlineWidth: 0.2, uppercase: true, captionColor: "#ffffff", wordsPerCue: 3, captionShadow: true },
  },
  {
    id: "clean",
    label: "CLEAN SUB",
    patch: { captionScale: 0.058, outlineWidth: 0.1, uppercase: false, captionColor: "#ffffff", wordsPerCue: 4, captionShadow: true },
  },
  {
    id: "karaoke",
    label: "ONE WORD",
    patch: { captionScale: 0.1, outlineWidth: 0.22, uppercase: true, captionColor: "#d9ff3f", wordsPerCue: 1, captionShadow: true },
  },
  {
    id: "mint",
    label: "MINT POP",
    patch: { captionScale: 0.076, outlineWidth: 0.18, uppercase: true, captionColor: "#3fe8a4", wordsPerCue: 2, captionShadow: true },
  },
];

export const isCoarsePointer = () =>
  typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;

/** Phones get a lighter render, desktops full HD — unless overridden. */
export function resolveDimensions(
  q: Quality,
  aspect: AspectRatio = "9:16"
): { width: number; height: number } {
  const shortSide =
    q === "540" ? 540 : q === "720" ? 720 : q === "1080" ? 1080 : isCoarsePointer() ? 720 : 1080;

  if (aspect === "1:1") return { width: shortSide, height: shortSide };
  if (aspect === "16:9") {
    const h = shortSide;
    return { width: Math.round((h * 16) / 9 / 2) * 2, height: h };
  }
  return { width: shortSide, height: Math.round((shortSide * 16) / 9 / 2) * 2 };
}

/** Caption size/position/style presets layered on top of the manual sliders. */
export const CAPTION_SIZE_FACTORS: Record<CaptionSize, number> = {
  small: 0.78,
  medium: 1,
  large: 1.28,
};

export const CAPTION_POSITION_Y: Record<CaptionPosition, number> = {
  top: 0.24,
  middle: 0.6,
  bottom: 0.82,
};

/** Returns the effective caption look, combining style preset + size + position. */
export function resolveCaptionLook(s: Settings) {
  const sizeFactor = CAPTION_SIZE_FACTORS[s.captionSize] ?? 1;
  let scale = s.captionScale * sizeFactor;
  let outlineWidth = s.outlineWidth;
  let shadow = s.captionShadow;
  let uppercase = s.uppercase;
  let color = s.captionColor;
  let highlight = false;

  switch (s.captionStyle) {
    case "bold":
      scale *= 1.1;
      outlineWidth = Math.max(outlineWidth, 0.2);
      uppercase = true;
      break;
    case "minimal":
      outlineWidth = Math.min(outlineWidth, 0.07);
      shadow = true;
      uppercase = false;
      break;
    case "highlight":
      highlight = true;
      outlineWidth = Math.min(outlineWidth, 0.1);
      color = "#ffffff";
      break;
    default:
      break;
  }

  const y =
    s.captionPosition === "middle" ? s.captionY : CAPTION_POSITION_Y[s.captionPosition] ?? s.captionY;

  return { scale, outlineWidth, shadow, uppercase, color, highlight, y };
}

export function resolveBitrate(b: Bitrate, width: number): number {
  const base = width >= 1080 ? 8_000_000 : width >= 720 ? 5_000_000 : 3_000_000;
  return b === "low" ? Math.round(base * 0.55) : b === "high" ? Math.round(base * 1.5) : base;
}

export function styleInstruction(s: Settings): string {
  switch (s.storyStyle) {
    case "revenge":
      return "Sub-genre: petty revenge. A slow-burn setup where the narrator quietly gets even, ending on a satisfying punchline.";
    case "confession":
      return "Sub-genre: raw confession. The narrator admits something they have kept secret, honest and a little uncomfortable.";
    case "creepy":
      return "Sub-genre: unsettling true-ish encounter. Build tension steadily, keep it grounded and eerie, no gore.";
    case "wholesome":
      return "Sub-genre: wholesome. Something small and human that turns out unexpectedly kind, warm ending.";
    case "workplace":
      return "Sub-genre: workplace chaos. Bosses, coworkers, malicious compliance, corporate absurdity.";
    case "custom":
      return s.customPrompt.trim() || "Sub-genre: general viral Reddit story.";
    case "aita":
    default:
      return "Sub-genre: AITA. Present a moral dilemma and end by asking the internet to judge.";
  }
}

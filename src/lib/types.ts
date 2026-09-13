import type { WordTs } from "./tts";

/** idle → script → voice → staged (awaiting the render button) → rendering → done */
export type RenderStage =
  | "idle"
  | "script"
  | "voice"
  | "staged"
  | "rendering"
  | "done"
  | "error";

export interface LocalRenderItem {
  index: number;
  idea: string;
  status: RenderStage;
  provider?: "qwen" | "mistral" | "offline";
  story?: string;
  voiceDuration?: number;
  clipStart?: number;
  mime?: string;
  size?: number;
  duration?: number;
  blob?: Blob;
  blobUrl?: string;
  error?: string;
  /** delivered frame rate of the finished file — always 60 */
  fps?: number;
  /** resolution/bitrate were lifted automatically (source below 60 FPS) */
  fpsBoosted?: boolean;
  sourceFps?: number | null;
  /** seconds of Reddit intro card in front of the story */
  introSeconds?: number;
}

export interface VoiceTake {
  audio: ArrayBuffer;
  words: WordTs[];
  duration: number;
}

export interface BgFile {
  id: string;
  file: File;
  width: number;
  height: number;
  duration: number;
  /** measured source frame rate, null when the browser could not tell */
  fps: number | null;
  status: "validating" | "ready" | "error";
  reason?: string;
}

export interface MusicFile {
  id: string;
  file: File;
  duration?: number;
  selected: boolean;
}

export type Phase =
  | "idle"
  | "preparing"
  | "staged"
  | "rendering"
  | "ready"
  | "partial"
  | "failed";

export const STAGES: { id: string; label: string }[] = [
  { id: "script", label: "Script" },
  { id: "voice", label: "Voice" },
  { id: "render", label: "Render" },
  { id: "done", label: "Done" },
];

export function stageIndex(status: RenderStage): number {
  switch (status) {
    case "idle":
      return -1;
    case "script":
      return 0;
    case "voice":
      return 1;
    case "staged":
      return 2;   // script + voice complete, render pending
    case "rendering":
      return 2;
    case "done":
      return 3;
    case "error":
      return -1;
  }
}

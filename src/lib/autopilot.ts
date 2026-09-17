/**
 * Autopilot — vollautomatisches Rendern + Posten über Postlake.
 *
 * Wenn der Auto-Modus läuft, passiert alles ohne Nachfrage und ohne Klick:
 *   Ideen sichern → Scripts + Voices vorbereiten → rendern → jedes fertige
 *   Video an Postlake schicken → nächste Runde. Gestoppt wird nur per STOP.
 *
 * Das Stunden-Limit (voreingestellt, 1–100 Videos/Stunde) drosselt den
 * POSTLAKE-VERSAND (Upload + POST /v1/posts). Gerendert wird durchgehend —
 * was das Limit übersteigt, wartet in der Sende-Warteschlange.
 *
 * Hinweis: Der Browser-Tab muss offen bleiben (Echtzeit-Canvas-Rendering).
 */

import type { SocialPlatform } from "./postlake";

export type AutopilotMode = "now" | "scheduled";

export interface AutopilotConfig {
  /** Stunden-Limit: 1–100 Videos/Stunde an Postlake (voreingestellt: 10) */
  videosPerHour: number;
  /** "now" = sofort veröffentlichen (publishNow) · "scheduled" = freie Slots (06:00/20:00) */
  mode: AutopilotMode;
  /** Plattform-Rotation für den Versand */
  platforms: SocialPlatform[];
  /** Optional: feste Postlake-Account-IDs je Plattform (sonst erster verbundener Kanal) */
  accountIds: Partial<Record<SocialPlatform, string>>;
  /** Caption-Vorlage; {title} wird durch die Story-Idee ersetzt */
  caption: string;
  hashtags: string;
  /** Live-Status bei Postlake pollen (Veröffentlicht/Fehler erkennen) */
  pollStatus: boolean;
  /** Nach jeder 10er-Runde automatisch mit frischen Ideen fortfahren */
  loopRounds: boolean;
}

export const AUTOPILOT_MIN_PER_HOUR = 1;
export const AUTOPILOT_MAX_PER_HOUR = 100;

export const AUTOPILOT_DEFAULTS: AutopilotConfig = {
  videosPerHour: 10,
  mode: "now",
  platforms: ["tiktok", "instagram", "youtube"],
  accountIds: {},
  caption:
    "You won't believe how this story ends...\nStay until the end because the plot twist is INSANE.\nWould you have done the same?",
  hashtags: "#reddit #redditstories #storytime #stories #fyp",
  pollStatus: true,
  loopRounds: true,
};

const CFG_KEY = "shortsfactory.autopilot_config.v1";
const LOG_KEY = "shortsfactory.autopilot_dispatch_log.v1";
const STATS_KEY = "shortsfactory.autopilot_stats.v1";

export function clampPerHour(n: number): number {
  if (!Number.isFinite(n)) return AUTOPILOT_DEFAULTS.videosPerHour;
  return Math.max(AUTOPILOT_MIN_PER_HOUR, Math.min(AUTOPILOT_MAX_PER_HOUR, Math.round(n)));
}

export function loadAutopilotConfig(): AutopilotConfig {
  try {
    const raw = localStorage.getItem(CFG_KEY);
    if (!raw) return { ...AUTOPILOT_DEFAULTS, platforms: [...AUTOPILOT_DEFAULTS.platforms] };
    const parsed = JSON.parse(raw) as Partial<AutopilotConfig>;
    return {
      ...AUTOPILOT_DEFAULTS,
      ...parsed,
      videosPerHour: clampPerHour(Number(parsed.videosPerHour)),
      platforms:
        Array.isArray(parsed.platforms) && parsed.platforms.length > 0
          ? parsed.platforms.filter((p): p is SocialPlatform =>
              p === "tiktok" || p === "instagram" || p === "youtube"
            )
          : [...AUTOPILOT_DEFAULTS.platforms],
      accountIds: parsed.accountIds || {},
    };
  } catch {
    return { ...AUTOPILOT_DEFAULTS, platforms: [...AUTOPILOT_DEFAULTS.platforms] };
  }
}

export function saveAutopilotConfig(cfg: AutopilotConfig): void {
  try {
    localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
  } catch {
    /* private mode */
  }
}

/* ------------------------------------------------------------------ */
/*  Dispatch-Log: rolling 60-Minuten-Fenster für das Stunden-Limit      */
/* ------------------------------------------------------------------ */

/** Zeitstempel (ms) aller Postlake-Versände, persistent — überlebt Reloads. */
export function loadDispatchLog(): number[] {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((t) => typeof t === "number" && Number.isFinite(t));
  } catch {
    return [];
  }
}

function saveDispatchLog(log: number[]): void {
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(-500)));
  } catch {
    /* quota */
  }
}

export function pruneDispatchLog(now = Date.now()): number[] {
  const fresh = loadDispatchLog().filter((t) => now - t < 3_600_000);
  saveDispatchLog(fresh);
  return fresh;
}

export function recordDispatch(at = Date.now()): number[] {
  const log = pruneDispatchLog(at);
  log.push(at);
  saveDispatchLog(log);
  return log;
}

/** Versände in den letzten 60 Minuten. */
export function countDispatchesLastHour(now = Date.now()): number {
  return loadDispatchLog().filter((t) => now - t < 3_600_000).length;
}

/**
 * Millisekunden bis zum nächsten erlaubten Versand (0 = sofort).
 * Kombiniert zwei Regeln: gleichmäßiger Mindestabstand (3600s / Limit) UND
 * hartes Rolling-Window-Cap (max. `perHour` Versände in 60 Minuten).
 */
export function msUntilNextDispatch(perHour: number, now = Date.now()): number {
  const limit = clampPerHour(perHour);
  const log = loadDispatchLog()
    .filter((t) => now - t < 3_600_000)
    .sort((a, b) => a - b);

  // Regel 1: gleichmäßiger Abstand
  const minInterval = 3_600_000 / limit;
  let wait = 0;
  if (log.length > 0) {
    const sinceLast = now - log[log.length - 1];
    if (sinceLast < minInterval) wait = Math.max(wait, minInterval - sinceLast);
  }

  // Regel 2: hartes Stunden-Cap — der älteste der letzten `limit` Versände
  // muss aus dem 60-Min-Fenster fallen, bevor der nächste raus darf.
  if (log.length >= limit) {
    const oldestRelevant = log[log.length - limit];
    const untilFree = oldestRelevant + 3_600_000 - now;
    if (untilFree > 0) wait = Math.max(wait, untilFree);
  }

  return Math.max(0, Math.ceil(wait));
}

/* ------------------------------------------------------------------ */
/*  Statistiken & Log-Einträge                                         */
/* ------------------------------------------------------------------ */

export interface AutopilotStats {
  totalPosted: number;
  totalFailed: number;
  totalRendered: number;
  rounds: number;
  startedAt: number | null;
  lastActivityAt: number | null;
}

export const EMPTY_STATS: AutopilotStats = {
  totalPosted: 0,
  totalFailed: 0,
  totalRendered: 0,
  rounds: 0,
  startedAt: null,
  lastActivityAt: null,
};

export function loadAutopilotStats(): AutopilotStats {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (!raw) return { ...EMPTY_STATS };
    return { ...EMPTY_STATS, ...JSON.parse(raw) };
  } catch {
    return { ...EMPTY_STATS };
  }
}

export function saveAutopilotStats(s: AutopilotStats): void {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export interface AutopilotLogEntry {
  at: number;
  kind: "info" | "ok" | "warn" | "error";
  text: string;
}

export function formatWait(ms: number): string {
  if (ms <= 0) return "bereit";
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest === 0 ? `${m} min` : `${m} min ${rest} s`;
}

export function hashtagsToList(s: string): string[] {
  return s
    .split(/[\s,]+/)
    .map((h) => h.trim())
    .filter(Boolean);
}

/**
 * Provider-neutraler Kern für geplante und veröffentlichte Posts.
 *
 * Enthält die gemeinsamen Typen, den lokalen Spiegel (localStorage), die
 * Posting-Voreinstellungen, die Zeitzonen-/Slot-Engine und Darstellungshilfen.
 * Der eigentliche Versand läuft ausschließlich über Buffer (siehe ./buffer.ts
 * und /api/buffer) — dieser Kern weiß nichts über einen konkreten Dienst.
 */

export type PostState =
  | "draft"
  | "queued"
  | "scheduled"
  | "processing"
  | "partial"
  | "published"
  | "failed";

export type PostStatus =
  | "Geplant"
  | "Wird veröffentlicht"
  | "Veröffentlicht"
  | "Teils veröffentlicht"
  | "Fehler"
  | "Entwurf";

export type SocialPlatform = "tiktok" | "instagram" | "youtube";

/** Versandweg eines Posts. Aktuell gibt es genau einen: Buffer. */
export type PostProvider = "buffer";

export interface PostTarget {
  account: string;
  platform: string;
  state: string;
  url?: string | null;
  permalinkPending?: boolean;
  publishedAt?: string | null;
  error?: { message?: string; type?: string } | string | null;
}

export interface SocialPost {
  /** lokale ID (idempotenter Schlüssel-Anker) */
  id: string;
  text: string;
  title: string;
  hashtags: string[];
  mediaIds: string[];
  /** Vorschau-URL (Supabase/Blob) — nur für Kalender-Vorschau */
  previewUrl?: string;
  accounts: string[];
  platforms: string[];
  state: PostState;
  status: PostStatus;
  /** UTC-ISO (Feuerzeitpunkt) bzw. Erstellzeitpunkt bei Sofort-Posts */
  scheduledAt: string;
  scheduledAtLocal?: string;
  timezone: string;
  targets: PostTarget[];
  warnings?: string[];
  errorMessage?: string | null;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
  /** true = existiert nur lokal (kein Key / offline erstellt) */
  local?: boolean;
  /**
   * Versandweg. Einträge aus der Zeit vor der Buffer-only-Umstellung können
   * einen anderen Wert tragen — sie bleiben als reine Bestandsdaten im
   * Kalender sichtbar (nur noch lokal änderbar).
   */
  provider?: PostProvider;
  /** Buffer-Post-IDs (eine pro Kanal) */
  bufferPostIds?: string[];
  /** Öffentliche Video-URL (Buffer-Hosting via Supabase) */
  videoUrl?: string;
}

export interface SocialAccount {
  id: string;
  platform: string;
  handle: string;
  name: string;
  avatarUrl?: string;
  profileId?: string;
  status: string;
}

/* ------------------------------------------------------------------ */
/*  Persistenz (lokaler Spiegel)                                        */
/* ------------------------------------------------------------------ */

// Die beiden Schlüsselnamen stammen aus der Zeit vor der Buffer-only-Umstellung
// und bleiben BEWUSST unverändert: So überleben bestehende Kalender-Einträge
// und Voreinstellungen der Nutzer den Wechsel ohne Migrationsschritt und ohne
// Datenverlust. Bitte nicht umbenennen.
const POSTS_KEY = "shortsfactory.postlake_posts.v1"; // bewusst beibehalten (Bestand) — Postlake-Ära-Key, siehe oben
const PREFS_KEY = "shortsfactory.postlake_prefs.v1"; // bewusst beibehalten (Bestand) — Postlake-Ära-Key, siehe oben

export function loadCachedPosts(): SocialPost[] {
  try {
    const raw = localStorage.getItem(POSTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveCachedPosts(posts: SocialPost[]): void {
  try {
    localStorage.setItem(POSTS_KEY, JSON.stringify(posts.slice(0, 500)));
  } catch {
    /* quota */
  }
}

/* ------------------------------------------------------------------ */
/*  Posting-Voreinstellungen (für „Post all" ohne Nachfrage)            */
/* ------------------------------------------------------------------ */

export type PostMode = "now" | "scheduled";

export interface PostPrefs {
  platforms: SocialPlatform[];
  /** Wunsch-Kanal je Plattform für Buffer (channelId); leer = erster verbundener */
  bufferAccountIds: Partial<Record<SocialPlatform, string>>;
  mode: PostMode;
  preferredTimes: string[];
  caption: string;
  hashtags: string;
  timezone: string;
}

export const DEFAULT_PREFS: PostPrefs = {
  platforms: ["tiktok", "instagram", "youtube"],
  bufferAccountIds: {},
  mode: "now",
  preferredTimes: ["06:00", "20:00"],
  caption:
    "You won't believe how this story ends...\nStay until the end because the plot twist is INSANE.\nWould you have done the same?",
  hashtags: "#reddit #redditstories #storytime #stories #fyp",
  timezone: "Europe/Berlin",
};

export function loadPrefs(): PostPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return structuredClone(DEFAULT_PREFS);
    const parsed = JSON.parse(raw) as Partial<PostPrefs>;
    const platforms = (Array.isArray(parsed.platforms) ? parsed.platforms : []).filter(
      (p): p is SocialPlatform => p === "tiktok" || p === "instagram" || p === "youtube"
    );
    return {
      ...structuredClone(DEFAULT_PREFS),
      ...parsed,
      platforms: platforms.length > 0 ? platforms : [...DEFAULT_PREFS.platforms],
      bufferAccountIds: parsed.bufferAccountIds || {},
      preferredTimes:
        Array.isArray(parsed.preferredTimes) && parsed.preferredTimes.length > 0
          ? parsed.preferredTimes
          : [...DEFAULT_PREFS.preferredTimes],
    };
  } catch {
    return structuredClone(DEFAULT_PREFS);
  }
}

export function savePrefs(p: PostPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* private mode */
  }
}

export function hashtagsToList(s: string): string[] {
  return s
    .split(/[\s,]+/)
    .map((h) => h.trim())
    .filter(Boolean);
}

/* ------------------------------------------------------------------ */
/*  Zeitzonen- & Slot-Engine (Standard: Europe/Berlin)                  */
/* ------------------------------------------------------------------ */

export function tzParts(date: Date, timeZone = "Europe/Berlin") {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const map: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour === "24" ? "0" : map.hour),
    minute: Number(map.minute),
  };
}

/** Wandzeit in `timeZone` → UTC-ISO. */
export function wallTimeToISO(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0,
  timeZone = "Europe/Berlin"
): string {
  const approx = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const actual = tzParts(approx, timeZone);
  let diff = hour * 60 + minute - (actual.hour * 60 + actual.minute);
  if (diff > 720) diff -= 1440;
  if (diff < -720) diff += 1440;
  return new Date(approx.getTime() + diff * 60_000).toISOString();
}

/** UTC-ISO → naive Wandzeit "YYYY-MM-DDTHH:mm:ss" in `timeZone`. */
export function isoToWall(iso: string, timeZone = "Europe/Berlin"): string {
  const p = tzParts(new Date(iso), timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:00`;
}

export function slotKey(iso: string, timeZone = "Europe/Berlin"): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const p = tzParts(d, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
}

export function formatDateTime(iso: string, timeZone = "Europe/Berlin") {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { date: "—", time: "—", weekday: "—", full: "—" };
  const date = new Intl.DateTimeFormat("de-DE", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
  const time = new Intl.DateTimeFormat("de-DE", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
  const weekday = new Intl.DateTimeFormat("de-DE", { timeZone, weekday: "short" }).format(d);
  return { date, time: `${time} Uhr`, weekday, full: `${weekday}, ${date} · ${time} Uhr` };
}

export function dateKey(d: Date, timeZone = "Europe/Berlin"): string {
  const p = tzParts(d, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

const parseTime = (t: string): [number, number] => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) return [6, 0];
  return [Math.min(23, Math.max(0, +m[1])), Math.min(59, Math.max(0, +m[2]))];
};

/**
 * Freie Slots finden (belegte werden übersprungen, nie doppelt belegt).
 * Standard: 06:00 & 20:00 Europe/Berlin — wie bisher.
 */
export function planFreeSlots(
  existing: SocialPost[],
  opts: { count: number; preferredTimes: string[]; timezone?: string; startDate?: string }
): { scheduledAt: string; naive: string; key: string }[] {
  const tz = opts.timezone || "Europe/Berlin";
  const times = (opts.preferredTimes.length ? opts.preferredTimes : ["06:00", "20:00"])
    .map(parseTime)
    .sort((a, b) => a[0] * 60 + a[1] - (b[0] * 60 + b[1]));

  const occupied = new Set(
    existing
      .filter((p) => p?.scheduledAt && (p.status === "Geplant" || p.status === "Entwurf"))
      .map((p) => slotKey(p.scheduledAt, tz))
  );

  const now = new Date();
  let anchor = tzParts(now, tz);
  if (opts.startDate) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(opts.startDate);
    if (m) anchor = { ...anchor, year: +m[1], month: +m[2], day: +m[3] };
  }

  const out: { scheduledAt: string; naive: string; key: string }[] = [];
  for (let dayIdx = 0; dayIdx < 400 && out.length < opts.count; dayIdx++) {
    const base = new Date(Date.UTC(anchor.year, anchor.month - 1, anchor.day + dayIdx, 12, 0, 0));
    const b = tzParts(base, tz);
    for (const [h, mi] of times) {
      if (out.length >= opts.count) break;
      const iso = wallTimeToISO(b.year, b.month, b.day, h, mi, tz);
      if (new Date(iso).getTime() <= now.getTime() + 120_000) continue;
      const key = slotKey(iso, tz);
      if (occupied.has(key)) continue;
      occupied.add(key);
      out.push({ scheduledAt: iso, naive: isoToWall(iso, tz), key });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Darstellungshilfen                                                  */
/* ------------------------------------------------------------------ */

export const SERVICE_META: Record<string, { label: string; icon: string }> = {
  tiktok: { label: "TikTok", icon: "🎵" },
  instagram: { label: "Instagram", icon: "📸" },
  youtube: { label: "YouTube", icon: "▶️" },
  facebook: { label: "Facebook", icon: "👥" },
  threads: { label: "Threads", icon: "🧵" },
  bluesky: { label: "Bluesky", icon: "🦋" },
  linkedin: { label: "LinkedIn", icon: "💼" },
  pinterest: { label: "Pinterest", icon: "📌" },
  x: { label: "X", icon: "✕" },
  twitter: { label: "X", icon: "✕" },
};

export const serviceMeta = (service?: string) =>
  SERVICE_META[String(service || "").toLowerCase()] ?? { label: service || "Kanal", icon: "🌐" };

export const STATUS_STYLE: Record<PostStatus, { dot: string; cls: string }> = {
  Geplant: { dot: "🟡", cls: "border-amber-warn/50 bg-amber-warn/10 text-amber-warn" },
  "Wird veröffentlicht": { dot: "🔵", cls: "border-volt-400/50 bg-volt-400/10 text-volt-300" },
  Veröffentlicht: { dot: "🟢", cls: "border-mint-400/50 bg-mint-400/10 text-mint-400" },
  "Teils veröffentlicht": { dot: "🟠", cls: "border-ember-400/50 bg-ember-500/10 text-ember-400" },
  Fehler: { dot: "🔴", cls: "border-rose-err/60 bg-rose-err/10 text-rose-err" },
  Entwurf: { dot: "⚪", cls: "border-coal-600 bg-coal-850 text-coal-300" },
};

/** Versände in den letzten 60 Minuten (Stunden-Limit-Anzeige). */
export function countPostsLastHour(posts: SocialPost[], now = Date.now()): number {
  return posts.filter((p) => {
    const t = new Date(p.createdAt).getTime();
    return !isNaN(t) && now - t < 3_600_000;
  }).length;
}

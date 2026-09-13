/**
 * Buffer client (frontend side).
 *
 * Talks exclusively to the same-origin /api/buffer route — the BUFFER_API_KEY
 * lives on the server and never reaches this bundle. Results are mirrored into
 * localStorage so the calendar/dashboard still render when the key is missing
 * or the network is down; Buffer stays the source of truth whenever reachable.
 */

import { FIXED_HASHTAGS_STRING } from "./settings";

export type BufferMode = "shareNow" | "addToQueue" | "customScheduled";

export type PostStatus =
  | "Geplant"
  | "Wird verarbeitet"
  | "Veröffentlicht"
  | "Fehler"
  | "Entwurf";

export interface BufferChannel {
  id: string;
  name: string;
  service: string;
  username?: string;
  avatar?: string;
  connected: boolean;
  locked?: boolean;
}

export interface BufferPost {
  id: string;
  bufferPostId?: string | null;
  text: string;
  title: string;
  caption?: string;
  hashtags?: string[];
  status: PostStatus;
  scheduledAt: string;
  channelId: string;
  channelName?: string;
  service?: string;
  avatar?: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  errorMessage?: string | null;
  metrics?: Record<string, number>;
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  engagement?: number;
  createdAt?: string;
  updatedAt?: string;
  /** true when the post only exists locally (no Buffer key configured) */
  local?: boolean;
}

export interface AnalyticsTotals {
  views: number;
  impressions: number;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  posts: number;
  engagementRate: number;
}

const POSTS_KEY = "shortsfactory.buffer_posts.v1";
const PREFS_KEY = "shortsfactory.buffer_prefs.v1";

export interface BufferPrefs {
  /** channel ids selected by default in the post editor */
  selectedChannelIds: string[];
  defaultHashtags: string;
  /** automatic planner */
  postsPerDay: number;
  preferredTimes: string[];
  planDays: number;
  timezone: string;
}

export const DEFAULT_PREFS: BufferPrefs = {
  selectedChannelIds: [],
  defaultHashtags: FIXED_HASHTAGS_STRING,
  postsPerDay: 2,
  preferredTimes: ["06:00", "20:00"],
  planDays: 5,
  timezone: "Europe/Berlin",
};

export function loadPrefs(): BufferPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(p: BufferPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* private mode */
  }
}

export function loadCachedPosts(): BufferPost[] {
  try {
    const raw = localStorage.getItem(POSTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveCachedPosts(posts: BufferPost[]): void {
  try {
    localStorage.setItem(POSTS_KEY, JSON.stringify(posts.slice(0, 500)));
  } catch {
    /* quota */
  }
}

/* ------------------------------------------------------------------ */
/*  Timezone helpers (default Europe/Berlin)                            */
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

/** Convert a wall-clock time in `timeZone` into a UTC ISO string. */
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
 * Automatic planner: walks forward day by day, offering `preferredTimes`
 * (capped at `postsPerDay` per day) and skipping every slot that is already
 * occupied by an existing post. Never double-books.
 */
export function planAutoSlots(
  existing: BufferPost[],
  opts: {
    count: number;
    preferredTimes: string[];
    postsPerDay: number;
    planDays?: number;
    startDate?: string;
    timezone?: string;
  }
): { scheduledAt: string; key: string }[] {
  const tz = opts.timezone || "Europe/Berlin";
  const times = (opts.preferredTimes.length ? opts.preferredTimes : ["06:00", "20:00"])
    .map(parseTime)
    .sort((a, b) => a[0] * 60 + a[1] - (b[0] * 60 + b[1]));
  const perDay = Math.max(1, Math.min(opts.postsPerDay || times.length, times.length));

  const occupied = new Set(
    existing.filter((p) => p?.scheduledAt).map((p) => slotKey(p.scheduledAt, tz))
  );

  const now = new Date();
  let anchor = tzParts(now, tz);
  if (opts.startDate) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(opts.startDate);
    if (m) anchor = { ...anchor, year: +m[1], month: +m[2], day: +m[3] };
  }

  const out: { scheduledAt: string; key: string }[] = [];
  const maxDays = Math.max(opts.planDays || 5, 1) * 12; // keep searching past the window
  for (let dayIdx = 0; dayIdx < maxDays && out.length < opts.count; dayIdx++) {
    const base = new Date(Date.UTC(anchor.year, anchor.month - 1, anchor.day + dayIdx, 12, 0, 0));
    const b = tzParts(base, tz);
    let usedToday = 0;

    for (const [h, mi] of times) {
      if (out.length >= opts.count || usedToday >= perDay) break;
      const iso = wallTimeToISO(b.year, b.month, b.day, h, mi, tz);
      if (new Date(iso).getTime() <= now.getTime() + 120_000) continue;
      const key = slotKey(iso, tz);
      if (occupied.has(key)) continue;
      occupied.add(key);
      out.push({ scheduledAt: iso, key });
      usedToday++;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  API calls                                                           */
/* ------------------------------------------------------------------ */

async function call<T>(payload: Record<string, unknown>): Promise<T & { ok: boolean; error?: string }> {
  const res = await fetch("/api/buffer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return (await res.json()) as T & { ok: boolean; error?: string };
}

export async function fetchChannels(): Promise<{
  channels: BufferChannel[];
  hasApiKey: boolean;
  error?: string;
}> {
  try {
    const res = await fetch("/api/buffer");
    const data = await res.json();
    return {
      channels: Array.isArray(data.channels) ? data.channels : [],
      hasApiKey: Boolean(data.hasApiKey),
      error: data.error,
    };
  } catch (e) {
    return { channels: [], hasApiKey: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Buffer is the source of truth; local-only posts are merged in beneath it. */
export async function fetchPosts(): Promise<{
  posts: BufferPost[];
  channels: BufferChannel[];
  hasApiKey: boolean;
  error?: string;
}> {
  const cached = loadCachedPosts();
  try {
    const data = await call<{
      posts: BufferPost[];
      channels: BufferChannel[];
      hasApiKey: boolean;
    }>({ action: "posts" });

    if (data.ok && Array.isArray(data.posts)) {
      const remoteIds = new Set(data.posts.map((p) => p.bufferPostId || p.id));
      const localExtras = cached.filter((p) => p.local && !remoteIds.has(p.bufferPostId || p.id));
      /* keep locally stored media/hashtags attached to their Buffer twins */
      const enriched = data.posts.map((p) => {
        const twin = cached.find((c) => (c.bufferPostId || c.id) === (p.bufferPostId || p.id));
        return twin ? { ...twin, ...p, videoUrl: twin.videoUrl, thumbnailUrl: twin.thumbnailUrl } : p;
      });
      const merged = [...enriched, ...localExtras].sort(
        (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
      );
      saveCachedPosts(merged);
      return { posts: merged, channels: data.channels || [], hasApiKey: true };
    }
    return { posts: cached, channels: [], hasApiKey: Boolean(data.hasApiKey), error: data.error };
  } catch (e) {
    return {
      posts: cached,
      channels: [],
      hasApiKey: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export interface CreateJob {
  localId: string;
  channelId: string;
  channelName?: string;
  service?: string;
  text: string;
  title: string;
  caption: string;
  hashtags: string[];
  mode: BufferMode;
  dueAt?: string;
  mediaUrl?: string;
  thumbnailUrl?: string;
}

/**
 * Fan out one post per selected channel. Returns the resulting posts with
 * per-channel success/error state — failures never masquerade as success.
 */
export async function createPosts(jobs: CreateJob[]): Promise<{
  posts: BufferPost[];
  created: number;
  failed: number;
  hasApiKey: boolean;
  error?: string;
}> {
  const nowIso = new Date().toISOString();

  const toPost = (
    job: CreateJob,
    over: Partial<BufferPost> = {}
  ): BufferPost => ({
    id: job.localId,
    bufferPostId: null,
    text: job.text,
    title: job.title,
    caption: job.caption,
    hashtags: job.hashtags,
    status: job.mode === "shareNow" ? "Wird verarbeitet" : "Geplant",
    scheduledAt: job.dueAt || nowIso,
    channelId: job.channelId,
    channelName: job.channelName,
    service: job.service,
    videoUrl: job.mediaUrl,
    thumbnailUrl: job.thumbnailUrl,
    errorMessage: null,
    createdAt: nowIso,
    updatedAt: nowIso,
    local: true,
    ...over,
  });

  try {
    const data = await call<{
      results: {
        ok: boolean;
        localId: string;
        channelId: string;
        bufferPostId?: string;
        status?: PostStatus;
        dueAt?: string;
        error?: string;
      }[];
      created: number;
      failed: number;
      hasApiKey: boolean;
    }>({ action: "createBatch", jobs });

    if (!data.ok && data.hasApiKey === false) {
      /* No key on the server: keep everything locally so nothing is lost. */
      const posts = jobs.map((j) => toPost(j));
      const merged = [...loadCachedPosts(), ...posts];
      saveCachedPosts(merged);
      return {
        posts: merged,
        created: posts.length,
        failed: 0,
        hasApiKey: false,
        error: data.error,
      };
    }

    const results = data.results || [];
    const posts = jobs.map((job) => {
      const r = results.find((x) => x.localId === job.localId);
      if (!r) return toPost(job, { status: "Fehler", errorMessage: "Keine Antwort von Buffer." });
      if (!r.ok) return toPost(job, { status: "Fehler", errorMessage: r.error || "Buffer-Fehler." });
      return toPost(job, {
        bufferPostId: r.bufferPostId,
        status: r.status || (job.mode === "shareNow" ? "Wird verarbeitet" : "Geplant"),
        scheduledAt: r.dueAt || job.dueAt || nowIso,
        local: false,
      });
    });

    const merged = [...loadCachedPosts(), ...posts].sort(
      (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
    );
    saveCachedPosts(merged);

    return {
      posts: merged,
      created: data.created ?? posts.filter((p) => p.status !== "Fehler").length,
      failed: data.failed ?? posts.filter((p) => p.status === "Fehler").length,
      hasApiKey: true,
      error: data.error,
    };
  } catch (e) {
    const posts = jobs.map((j) => toPost(j));
    const merged = [...loadCachedPosts(), ...posts];
    saveCachedPosts(merged);
    return {
      posts: merged,
      created: posts.length,
      failed: 0,
      hasApiKey: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function deletePost(post: BufferPost): Promise<BufferPost[]> {
  if (post.bufferPostId && !post.local) {
    try {
      await call({ action: "delete", postId: post.bufferPostId });
    } catch {
      /* fall through — still remove locally so the UI stays consistent */
    }
  }
  const next = loadCachedPosts().filter((p) => p.id !== post.id);
  saveCachedPosts(next);
  return next;
}

export function updateCachedPost(id: string, patch: Partial<BufferPost>): BufferPost[] {
  const next = loadCachedPosts().map((p) =>
    p.id === id ? { ...p, ...patch, updatedAt: new Date().toISOString() } : p
  );
  saveCachedPosts(next);
  return next;
}

export async function fetchAnalytics(days: number): Promise<{
  totals: AnalyticsTotals | null;
  posts: BufferPost[];
  hasApiKey: boolean;
  error?: string;
}> {
  try {
    const data = await call<{
      totals: AnalyticsTotals;
      posts: BufferPost[];
      hasApiKey: boolean;
    }>({ action: "analytics", days });
    if (data.ok) {
      return { totals: data.totals, posts: data.posts || [], hasApiKey: true };
    }
    return { totals: null, posts: [], hasApiKey: Boolean(data.hasApiKey), error: data.error };
  } catch (e) {
    return { totals: null, posts: [], hasApiKey: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/* ------------------------------------------------------------------ */
/*  Presentation helpers                                                */
/* ------------------------------------------------------------------ */

export const SERVICE_LABELS: Record<string, { label: string; icon: string }> = {
  tiktok: { label: "TikTok", icon: "🎵" },
  instagram: { label: "Instagram", icon: "📸" },
  youtube: { label: "YouTube", icon: "▶️" },
  facebook: { label: "Facebook", icon: "👥" },
  twitter: { label: "X", icon: "✕" },
  x: { label: "X", icon: "✕" },
  linkedin: { label: "LinkedIn", icon: "💼" },
  pinterest: { label: "Pinterest", icon: "📌" },
  threads: { label: "Threads", icon: "🧵" },
  bluesky: { label: "Bluesky", icon: "🦋" },
  mastodon: { label: "Mastodon", icon: "🐘" },
  googlebusiness: { label: "Google Business", icon: "🏢" },
};

export const serviceMeta = (service?: string) =>
  SERVICE_LABELS[String(service || "").toLowerCase()] ?? { label: service || "Kanal", icon: "🌐" };

export const STATUS_DOTS: Record<PostStatus, { dot: string; cls: string }> = {
  Geplant: { dot: "🟡", cls: "border-amber-warn/50 bg-amber-warn/10 text-amber-warn" },
  "Wird verarbeitet": { dot: "🔵", cls: "border-volt-400/50 bg-volt-400/10 text-volt-300" },
  Veröffentlicht: { dot: "🟢", cls: "border-mint-400/50 bg-mint-400/10 text-mint-400" },
  Fehler: { dot: "🔴", cls: "border-rose-err/60 bg-rose-err/10 text-rose-err" },
  Entwurf: { dot: "⚪", cls: "border-coal-600 bg-coal-850 text-coal-300" },
};

export const compactNumber = (n: number) =>
  new Intl.NumberFormat("de-DE", { notation: "compact", maximumFractionDigits: 1 }).format(n || 0);

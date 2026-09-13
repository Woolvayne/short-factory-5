/**
 * Social Media Scheduling Client & Europe/Berlin Slot Engine
 *
 * Manages:
 *   - Persistent scheduled posts list (synchronized between /api/zernio and localStorage)
 *   - Intelligent slot selection in Europe/Berlin timezone (06:00 & 20:00)
 *   - Scheduling 10 posts across the next 5 free days
 *   - Support for TikTok, Instagram, YouTube Shorts (and custom platforms)
 *   - Retry failed posts ("Erneut versuchen") & delete posts
 */

import { FIXED_HASHTAGS_STRING } from "./settings";

export type SocialPlatform = "tiktok" | "instagram" | "youtube";

export type PostStatus = "Geplant" | "Wird veröffentlicht" | "Veröffentlicht" | "Fehler";

export interface ScheduledPost {
  id: string;
  videoUrl: string;
  thumbnailUrl?: string;
  title: string;
  description: string;
  hashtags: string[];
  platform: SocialPlatform;
  scheduledAt: string; // ISO UTC string
  berlinSlotKey?: string; // "YYYY-MM-DD HH:mm" in Europe/Berlin
  status: PostStatus;
  zernioPostId?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ZernioConfigState {
  defaultPlatforms: SocialPlatform[];
  tiktokAccountId: string;
  instagramAccountId: string;
  youtubeAccountId: string;
  defaultHashtags: string;
  simulateErrorOnNextPost?: boolean;
}

const POSTS_STORAGE_KEY = "shortsfactory.scheduled_posts.v1";
const ZERNIO_CFG_KEY = "shortsfactory.zernio_config.v1";

export const DEFAULT_ZERNIO_CONFIG: ZernioConfigState = {
  defaultPlatforms: ["tiktok", "instagram", "youtube"],
  tiktokAccountId: "",
  instagramAccountId: "",
  youtubeAccountId: "",
  defaultHashtags: FIXED_HASHTAGS_STRING,
  simulateErrorOnNextPost: false,
};

export function loadZernioConfig(): ZernioConfigState {
  try {
    const raw = localStorage.getItem(ZERNIO_CFG_KEY);
    if (!raw) return { ...DEFAULT_ZERNIO_CONFIG };
    return { ...DEFAULT_ZERNIO_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_ZERNIO_CONFIG };
  }
}

export function saveZernioConfig(cfg: ZernioConfigState): void {
  try {
    localStorage.setItem(ZERNIO_CFG_KEY, JSON.stringify(cfg));
  } catch {
    /* ignore */
  }
}

export function loadLocalPosts(): ScheduledPost[] {
  try {
    const raw = localStorage.getItem(POSTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveLocalPosts(posts: ScheduledPost[]): void {
  try {
    localStorage.setItem(POSTS_STORAGE_KEY, JSON.stringify(posts));
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ */
/*  Europe/Berlin Timezone Formatting & Slot Helper                    */
/* ------------------------------------------------------------------ */

export function getBerlinParts(date: Date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) {
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

export function berlinWallTimeToISO(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0
): string {
  const approxUTC = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const berlin = getBerlinParts(approxUTC);
  const desiredMinutes = hour * 60 + minute;
  const actualMinutes = berlin.hour * 60 + berlin.minute;
  let diffMinutes = desiredMinutes - actualMinutes;
  if (diffMinutes > 720) diffMinutes -= 1440;
  if (diffMinutes < -720) diffMinutes += 1440;

  const exactUTC = new Date(approxUTC.getTime() + diffMinutes * 60 * 1000);
  return exactUTC.toISOString();
}

export function getBerlinSlotKey(isoString: string): string {
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return "";
  const p = getBerlinParts(d);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
}

export function formatBerlinDateTime(isoString: string): {
  dateStr: string;
  timeStr: string;
  fullStr: string;
  weekdayStr: string;
} {
  const d = new Date(isoString);
  if (isNaN(d.getTime())) {
    return { dateStr: "—", timeStr: "—", fullStr: "—", weekdayStr: "—" };
  }
  const dateStr = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);

  const timeStr = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);

  const weekdayStr = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    weekday: "short",
  }).format(d);

  return {
    dateStr,
    timeStr: `${timeStr} Uhr`,
    fullStr: `${weekdayStr}, ${dateStr} · ${timeStr} Uhr`,
    weekdayStr,
  };
}

/**
 * Finds the next `count` (default 10) free slots at 06:00 and 20:00 in Europe/Berlin.
 * Never overwrites or double-books any existing scheduled post.
 */
export function findNextFreeBerlinSlots(
  existingPosts: ScheduledPost[],
  count = 10
): { scheduledAt: string; berlinKey: string }[] {
  const occupiedKeys = new Set(
    existingPosts
      .filter((p) => p && p.scheduledAt)
      .map((p) => getBerlinSlotKey(p.scheduledAt))
  );

  const now = new Date();
  const nowBerlin = getBerlinParts(now);
  const slots: { scheduledAt: string; berlinKey: string }[] = [];

  let dayOffset = 0;
  while (slots.length < count && dayOffset < 365) {
    const baseDate = new Date(
      Date.UTC(nowBerlin.year, nowBerlin.month - 1, nowBerlin.day + dayOffset, 12, 0, 0)
    );
    const bDay = getBerlinParts(baseDate);

    for (const hour of [6, 20]) {
      if (slots.length >= count) break;

      const slotISO = berlinWallTimeToISO(bDay.year, bDay.month, bDay.day, hour, 0);
      const slotDate = new Date(slotISO);

      if (slotDate.getTime() <= now.getTime() + 2 * 60 * 1000) {
        continue;
      }

      const key = getBerlinSlotKey(slotISO);
      if (!occupiedKeys.has(key)) {
        occupiedKeys.add(key);
        slots.push({
          scheduledAt: slotISO,
          berlinKey: key,
        });
      }
    }

    dayOffset += 1;
  }

  return slots;
}

/* ------------------------------------------------------------------ */
/*  API & Local Fallback Operations                                    */
/* ------------------------------------------------------------------ */

export async function fetchScheduledPosts(): Promise<{
  posts: ScheduledPost[];
  hasApiKey: boolean;
}> {
  const local = loadLocalPosts();
  try {
    const res = await fetch("/api/zernio", { method: "GET" });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.posts)) {
        // Merge server and local posts by ID
        const map = new Map<string, ScheduledPost>();
        for (const p of local) map.set(p.id, p);
        for (const p of data.posts) map.set(p.id, p);
        const merged = Array.from(map.values()).sort(
          (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
        );
        saveLocalPosts(merged);
        return { posts: merged, hasApiKey: Boolean(data.hasApiKey) };
      }
    }
  } catch {
    /* fallback to local storage if backend route is unreachable */
  }
  return { posts: local, hasApiKey: false };
}

export interface ScheduleBatchInputItem {
  videoUrl: string;
  thumbnailUrl?: string;
  title: string;
  description: string;
  hashtags: string[];
}

/** How the user wants the batch to go out. */
export type ScheduleMode = "now" | "auto" | "custom";

export interface SchedulePlanOptions {
  mode: ScheduleMode;
  /** how many posts to create (default 10) */
  count?: number;
  /** custom mode: daily times in Berlin wall-clock, e.g. ["06:00","20:00"] */
  times?: string[];
  /** custom mode: first day to schedule on, "YYYY-MM-DD" (Berlin) */
  startDate?: string;
  /** custom mode: only schedule every N-th day (1 = daily) */
  dayStep?: number;
}

/** Parse "HH:mm" → [hour, minute]; invalid input falls back to 06:00. */
function parseTime(t: string): [number, number] {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) return [6, 0];
  return [
    Math.min(23, Math.max(0, Number(m[1]))),
    Math.min(59, Math.max(0, Number(m[2]))),
  ];
}

/**
 * Flexible slot planner. Honours arbitrary daily times, a start date and a day
 * step, and still guarantees no slot is ever double-booked.
 */
export function findFlexibleBerlinSlots(
  existingPosts: ScheduledPost[],
  opts: SchedulePlanOptions
): { scheduledAt: string; berlinKey: string }[] {
  const count = opts.count ?? 10;
  const times = (opts.times?.length ? opts.times : ["06:00", "20:00"]).map(parseTime);
  const dayStep = Math.max(1, opts.dayStep ?? 1);

  const occupied = new Set(
    existingPosts.filter((p) => p?.scheduledAt).map((p) => getBerlinSlotKey(p.scheduledAt))
  );

  const now = new Date();
  let anchor = getBerlinParts(now);
  if (opts.startDate) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(opts.startDate);
    if (m) {
      anchor = {
        ...anchor,
        year: Number(m[1]),
        month: Number(m[2]),
        day: Number(m[3]),
      };
    }
  }

  const slots: { scheduledAt: string; berlinKey: string }[] = [];
  let dayIndex = 0;

  while (slots.length < count && dayIndex < 400) {
    const base = new Date(
      Date.UTC(anchor.year, anchor.month - 1, anchor.day + dayIndex * dayStep, 12, 0, 0)
    );
    const bDay = getBerlinParts(base);

    for (const [hour, minute] of times) {
      if (slots.length >= count) break;
      const iso = berlinWallTimeToISO(bDay.year, bDay.month, bDay.day, hour, minute);
      if (new Date(iso).getTime() <= now.getTime() + 2 * 60 * 1000) continue;
      const key = getBerlinSlotKey(iso);
      if (occupied.has(key)) continue;
      occupied.add(key);
      slots.push({ scheduledAt: iso, berlinKey: key });
    }
    dayIndex += 1;
  }

  return slots;
}

/** Immediate publishing: stagger slightly so platforms don't rate-limit. */
export function buildImmediateSlots(
  count: number
): { scheduledAt: string; berlinKey: string }[] {
  const out: { scheduledAt: string; berlinKey: string }[] = [];
  for (let i = 0; i < count; i++) {
    const iso = new Date(Date.now() + (i * 90 + 60) * 1000).toISOString();
    out.push({ scheduledAt: iso, berlinKey: getBerlinSlotKey(iso) });
  }
  return out;
}

export function planSlots(
  existingPosts: ScheduledPost[],
  opts: SchedulePlanOptions
): { scheduledAt: string; berlinKey: string }[] {
  const count = opts.count ?? 10;
  if (opts.mode === "now") return buildImmediateSlots(count);
  if (opts.mode === "custom") return findFlexibleBerlinSlots(existingPosts, opts);
  return findNextFreeBerlinSlots(existingPosts, count);
}

export async function scheduleBatchTenPosts(opts: {
  items: ScheduleBatchInputItem[];
  config: ZernioConfigState;
  plan?: SchedulePlanOptions;
}): Promise<{
  createdPosts: ScheduledPost[];
  allPosts: ScheduledPost[];
  hasApiKey: boolean;
}> {
  const current = loadLocalPosts();
  const plan: SchedulePlanOptions = opts.plan ?? { mode: "auto", count: 10 };
  const count = plan.count ?? 10;
  const platforms =
    opts.config.defaultPlatforms.length > 0
      ? opts.config.defaultPlatforms
      : (["tiktok", "instagram", "youtube"] as SocialPlatform[]);

  try {
    const res = await fetch("/api/zernio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "schedule-batch",
        clientPosts: current,
        videos: opts.items,
        platforms,
        plan,
        accountIds: {
          tiktok: opts.config.tiktokAccountId,
          instagram: opts.config.instagramAccountId,
          youtube: opts.config.youtubeAccountId,
        },
      }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data?.ok && Array.isArray(data.posts)) {
        // If user enabled error simulation for testing Zernio failure handling:
        let finalPosts: ScheduledPost[] = data.posts;
        if (opts.config.simulateErrorOnNextPost && data.createdPosts?.length > 0) {
          const targetId = data.createdPosts[0].id;
          finalPosts = finalPosts.map((p) =>
            p.id === targetId
              ? {
                  ...p,
                  status: "Fehler",
                  errorMessage:
                    "Zernio API Ablehnung: Ungültiges OAuth-Token oder Rate-Limit für diesen Kanal erreicht. Bitte erneut versuchen.",
                }
              : p
          );
        }
        saveLocalPosts(finalPosts);
        return {
          createdPosts: data.createdPosts || [],
          allPosts: finalPosts,
          hasApiKey: Boolean(data.hasApiKey),
        };
      }
    }
  } catch {
    /* fallback to local slot engine if serverless function is offline */
  }

  // Pure local fallback — same Europe/Berlin engine, honouring the chosen plan
  const freeSlots = planSlots(current, plan);
  const nowIso = new Date().toISOString();
  const createdPosts: ScheduledPost[] = [];

  for (let i = 0; i < count; i++) {
    const slot = freeSlots[i];
    if (!slot) break;
    const item = opts.items[i % Math.max(1, opts.items.length)];
    const platform = platforms[i % platforms.length];
    const isSimulatedErr = opts.config.simulateErrorOnNextPost && i === 0;

    const newPost: ScheduledPost = {
      id: `post_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 7)}`,
      videoUrl: item?.videoUrl || "",
      thumbnailUrl: item?.thumbnailUrl || "",
      title: item?.title || `Short Story #${i + 1}`,
      description: item?.description || "Automatisch geplant über ShortsFactory & Zernio API.",
      hashtags: item?.hashtags || ["#shorts", "#viral", "#redditstories"],
      platform,
      scheduledAt: slot.scheduledAt,
      berlinSlotKey: slot.berlinKey,
      status: isSimulatedErr
        ? "Fehler"
        : plan.mode === "now"
          ? "Wird veröffentlicht"
          : "Geplant",
      zernioPostId: isSimulatedErr ? null : `zernio_${Date.now()}_${i}`,
      errorMessage: isSimulatedErr
        ? "Zernio API Fehler: Verbindung zu Zielkanal temporär abgelehnt."
        : null,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    createdPosts.push(newPost);
  }

  const allPosts = [...current, ...createdPosts].sort(
    (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
  );
  saveLocalPosts(allPosts);

  return {
    createdPosts,
    allPosts,
    hasApiKey: false,
  };
}

export async function retryScheduledPost(postId: string): Promise<ScheduledPost[]> {
  const current = loadLocalPosts();
  try {
    const res = await fetch("/api/zernio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "retry-post",
        postId,
        clientPosts: current,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.posts)) {
        saveLocalPosts(data.posts);
        return data.posts;
      }
    }
  } catch {
    /* fallback below */
  }

  const nextSlot = findNextFreeBerlinSlots(current, 1)[0];
  const updated = current.map((p) => {
    if (p.id !== postId) return p;
    const isPast = new Date(p.scheduledAt).getTime() <= Date.now() + 60_000;
    const newSched = isPast && nextSlot ? nextSlot.scheduledAt : p.scheduledAt;
    return {
      ...p,
      status: "Geplant" as PostStatus,
      scheduledAt: newSched,
      berlinSlotKey: getBerlinSlotKey(newSched),
      errorMessage: null,
      zernioPostId: p.zernioPostId || `zernio_retry_${Date.now()}`,
      updatedAt: new Date().toISOString(),
    };
  });
  saveLocalPosts(updated);
  return updated;
}

export async function deleteScheduledPost(postId: string): Promise<ScheduledPost[]> {
  const current = loadLocalPosts();
  try {
    const res = await fetch("/api/zernio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "delete-post",
        postId,
        clientPosts: current,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.posts)) {
        saveLocalPosts(data.posts);
        return data.posts;
      }
    }
  } catch {
    /* fallback below */
  }

  const updated = current.filter((p) => p.id !== postId);
  saveLocalPosts(updated);
  return updated;
}

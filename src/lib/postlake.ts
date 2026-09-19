/**
 * Postlake-Client (Frontend).
 *
 * Spricht ausschließlich mit der gleichnamigen Route /api/postlake — der
 * POSTLAKE_API_KEY bleibt auf dem Server und erreicht dieses Bundle nie.
 * Ergebnisse werden in localStorage gespiegelt, damit Kalender & Dashboard
 * auch ohne Key/Netz rendern; Postlake bleibt die Quelle der Wahrheit.
 */

export type LakeState =
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

export interface LakeTarget {
  account: string;
  platform: string;
  state: string;
  url?: string | null;
  permalinkPending?: boolean;
  publishedAt?: string | null;
  error?: { message?: string; type?: string } | string | null;
}

export interface LakePost {
  /** lokale ID (idempotenter Schlüssel-Anker) */
  id: string;
  /** Postlake-ID (post_…) — null solange nur lokal */
  postlakeId: string | null;
  text: string;
  title: string;
  hashtags: string[];
  mediaIds: string[];
  /** Vorschau-URL (Supabase/Blob) — nur für Kalender-Vorschau */
  previewUrl?: string;
  accounts: string[];
  platforms: string[];
  state: LakeState;
  status: PostStatus;
  /** UTC-ISO (Feuerzeitpunkt) bzw. Erstellzeitpunkt bei Sofort-Posts */
  scheduledAt: string;
  scheduledAtLocal?: string;
  timezone: string;
  targets: LakeTarget[];
  warnings?: string[];
  errorMessage?: string | null;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
  /** true = existiert nur lokal (kein Key / offline erstellt) */
  local?: boolean;
  /** Versandweg: Postlake (Standard) oder Buffer (1 Video = N Kanal-Mutationen) */
  provider?: "postlake" | "buffer";
  /** Buffer-Post-IDs (eine pro Kanal) — nur bei provider „buffer" */
  bufferPostIds?: string[];
  /** Öffentliche Video-URL (Buffer-Hosting via Supabase) — nur bei „buffer" */
  videoUrl?: string;
}

export interface LakeAccount {
  id: string;
  platform: string;
  handle: string;
  name: string;
  avatarUrl?: string;
  profileId?: string;
  status: string;
}

export interface LakeCredits {
  total?: number;
  monthly?: number;
  pack?: number;
  monthlyAllowance?: number;
  plan?: string;
  blockedPlatforms?: string[];
}

export interface LakeAnalytics {
  impressions?: number;
  reach?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  clicks?: number;
  followers?: number;
  posts?: number;
  byPlatform?: { platform: string; metrics: Record<string, number> }[];
  byPost?: { postId: string; title?: string; metrics: Record<string, number> }[];
  raw?: unknown;
}

export const POSTLAKE_DASHBOARD = "https://app.postlake.dev/app";

/* ------------------------------------------------------------------ */
/*  Status-Mapping Postlake → UI                                        */
/* ------------------------------------------------------------------ */

export function mapLakeState(s: string | undefined | null): { state: LakeState; status: PostStatus } {
  const v = String(s || "").toLowerCase();
  switch (v) {
    case "published":
      return { state: "published", status: "Veröffentlicht" };
    case "partial":
      return { state: "partial", status: "Teils veröffentlicht" };
    case "failed":
      return { state: "failed", status: "Fehler" };
    case "processing":
      return { state: "processing", status: "Wird veröffentlicht" };
    case "scheduled":
      return { state: "scheduled", status: "Geplant" };
    case "queued":
      return { state: "queued", status: "Geplant" };
    case "draft":
      return { state: "draft", status: "Entwurf" };
    default:
      return { state: "queued", status: "Geplant" };
  }
}

function targetError(t: LakeTarget): string | null {
  if (!t?.error) return null;
  if (typeof t.error === "string") return t.error;
  return t.error.message || t.error.type || null;
}

/** Remote-Post (Postlake-Shape) + lokale Hülle → LakePost mergen. */
export function mergeRemotePost(local: LakePost, remote: Record<string, unknown>): LakePost {
  const { state, status } = mapLakeState(remote?.state as string);
  const targets = Array.isArray(remote?.targets) ? (remote.targets as LakeTarget[]) : local.targets;
  const firstErr = targets.map(targetError).find(Boolean) || null;
  const nowIso = new Date().toISOString();
  return {
    ...local,
    postlakeId: (remote?.id as string) || local.postlakeId,
    state,
    status,
    targets,
    scheduledAt:
      (remote?.scheduledAt as string) ||
      (remote?.publishedAt as string) ||
      (remote?.createdAt as string) ||
      local.scheduledAt,
    scheduledAtLocal: (remote?.scheduledAtLocal as string) || local.scheduledAtLocal,
    errorMessage: status === "Fehler" || status === "Teils veröffentlicht" ? firstErr : null,
    updatedAt: nowIso,
    local: false,
  };
}

/* ------------------------------------------------------------------ */
/*  Persistenz (lokaler Spiegel)                                        */
/* ------------------------------------------------------------------ */

const POSTS_KEY = "shortsfactory.postlake_posts.v1";
const PREFS_KEY = "shortsfactory.postlake_prefs.v1";

export function loadCachedPosts(): LakePost[] {
  try {
    const raw = localStorage.getItem(POSTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveCachedPosts(posts: LakePost[]): void {
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

export interface PostlakePrefs {
  platforms: SocialPlatform[];
  /** Wunsch-Account je Plattform (acc_…); leer = erster verbundener */
  accountIds: Partial<Record<SocialPlatform, string>>;
  /** Wunsch-Kanal je Plattform für Buffer (channelId); leer = erster verbundener */
  bufferAccountIds: Partial<Record<SocialPlatform, string>>;
  mode: PostMode;
  preferredTimes: string[];
  caption: string;
  hashtags: string;
  timezone: string;
}

export const DEFAULT_PREFS: PostlakePrefs = {
  platforms: ["tiktok", "instagram", "youtube"],
  accountIds: {},
  bufferAccountIds: {},
  mode: "now",
  preferredTimes: ["06:00", "20:00"],
  caption:
    "You won't believe how this story ends...\nStay until the end because the plot twist is INSANE.\nWould you have done the same?",
  hashtags: "#reddit #redditstories #storytime #stories #fyp",
  timezone: "Europe/Berlin",
};

export function loadPrefs(): PostlakePrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return structuredClone(DEFAULT_PREFS);
    const parsed = JSON.parse(raw) as Partial<PostlakePrefs>;
    const platforms = (Array.isArray(parsed.platforms) ? parsed.platforms : []).filter(
      (p): p is SocialPlatform => p === "tiktok" || p === "instagram" || p === "youtube"
    );
    return {
      ...structuredClone(DEFAULT_PREFS),
      ...parsed,
      platforms: platforms.length > 0 ? platforms : [...DEFAULT_PREFS.platforms],
      accountIds: parsed.accountIds || {},
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

export function savePrefs(p: PostlakePrefs): void {
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

/** UTC-ISO → naive Wandzeit "YYYY-MM-DDTHH:mm:ss" in `timeZone` (für scheduledAt). */
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
  existing: LakePost[],
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
/*  API-Aufrufe (alle über /api/postlake)                               */
/* ------------------------------------------------------------------ */

async function call<T>(payload: Record<string, unknown>): Promise<T & { ok: boolean; error?: string }> {
  const res = await fetch("/api/postlake", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return (await res.json()) as T & { ok: boolean; error?: string };
}

export interface PostlakeStatus {
  hasApiKey: boolean;
  apiStatus: "connected" | "missing_key" | "invalid_key" | "unreachable" | "configured";
  me: { email?: string; timezone?: string } | null;
  credits: LakeCredits | null;
  billing: { mode?: string; isSubscriber?: boolean } | null;
  accounts: LakeAccount[];
  keyError?: string;
}

export async function fetchStatus(): Promise<PostlakeStatus> {
  try {
    const res = await fetch("/api/postlake?action=status");
    const data = await res.json();
    return {
      hasApiKey: Boolean(data?.hasApiKey),
      apiStatus: data?.apiStatus || "missing_key",
      me: data?.me ?? null,
      credits: data?.credits ?? null,
      billing: data?.billing ?? null,
      accounts: Array.isArray(data?.accounts) ? data.accounts : [],
      keyError: data?.keyError,
    };
  } catch (e) {
    return {
      hasApiKey: false,
      apiStatus: "unreachable",
      me: null,
      credits: null,
      billing: null,
      accounts: [],
      keyError: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Löst je gewünschter Plattform genau 1 Account-ID auf:
 * gespeicherte Auswahl zuerst, sonst erster verbundener Kanal.
 */
export function resolveAccountIds(
  platforms: SocialPlatform[],
  accounts: LakeAccount[],
  overrides: Partial<Record<SocialPlatform, string>>
): { ids: string[]; missing: SocialPlatform[]; byPlatform: Partial<Record<SocialPlatform, string>> } {
  const ids: string[] = [];
  const missing: SocialPlatform[] = [];
  const byPlatform: Partial<Record<SocialPlatform, string>> = {};
  for (const p of platforms) {
    const wanted = (overrides[p] || "").trim();
    const hit =
      (wanted && accounts.find((a) => a.id === wanted)) ||
      accounts.find((a) => a.platform === p && a.status !== "disconnected") ||
      accounts.find((a) => a.platform === p);
    if (hit) {
      ids.push(hit.id);
      byPlatform[p] = hit.id;
    } else {
      missing.push(p);
    }
  }
  return { ids, missing, byPlatform };
}

export interface CreateJob {
  localId: string;
  text: string;
  title: string;
  hashtags: string[];
  accounts: string[];
  media: string[];
  previewUrl?: string;
  scheduledAt?: string;
  timezone?: string;
  idempotencyKey: string;
}

export interface CreateResult {
  ok: boolean;
  localId: string;
  post?: Record<string, unknown>;
  warnings?: string[];
  error?: string;
}

/** Lokaler LakePost-Spiegel für einen Job (Offline-/No-Key-Fallback). */
export function makeLocalPost(job: CreateJob, nowIso = new Date().toISOString()): LakePost {
  let scheduledAt = nowIso;
  if (job.scheduledAt) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(job.scheduledAt);
    if (m) {
      scheduledAt = wallTimeToISO(+m[1], +m[2], +m[3], +m[4], +m[5], job.timezone || "Europe/Berlin");
    }
  }
  return {
    id: job.localId,
    postlakeId: null,
    text: job.text,
    title: job.title,
    hashtags: job.hashtags,
    mediaIds: job.media,
    previewUrl: job.previewUrl,
    accounts: job.accounts,
    platforms: [],
    state: job.scheduledAt ? "scheduled" : "processing",
    status: job.scheduledAt ? "Geplant" : "Wird veröffentlicht",
    scheduledAt,
    timezone: job.timezone || "Europe/Berlin",
    targets: job.accounts.map((a) => ({ account: a, platform: "", state: "queued" })),
    idempotencyKey: job.idempotencyKey,
    createdAt: nowIso,
    updatedAt: nowIso,
    local: true,
    provider: "postlake",
  };
};

/**
 * Postet 1..N Videos über Postlake (je 1 Call, Fan-out auf alle Kanäle).
 * Legt lokale LakePost-Spiegel an und mergt Remote-Antworten ein.
 */
export async function createPosts(jobs: CreateJob[]): Promise<{
  posts: LakePost[];
  created: number;
  failed: number;
  hasApiKey: boolean;
  error?: string;
}> {
  const cached = loadCachedPosts();
  const nowIso = new Date().toISOString();
  const toLocal = (job: CreateJob): LakePost => makeLocalPost(job, nowIso);

  try {
    const data = await call<{
      results: CreateResult[];
      created: number;
      failed: number;
      hasApiKey: boolean;
    }>({ action: "create-batch", jobs });

    // Kein Key auf dem Server → alles lokal behalten, nichts geht verloren.
    if (!data.ok && data.hasApiKey === false) {
      const locals = jobs.map(toLocal);
      const merged = [...locals, ...cached].slice(0, 500);
      saveCachedPosts(merged);
      return { posts: merged, created: 0, failed: 0, hasApiKey: false, error: data.error };
    }

    const posts = jobs.map((job) => {
      const base = toLocal(job);
      const r = (data.results || []).find((x) => x.localId === job.localId);
      if (!r) return { ...base, state: "failed" as LakeState, status: "Fehler" as PostStatus, errorMessage: "Keine Antwort von Postlake." };
      if (!r.ok || !r.post) {
        return {
          ...base,
          state: "failed" as LakeState,
          status: "Fehler" as PostStatus,
          errorMessage: r.error || "Postlake-Fehler.",
          local: false,
        };
      }
      const merged = mergeRemotePost(base, r.post as Record<string, unknown>);
      merged.warnings = r.warnings && r.warnings.length > 0 ? r.warnings : undefined;
      merged.platforms = merged.targets.map((t) => t.platform).filter(Boolean);
      // Targets ohne Plattformnamen mit Job-Kontext anreichern
      return merged;
    });

    // Plattformnamen der Targets nachtragen (für Kalender-Badges)
    const mergedAll = [...posts, ...cached].slice(0, 500);
    saveCachedPosts(mergedAll);
    return {
      posts: mergedAll,
      created: data.created ?? posts.filter((p) => p.status !== "Fehler").length,
      failed: data.failed ?? posts.filter((p) => p.status === "Fehler").length,
      hasApiKey: true,
      error: data.error,
    };
  } catch (e) {
    const locals = jobs.map(toLocal);
    const merged = [...locals, ...cached].slice(0, 500);
    saveCachedPosts(merged);
    return {
      posts: merged,
      created: 0,
      failed: 0,
      hasApiKey: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Offene Posts bei Postlake pollen und mergen (processing/scheduled/queued). */
export async function refreshOpenPosts(): Promise<{ posts: LakePost[]; refreshed: number }> {
  const cached = loadCachedPosts();
  const open = cached.filter(
    (p) => p.postlakeId && ["Geplant", "Wird veröffentlicht", "Entwurf"].includes(p.status)
  );
  if (open.length === 0) return { posts: cached, refreshed: 0 };
  try {
    const data = await call<{ posts: Record<string, unknown>[] }>({
      action: "refresh",
      ids: open.map((p) => p.postlakeId),
    });
    if (!data.ok || !Array.isArray(data.posts)) return { posts: cached, refreshed: 0 };
    const byId = new Map<string, Record<string, unknown>>();
    for (const r of data.posts) {
      if (r && typeof r.id === "string") byId.set(r.id, r);
    }
    let refreshed = 0;
    const merged = cached.map((p) => {
      const remote = p.postlakeId ? byId.get(p.postlakeId) : undefined;
      if (!remote) return p;
      refreshed++;
      return mergeRemotePost(p, remote);
    });
    saveCachedPosts(merged);
    return { posts: merged, refreshed };
  } catch {
    return { posts: cached, refreshed: 0 };
  }
}

/** Postliste von Postlake holen (Quelle der Wahrheit) + lokale Entwürfe dazu. */
export async function syncPostsFromLake(opts?: {
  state?: string;
  account?: string;
  limit?: number;
}): Promise<{ posts: LakePost[]; hasApiKey: boolean; error?: string }> {
  const cached = loadCachedPosts();
  try {
    const data = await call<{ posts: Record<string, unknown>[] }>({
      action: "list-posts",
      ...(opts?.state ? { state: opts.state } : {}),
      ...(opts?.account ? { account: opts.account } : {}),
      limit: opts?.limit ?? 100,
    });
    if (!data.ok || !Array.isArray(data.posts)) {
      return { posts: cached, hasApiKey: true, error: data.error };
    }
    const byId = new Map(cached.map((p) => [p.postlakeId || p.id, p]));
    const synced: LakePost[] = data.posts.map((r) => {
      const id = String(r.id || "");
      const { state, status } = mapLakeState(r.state as string);
      const prev = byId.get(id);
      const nowIso = new Date().toISOString();
      const targets = Array.isArray(r.targets) ? (r.targets as LakeTarget[]) : [];
      return {
        id: prev?.id || id,
        postlakeId: id,
        text: (r.text as string) || prev?.text || "",
        title: prev?.title || String(r.text || "").split("\n")[0].slice(0, 90) || "Post",
        hashtags: prev?.hashtags || [],
        mediaIds: (Array.isArray(r.media) ? (r.media as string[]) : prev?.mediaIds) || [],
        previewUrl: prev?.previewUrl,
        accounts: targets.map((t) => t.account).filter(Boolean),
        platforms: targets.map((t) => t.platform).filter(Boolean),
        state,
        status,
        scheduledAt:
          (r.scheduledAt as string) ||
          (r.publishedAt as string) ||
          (r.createdAt as string) ||
          prev?.scheduledAt ||
          nowIso,
        scheduledAtLocal: (r.scheduledAtLocal as string) || prev?.scheduledAtLocal,
        timezone: (r.timezone as string) || prev?.timezone || "Europe/Berlin",
        targets,
        warnings: Array.isArray(r.warnings) ? (r.warnings as string[]) : undefined,
        errorMessage: status === "Fehler" ? targets.map((t) => targetError(t)).find(Boolean) || null : null,
        idempotencyKey: prev?.idempotencyKey || `lake_${id}`,
        createdAt: (r.createdAt as string) || prev?.createdAt || nowIso,
        updatedAt: nowIso,
        local: false,
        provider: "postlake",
      } as LakePost;
    });
    // Lokal-nur-Einträge (ohne postlakeId) bleiben erhalten
    const localOnly = cached.filter((p) => !p.postlakeId);
    const merged = [...synced, ...localOnly]
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
      .slice(0, 500);
    saveCachedPosts(merged);
    return { posts: merged, hasApiKey: true };
  } catch (e) {
    return { posts: cached, hasApiKey: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Geplanten Post stornieren (remote DELETE + lokal entfernen). */
export async function cancelPost(post: LakePost): Promise<LakePost[]> {
  if (post.postlakeId && !post.local) {
    try {
      await call({ action: "cancel", id: post.postlakeId });
    } catch {
      /* trotzdem lokal entfernen */
    }
  }
  const next = loadCachedPosts().filter((p) => p.id !== post.id);
  saveCachedPosts(next);
  return next;
}

/** Geplanten Post umplanen (PATCH scheduledAt + timezone). */
export async function reschedulePost(
  post: LakePost,
  naiveLocal: string,
  timezone: string
): Promise<{ posts: LakePost[]; error?: string }> {
  const cached = loadCachedPosts();
  const applyLocal = (p: LakePost) => {
    const [d, t] = naiveLocal.split("T");
    const [y, m, dd] = d.split("-").map(Number);
    const [hh, mm] = (t || "06:00").split(":").map(Number);
    const iso = wallTimeToISO(y, m, dd, hh, mm || 0, timezone);
    return { ...p, scheduledAt: iso, scheduledAtLocal: naiveLocal, timezone, updatedAt: new Date().toISOString() };
  };
  if (!post.postlakeId || post.local) {
    const next = cached.map((p) => (p.id === post.id ? applyLocal(p) : p));
    saveCachedPosts(next);
    return { posts: next };
  }
  try {
    const data = await call<{ post: Record<string, unknown> }>({
      action: "edit",
      id: post.postlakeId,
      patch: { scheduledAt: naiveLocal, timezone },
    });
    if (!data.ok) return { posts: cached, error: data.error };
    const next = cached.map((p) =>
      p.id === post.id ? mergeRemotePost(applyLocal(p), (data.post || {}) as Record<string, unknown>) : p
    );
    saveCachedPosts(next);
    return { posts: next };
  } catch (e) {
    return { posts: cached, error: e instanceof Error ? e.message : String(e) };
  }
}

export function updateCachedPost(id: string, patch: Partial<LakePost>): LakePost[] {
  const next = loadCachedPosts().map((p) =>
    p.id === id ? { ...p, ...patch, updatedAt: new Date().toISOString() } : p
  );
  saveCachedPosts(next);
  return next;
}

/* ------------------------------------------------------------------ */
/*  Analytics                                                           */
/* ------------------------------------------------------------------ */

export type AnalyticsPeriod = "7d" | "30d" | "90d";

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Roll-up-Antwort defensiv in LakeAnalytics normalisieren. */
export function normalizeAnalytics(data: unknown): LakeAnalytics {
  if (!data || typeof data !== "object") return {};
  const d = data as Record<string, unknown>;
  const m = (d.metrics && typeof d.metrics === "object" ? d.metrics : d) as Record<string, unknown>;
  const byPlatform = Array.isArray(d.byPlatform)
    ? (d.byPlatform as { platform: string; metrics: Record<string, number> }[])
    : Array.isArray(d.platforms)
      ? (d.platforms as { platform: string; metrics: Record<string, number> }[])
      : undefined;
  const byPost = Array.isArray(d.byPost)
    ? (d.byPost as { postId: string; title?: string; metrics: Record<string, number> }[])
    : Array.isArray(d.posts)
      ? (d.posts as { postId: string; title?: string; metrics: Record<string, number> }[])
      : undefined;
  return {
    impressions: num(m.impressions ?? m.views),
    reach: num(m.reach),
    likes: num(m.likes),
    comments: num(m.comments),
    shares: num(m.shares ?? m.reposts),
    saves: num(m.saves ?? m.bookmarks),
    clicks: num(m.clicks),
    followers: num(m.followers),
    posts: num(d.posts === undefined ? m.posts : Array.isArray(d.posts) ? d.posts.length : d.posts),
    byPlatform,
    byPost,
    raw: data,
  };
}

export async function fetchAnalytics(period: AnalyticsPeriod): Promise<{
  analytics: LakeAnalytics | null;
  hasApiKey: boolean;
  error?: string;
}> {
  try {
    const data = await call<{ analytics: unknown }>({ action: "analytics", period });
    if (!data.ok) return { analytics: null, hasApiKey: true, error: data.error };
    return { analytics: normalizeAnalytics(data.analytics), hasApiKey: true };
  } catch (e) {
    return { analytics: null, hasApiKey: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function fetchPostAnalytics(postlakeId: string): Promise<{
  analytics: LakeAnalytics | null;
  error?: string;
}> {
  try {
    const data = await call<{ analytics: unknown }>({ action: "post-analytics", id: postlakeId });
    if (!data.ok) return { analytics: null, error: data.error };
    return { analytics: normalizeAnalytics(data.analytics) };
  } catch (e) {
    return { analytics: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Top-Posts aus Roll-up (byPost) + lokalem Titel-Matching bauen.
 * Sortierschlüssel: views/likes/comments/shares.
 */
export function topPostsFromAnalytics(
  a: LakeAnalytics | null,
  posts: LakePost[],
  sort: "views" | "likes" | "comments" | "shares",
  limit = 8
): { id: string; title: string; platforms: string[]; value: number }[] {
  if (!a?.byPost?.length) return [];
  const key = sort === "views" ? "impressions" : sort;
  const rows = a.byPost.map((p) => {
    const twin = posts.find((l) => l.postlakeId === p.postId || l.id === p.postId);
    const metrics = p.metrics || {};
    return {
      id: p.postId,
      title: p.title || twin?.title || "Post",
      platforms: twin?.platforms || [],
      value: num(metrics[key] ?? metrics.impressions ?? metrics.views ?? 0),
    };
  });
  return rows.sort((x, y) => y.value - x.value).slice(0, limit);
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

export const compactNumber = (n: number) =>
  new Intl.NumberFormat("de-DE", { notation: "compact", maximumFractionDigits: 1 }).format(n || 0);

/** Versände in den letzten 60 Minuten (Stunden-Limit-Anzeige). */
export function countPostsLastHour(posts: LakePost[], now = Date.now()): number {
  return posts.filter((p) => {
    const t = new Date(p.createdAt).getTime();
    return !isNaN(t) && now - t < 3_600_000;
  }).length;
}

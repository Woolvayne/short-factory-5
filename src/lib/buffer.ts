/**
 * Buffer-Client (Frontend).
 *
 * Spricht ausschließlich mit der Route /api/buffer — der BUFFER_API_KEY
 * bleibt auf dem Server und erreicht dieses Bundle nie.
 *
 * Unterschiede zu Postlake (laut developers.buffer.com):
 * - GraphQL, genau EINE channelId pro createPost-Mutation (der Server
 *   fächert 1 Video × N Kanäle in N Mutationen auf).
 * - KEIN Medien-Upload: Videos müssen unter einer öffentlichen, stabilen
 *   HTTPS-URL liegen → Supabase-„renders"-Bucket (siehe upload.ts).
 * - YouTube braucht title + categoryId, Instagram braucht type: reel.
 * - Planen = mode customScheduled + dueAt (ISO UTC, Zukunft);
 *   sofort = mode shareNow.
 *
 * Ergebnisse landen im SELBEN localStorage-Spiegel wie Postlake-Posts
 * (provider: „buffer"), damit Kalender & Dashboard beide Wege zeigen.
 */

import {
  loadCachedPosts,
  saveCachedPosts,
  wallTimeToISO,
  type LakeAccount,
  type LakePost,
  type LakeState,
  type LakeTarget,
  type PostStatus,
  type SocialPlatform,
} from "./postlake";

export const BUFFER_DASHBOARD = "https://publish.buffer.com";
export const BUFFER_API_SETTINGS = "https://publish.buffer.com/settings/api";

/* ------------------------------------------------------------------ */
/*  Status-Mapping Buffer → UI                                          */
/* ------------------------------------------------------------------ */

export function mapBufferState(s: string | undefined | null): {
  state: LakeState;
  status: PostStatus;
} {
  const v = String(s || "").toLowerCase();
  if (["sent", "published", "delivered", "success"].includes(v)) {
    return { state: "published", status: "Veröffentlicht" };
  }
  if (["error", "failed", "failure"].includes(v)) {
    return { state: "failed", status: "Fehler" };
  }
  if (["draft"].includes(v)) {
    return { state: "draft", status: "Entwurf" };
  }
  if (["publishing", "processing", "sending"].includes(v)) {
    return { state: "processing", status: "Wird veröffentlicht" };
  }
  // buffer / scheduled / queued / pending / service / default → geplant
  return { state: "scheduled", status: "Geplant" };
}

/* ------------------------------------------------------------------ */
/*  API-Aufrufe (alle über /api/buffer)                                 */
/* ------------------------------------------------------------------ */

async function call<T>(payload: Record<string, unknown>): Promise<T & { ok: boolean; error?: string }> {
  const res = await fetch("/api/buffer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return (await res.json()) as T & { ok: boolean; error?: string };
}

export interface BufferOrganization {
  id: string;
  name: string;
}

export interface BufferStatus {
  hasApiKey: boolean;
  apiStatus: "connected" | "missing_key" | "invalid_key" | "unreachable";
  me: { email?: string; name?: string } | null;
  organizations: BufferOrganization[];
  accounts: LakeAccount[];
  keyError?: string;
}

export async function fetchBufferStatus(): Promise<BufferStatus> {
  try {
    const res = await fetch("/api/buffer?action=status");
    const data = await res.json();
    return {
      hasApiKey: Boolean(data?.hasApiKey),
      apiStatus: data?.apiStatus || "missing_key",
      me: data?.me ?? null,
      organizations: Array.isArray(data?.organizations) ? data.organizations : [],
      accounts: Array.isArray(data?.accounts) ? data.accounts : [],
      keyError: data?.keyError,
    };
  } catch (e) {
    return {
      hasApiKey: false,
      apiStatus: "unreachable",
      me: null,
      organizations: [],
      accounts: [],
      keyError: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Löst je gewünschter Plattform genau 1 Buffer-Kanal-ID auf:
 * gespeicherte Auswahl zuerst, sonst erster verbundener Kanal.
 */
export function resolveBufferChannelIds(
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

export interface BufferCreateJob {
  localId: string;
  text: string;
  title: string;
  hashtags: string[];
  channelIds: string[];
  videoUrl: string;
  previewUrl?: string;
  /** ISO UTC (Feuerzeitpunkt) — nur bei „Planen" gesetzt */
  scheduledAtISO?: string;
  timezone?: string;
  idempotencyKey: string;
}

interface BufferRemotePost {
  id: string;
  channelId: string;
  platform: string;
  dueAt: string;
  createdAt: string;
  status: string;
  text: string;
}

interface BufferCreateResult {
  ok: boolean;
  localId: string;
  posts?: BufferRemotePost[];
  errors?: { channelId: string; platform: string; error: string }[];
  scheduled?: boolean;
  videoUrl?: string | null;
  error?: string;
}

/** Lokaler LakePost-Spiegel für einen Buffer-Job (Offline-/No-Key-Fallback). */
export function makeBufferLocalPost(job: BufferCreateJob, nowIso = new Date().toISOString()): LakePost {
  const scheduledAt = job.scheduledAtISO || nowIso;
  return {
    id: job.localId,
    postlakeId: null,
    text: job.text,
    title: job.title,
    hashtags: job.hashtags,
    mediaIds: [],
    previewUrl: job.previewUrl,
    accounts: job.channelIds,
    platforms: [],
    state: job.scheduledAtISO ? "scheduled" : "processing",
    status: job.scheduledAtISO ? "Geplant" : "Wird veröffentlicht",
    scheduledAt,
    timezone: job.timezone || "Europe/Berlin",
    targets: job.channelIds.map((a) => ({ account: a, platform: "", state: "queued" })),
    idempotencyKey: job.idempotencyKey,
    createdAt: nowIso,
    updatedAt: nowIso,
    local: true,
    provider: "buffer",
    bufferPostIds: [],
    videoUrl: job.videoUrl,
  };
}

function mergeBufferRemote(base: LakePost, remotes: BufferRemotePost[]): LakePost {
  const nowIso = new Date().toISOString();
  const targets: LakeTarget[] = remotes.map((r) => {
    const { state } = mapBufferState(r.status);
    return { account: r.channelId, platform: r.platform, state };
  });
  // Schlimmster Status gewinnt (Fehler > Wird veröffentlicht > Geplant > Veröffentlicht)
  const rank = (s: PostStatus) =>
    s === "Fehler" ? 4 : s === "Wird veröffentlicht" ? 3 : s === "Geplant" ? 2 : s === "Entwurf" ? 1 : 0;
  let best: PostStatus = "Veröffentlicht";
  let bestState: LakeState = "published";
  for (const r of remotes) {
    const m = mapBufferState(r.status);
    if (rank(m.status) > rank(best)) {
      best = m.status;
      bestState = m.state;
    }
  }
  const firstDue = remotes.map((r) => r.dueAt).filter(Boolean).sort()[0];
  return {
    ...base,
    bufferPostIds: remotes.map((r) => r.id),
    accounts: remotes.map((r) => r.channelId),
    platforms: [...new Set(remotes.map((r) => r.platform).filter(Boolean))],
    targets,
    state: bestState,
    status: best,
    scheduledAt: firstDue || base.scheduledAt,
    updatedAt: nowIso,
    local: false,
  };
}

/**
 * Postet 1..N Videos über Buffer (Server fächert je Kanal auf).
 * Legt lokale LakePost-Spiegel an und mergt Remote-Antworten ein.
 */
export async function createBufferPosts(jobs: BufferCreateJob[]): Promise<{
  posts: LakePost[];
  created: number;
  failed: number;
  hasApiKey: boolean;
  error?: string;
}> {
  const cached = loadCachedPosts();
  const nowIso = new Date().toISOString();

  try {
    const data = await call<{
      results: BufferCreateResult[];
      created: number;
      failed: number;
      hasApiKey: boolean;
    }>({ action: "create-batch", jobs });

    // Kein Key auf dem Server → alles lokal behalten, nichts geht verloren.
    if (!data.ok && data.hasApiKey === false) {
      const locals = jobs.map((j) => makeBufferLocalPost(j, nowIso));
      const merged = [...locals, ...cached].slice(0, 500);
      saveCachedPosts(merged);
      return { posts: merged, created: 0, failed: 0, hasApiKey: false, error: data.error };
    }

    const posts = jobs.map((job) => {
      const base = makeBufferLocalPost(job, nowIso);
      const r = (data.results || []).find((x) => x.localId === job.localId);
      if (!r) {
        return {
          ...base,
          state: "failed" as LakeState,
          status: "Fehler" as PostStatus,
          errorMessage: "Keine Antwort von Buffer.",
          local: false,
        };
      }
      if (!r.ok || !r.posts || r.posts.length === 0) {
        return {
          ...base,
          state: "failed" as LakeState,
          status: "Fehler" as PostStatus,
          errorMessage: r.error || "Buffer-Fehler.",
          local: false,
        };
      }
      const merged = mergeBufferRemote(base, r.posts);
      // Teilfehler (einzelne Kanäle scheiterten) sichtbar machen
      if (r.errors && r.errors.length > 0) {
        const msg = r.errors.map((e) => `[${e.platform}] ${e.error}`).join(" · ");
        if (merged.status === "Veröffentlicht") {
          merged.state = "partial";
          merged.status = "Teils veröffentlicht";
        }
        merged.errorMessage = msg;
        for (const e of r.errors) {
          merged.targets.push({
            account: e.channelId,
            platform: e.platform,
            state: "failed",
            error: e.error,
          });
        }
      }
      return merged;
    });

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
    const locals = jobs.map((j) => makeBufferLocalPost(j, nowIso));
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

/** Offene Buffer-Posts pollen und mergen (1 Spiegel = N Kanal-Posts). */
export async function refreshOpenBufferPosts(): Promise<{ posts: LakePost[]; refreshed: number }> {
  const cached = loadCachedPosts();
  const open = cached.filter(
    (p) =>
      p.provider === "buffer" &&
      p.bufferPostIds &&
      p.bufferPostIds.length > 0 &&
      ["Geplant", "Wird veröffentlicht", "Entwurf"].includes(p.status)
  );
  if (open.length === 0) return { posts: cached, refreshed: 0 };
  try {
    const ids = [...new Set(open.flatMap((p) => p.bufferPostIds || []))].slice(0, 50);
    const data = await call<{ posts: BufferRemotePost[] }>({ action: "refresh", ids });
    if (!data.ok || !Array.isArray(data.posts)) return { posts: cached, refreshed: 0 };
    const byId = new Map(data.posts.map((r) => [r.id, r]));
    let refreshed = 0;
    const merged = cached.map((p) => {
      if (p.provider !== "buffer" || !p.bufferPostIds?.length) return p;
      const remotes = p.bufferPostIds
        .map((id) => byId.get(id))
        .filter((r): r is BufferRemotePost => Boolean(r));
      if (remotes.length === 0) return p;
      refreshed++;
      return mergeBufferRemote(p, remotes);
    });
    saveCachedPosts(merged);
    return { posts: merged, refreshed };
  } catch {
    return { posts: cached, refreshed: 0 };
  }
}

/**
 * Buffer-Postliste holen und mit dem Cache mergen.
 * Postlake-Posts bleiben unangetastet; lokale Buffer-Entwürfe auch.
 */
export async function syncBufferPosts(opts?: { limit?: number }): Promise<{
  posts: LakePost[];
  hasApiKey: boolean;
  error?: string;
}> {
  const cached = loadCachedPosts();
  try {
    const data = await call<{ posts: BufferRemotePost[] }>({
      action: "list-posts",
      limit: opts?.limit ?? 100,
    });
    if (!data.ok || !Array.isArray(data.posts)) {
      return { posts: cached, hasApiKey: true, error: data.error };
    }
    const nowIso = new Date().toISOString();
    // Buffer liefert 1 Zeile pro Kanal-Post → zu Spiegeln gruppieren.
    // Zuerst nach lokalem Zwilling (stabile bufferPostIds), sonst nach Text+Zeit.
    const byBufferId = new Map<string, LakePost>();
    for (const p of cached) {
      if (p.provider !== "buffer") continue;
      for (const bid of p.bufferPostIds || []) byBufferId.set(bid, p);
    }
    const groups = new Map<string, BufferRemotePost[]>();
    for (const r of data.posts) {
      const twin = byBufferId.get(r.id);
      const key = twin ? `twin:${twin.id}` : `free:${r.text}__${r.dueAt}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    }
    const synced: LakePost[] = [];
    const seenTwin = new Set<string>();
    for (const remotes of groups.values()) {
      const twin = remotes.map((r) => byBufferId.get(r.id)).find(Boolean);
      if (twin) {
        if (seenTwin.has(twin.id)) continue; // derselbe Spiegel nur einmal
        seenTwin.add(twin.id);
      }
      const first = remotes[0];
      const base: LakePost = twin || {
        id: `buf_${first.id}`,
        postlakeId: null,
        text: first.text,
        title: String(first.text || "").split("\n")[0].slice(0, 90) || "Buffer-Post",
        hashtags: [],
        mediaIds: [],
        previewUrl: undefined,
        accounts: [],
        platforms: [],
        state: "scheduled",
        status: "Geplant",
        scheduledAt: first.dueAt,
        timezone: "Europe/Berlin",
        targets: [],
        idempotencyKey: `buf_${first.id}`,
        createdAt: first.createdAt,
        updatedAt: nowIso,
        local: false,
        provider: "buffer",
        bufferPostIds: [],
      };
      synced.push(mergeBufferRemote({ ...base, provider: "buffer" }, remotes));
    }
    // Alles Nicht-Buffer + lokale Buffer-Entwürfe bleiben erhalten
    const keep = cached.filter(
      (p) => p.provider !== "buffer" || !p.bufferPostIds || p.bufferPostIds.length === 0
    );
    const seen = new Set(synced.map((p) => p.id));
    const merged = [...synced, ...keep.filter((p) => !seen.has(p.id))]
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
      .slice(0, 500);
    saveCachedPosts(merged);
    return { posts: merged, hasApiKey: true };
  } catch (e) {
    return { posts: cached, hasApiKey: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Buffer-Spiegel stornieren (alle Kanal-Posts löschen + lokal entfernen). */
export async function cancelBufferPost(post: LakePost): Promise<LakePost[]> {
  if (post.bufferPostIds && post.bufferPostIds.length > 0 && !post.local) {
    try {
      await call({ action: "cancel", ids: post.bufferPostIds });
    } catch {
      /* trotzdem lokal entfernen */
    }
  }
  const next = loadCachedPosts().filter((p) => p.id !== post.id);
  saveCachedPosts(next);
  return next;
}

/** Buffer-Spiegel umbuchen (alle Kanal-Posts auf neues dueAt). */
export async function rescheduleBufferPost(
  post: LakePost,
  naiveLocal: string,
  timezone: string
): Promise<{ posts: LakePost[]; error?: string }> {
  const cached = loadCachedPosts();
  const [d, t] = naiveLocal.split("T");
  const [y, m, dd] = d.split("-").map(Number);
  const [hh, mm] = (t || "06:00").split(":").map(Number);
  const iso = wallTimeToISO(y, m, dd, hh, mm || 0, timezone);
  const applyLocal = (p: LakePost) => ({
    ...p,
    scheduledAt: iso,
    scheduledAtLocal: naiveLocal,
    timezone,
    state: "scheduled" as LakeState,
    status: "Geplant" as PostStatus,
    updatedAt: new Date().toISOString(),
  });
  if (!post.bufferPostIds || post.bufferPostIds.length === 0 || post.local) {
    const next = cached.map((p) => (p.id === post.id ? applyLocal(p) : p));
    saveCachedPosts(next);
    return { posts: next };
  }
  try {
    const data = await call<{ updated: BufferRemotePost[] }>({
      action: "edit",
      ids: post.bufferPostIds,
      patch: { dueAt: iso },
    });
    if (!data.ok) return { posts: cached, error: data.error };
    const next = cached.map((p) => (p.id === post.id ? applyLocal(p) : p));
    saveCachedPosts(next);
    return { posts: next };
  } catch (e) {
    return { posts: cached, error: e instanceof Error ? e.message : String(e) };
  }
}

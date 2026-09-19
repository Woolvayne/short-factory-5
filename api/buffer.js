/**
 * ShortsFactory — Buffer Backend Route (zweiter Post-Weg neben Postlake)
 *
 * Exakt nach der offiziellen Buffer-API-Dokumentation
 * (https://developers.buffer.com — GraphQL, Stand 2026):
 *
 *   Endpoint : POST https://api.buffer.com  (immer POST, GraphQL)
 *   Auth     : Authorization: Bearer <BUFFER_API_KEY> (NUR serverseitig!)
 *   Key      : publish.buffer.com → Settings → API → Generate API key
 *
 *   - query  account { organizations { id name } }  → Orgs finden
 *   - query  channels(input:{organizationId})       → verbundene Kanäle
 *   - mutation createPost(input:{ text, channelId, schedulingType: automatic,
 *              mode: shareNow|customScheduled, dueAt?, assets:[{video:{url}}],
 *              metadata:{ youtube|instagram|tiktok } }) → posten / planen
 *              WICHTIG: genau EIN channelId pro Mutation (Buffer-Limit).
 *   - query  posts(first, input:{organizationId})   → Kalender-Sync
 *   - mutation editPost(input:{ id, mode, dueAt })  → umplanen
 *   - mutation deletePost(input:{ id })             → stornieren / löschen
 *
 * Medien: Buffer hat KEINEN Upload-Endpoint — Videos müssen unter einer
 * öffentlichen, stabilen HTTPS-URL liegen (docs: „Hosting Media"). Die App
 * lädt Render-Bytes daher in den Supabase-„renders"-Bucket hoch und übergibt
 * die Public-URL als assets[].video.url. Signierte/ablaufende URLs sind
 * verboten (Buffer lädt erst beim Publish).
 *
 * Security: BUFFER_API_KEY lebt ausschließlich hier (Vercel Env). Der
 * Browser sieht ihn NIE.
 */

export const config = {
  runtime: "nodejs",
  maxDuration: 60,
};

import { gateBlocked } from "../server/gate-core.js";

const BUFFER_API_URL = "https://api.buffer.com";
const TIMEZONE = "Europe/Berlin";

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function bufferError(data, status) {
  // GraphQL-Fehlerform: { errors: [{ message }] } oder MutationError { message }
  if (Array.isArray(data?.errors) && data.errors.length > 0) {
    return data.errors.map((e) => e?.message || "GraphQL-Fehler").join(" · ").slice(0, 400);
  }
  if (typeof data?.error === "string") return data.error;
  return data?.message || `Buffer API HTTP ${status}`;
}

async function bufferGQL(apiKey, query, variables = {}, { timeoutMs = 20000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(BUFFER_API_URL, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  } finally {
    clearTimeout(timer);
  }
}

/** 429 ehren: genau EIN Retry mit Retry-After (max. 45 s). */
async function bufferGQLRetry(apiKey, query, variables = {}, opts = {}) {
  const first = await bufferGQL(apiKey, query, variables, opts);
  if (first.res.status !== 429) return first;
  const waitSec = Math.min(45, Math.max(1, Number(first.res.headers.get("retry-after")) || 10));
  await new Promise((r) => setTimeout(r, waitSec * 1000));
  return bufferGQL(apiKey, query, variables, opts);
}

function asArray(v) {
  if (Array.isArray(v)) return v;
  return [];
}

function normChannel(c, orgId) {
  if (!c || typeof c !== "object") return null;
  const id = c.id || c.channelId || "";
  if (!id) return null;
  const service = String(c.service || "").toLowerCase();
  const disconnected = Boolean(c.isDisconnected) || Boolean(c.isLocked);
  return {
    id: String(id),
    platform: service,
    service,
    handle: c.name || c.displayName || "",
    name: c.displayName || c.name || service,
    avatarUrl: c.avatar || "",
    profileId: "",
    organizationId: c.organizationId || orgId || "",
    status: disconnected ? "disconnected" : "connected",
  };
}

/* ------------------------------------------------------------------ */
/*  Orgs + Kanäle laden (einmal pro Request, für Mapping)               */
/* ------------------------------------------------------------------ */

const Q_ACCOUNT = `query BufferAccount { account { id email name organizations { id name } } }`;
const Q_CHANNELS = `query BufferChannels($input: ChannelsInput!) {
  channels(input: $input) {
    id name displayName service avatar isDisconnected isLocked organizationId
  }
}`;

async function loadOrgsAndChannels(apiKey) {
  const acc = await bufferGQLRetry(apiKey, Q_ACCOUNT);
  if (!acc.res.ok || acc.data?.errors) {
    const msg = bufferError(acc.data, acc.res.status);
    const err = new Error(msg);
    err.code = acc.res.status === 401 || /unauthori|forbidden|invalid.*key|api key/i.test(msg) ? "invalid_key" : "unreachable";
    throw err;
  }
  const account = acc.data?.data?.account || {};
  const orgs = asArray(account.organizations)
    .filter((o) => o && o.id)
    .map((o) => ({ id: String(o.id), name: o.name || "Workspace" }));

  const channelsById = new Map();
  for (const org of orgs) {
    try {
      const ch = await bufferGQLRetry(apiKey, Q_CHANNELS, { input: { organizationId: org.id } });
      const list = ch.data?.data?.channels;
      for (const c of asArray(list)) {
        const n = normChannel(c, org.id);
        if (n && !channelsById.has(n.id)) channelsById.set(n.id, n);
      }
    } catch {
      /* einzelne Org-Fehler blockieren nicht */
    }
  }
  return {
    me: { email: account.email || "", name: account.name || "" },
    organizations: orgs,
    channels: Array.from(channelsById.values()),
    channelsById,
  };
}

/* ------------------------------------------------------------------ */
/*  Post-Mutationen (1 Video × N Kanäle = N Mutationen)                 */
/* ------------------------------------------------------------------ */

const POST_FIELDS_FULL = `id text dueAt createdAt channelId status`;
const POST_FIELDS_MIN = `id text dueAt channelId`;

function createPostMutation(fields) {
  return `mutation BufferCreatePost($input: CreatePostInput!) {
    createPost(input: $input) {
      ... on PostActionSuccess { post { ${fields} } }
      ... on MutationError { message }
    }
  }`;
}

function editPostMutation(fields) {
  return `mutation BufferEditPost($input: EditPostInput!) {
    editPost(input: $input) {
      ... on PostActionSuccess { post { ${fields} } }
      ... on MutationError { message }
    }
  }`;
}

async function runPostMutation(apiKey, mutationFn, input) {
  // Versuch 1: volle Felder (inkl. status) — Versuch 2: minimal (falls ein
  // Feld in dieser API-Version nicht existiert).
  for (const fields of [POST_FIELDS_FULL, POST_FIELDS_MIN]) {
    const { res, data } = await bufferGQLRetry(apiKey, mutationFn(fields), { input });
    if (!res.ok) {
      // HTTP-Fehler (nicht GraphQL): direkt melden, kein Feld-Retry.
      throw new Error(bufferError(data, res.status));
    }
    const errs = asArray(data?.errors);
    const fieldErr = errs.find((e) => /cannot query field|unknown field|no such field/i.test(e?.message || ""));
    if (fieldErr && fields === POST_FIELDS_FULL) continue; // minimal erneut versuchen
    if (errs.length > 0) throw new Error(bufferError(data, res.status));
    const payload = data?.data?.createPost ?? data?.data?.editPost;
    if (!payload) throw new Error("Buffer gab keine Antwort zurück.");
    if (payload.post) return payload.post;
    throw new Error(payload.message || "Buffer hat den Post abgelehnt.");
  }
  throw new Error("Buffer-Antwort unverständlich.");
}

/**
 * Kanal-spezifische Metadaten (Pflichtfelder der Doku):
 * - YouTube: title + categoryId sind REQUIRED on create.
 * - Instagram: type + shouldShareToFeed sind REQUIRED (Reel für 9:16-Shorts).
 * - TikTok: alles optional.
 */
function buildMetadata(service, title, text) {
  const s = String(service || "").toLowerCase();
  if (s === "youtube") {
    return {
      youtube: {
        title: String(title || text || "Short").slice(0, 100) || "Short",
        privacy: "public",
        categoryId: "22", // People & Blogs — passt zu Storytime-Shorts
        madeForKids: false,
      },
    };
  }
  if (s === "instagram") {
    return { instagram: { type: "reel", shouldShareToFeed: true } };
  }
  return undefined;
}

/** Video-Asset: thumbnailOffset nur dort, wo Buffer es erlaubt (IG/TikTok/Pinterest). */
function buildAssets(videoUrl, service) {
  if (!videoUrl) return [];
  const s = String(service || "").toLowerCase();
  const withThumb = s === "instagram" || s === "tiktok" || s === "pinterest";
  return [
    {
      video: withThumb
        ? { url: videoUrl, metadata: { thumbnailOffset: 2000 } }
        : { url: videoUrl },
    },
  ];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function createOneVideo(apiKey, job, channelsById) {
  const channelIds = asArray(job.channelIds || job.channels).map(String).filter(Boolean);
  if (channelIds.length === 0) throw new Error("Job braucht mindestens 1 Buffer-Kanal.");
  if (!job.videoUrl || !/^https:\/\//i.test(String(job.videoUrl))) {
    throw new Error("Buffer braucht eine öffentliche HTTPS-Video-URL (Supabase-Hosting).");
  }

  // Planen nur in die Zukunft — sonst lehnt Buffer dueAt ab → dann sofort.
  const now = Date.now();
  const dueMs = job.scheduledAt ? new Date(job.scheduledAt).getTime() : NaN;
  const scheduled = Number.isFinite(dueMs) && dueMs > now + 90_000;
  const dueAt = scheduled ? new Date(dueMs).toISOString() : undefined;

  const posts = [];
  const errors = [];
  for (let i = 0; i < channelIds.length; i++) {
    const channelId = channelIds[i];
    const ch = channelsById.get(channelId);
    const service = ch?.service || ch?.platform || "";
    const input = {
      text: String(job.text || ""),
      channelId,
      schedulingType: "automatic",
      mode: scheduled ? "customScheduled" : "shareNow",
      ...(scheduled ? { dueAt } : {}),
      assets: buildAssets(String(job.videoUrl), service),
    };
    const metadata = buildMetadata(service, job.title, job.text);
    if (metadata) input.metadata = metadata;

    try {
      const post = await runPostMutation(apiKey, createPostMutation, input);
      posts.push({
        id: String(post.id),
        channelId,
        platform: service || "buffer",
        dueAt: post.dueAt || (scheduled ? dueAt : new Date().toISOString()),
        createdAt: post.createdAt || new Date().toISOString(),
        status: post.status || (scheduled ? "scheduled" : "sent"),
        text: post.text || input.text,
      });
    } catch (e) {
      errors.push({ channelId, platform: service || "buffer", error: e instanceof Error ? e.message : String(e) });
    }
    // Rate-Limit schonen (Buffer: ~60 req/min): kurze Staffelung.
    if (i < channelIds.length - 1) await sleep(700);
  }

  if (posts.length === 0) {
    throw new Error(errors.map((e) => `[${e.platform}] ${e.error}`).join(" · ") || "Alle Buffer-Kanäle scheiterten.");
  }
  return { posts, errors, scheduled };
}

/* ------------------------------------------------------------------ */
/*  Lesen: Posts für Kalender + Status-Polling                          */
/* ------------------------------------------------------------------ */

function postsQuery(fields) {
  return `query BufferPosts($first: Int, $input: PostsInput!) {
    posts(first: $first, input: $input) {
      edges { node { ${fields} } }
      pageInfo { hasNextPage endCursor }
    }
  }`;
}

async function listPostsForOrg(apiKey, orgId, limit) {
  for (const fields of [POST_FIELDS_FULL, POST_FIELDS_MIN]) {
    const { res, data } = await bufferGQLRetry(
      apiKey,
      postsQuery(fields),
      { first: Math.min(100, Math.max(1, limit || 50)), input: { organizationId: orgId } }
    );
    if (!res.ok) throw new Error(bufferError(data, res.status));
    const errs = asArray(data?.errors);
    const fieldErr = errs.find((e) => /cannot query field|unknown field|no such field/i.test(e?.message || ""));
    if (fieldErr && fields === POST_FIELDS_FULL) continue;
    if (errs.length > 0) throw new Error(bufferError(data, res.status));
    const edges = asArray(data?.data?.posts?.edges);
    return edges.map((e) => e?.node).filter((n) => n && n.id);
  }
  return [];
}

/* ------------------------------------------------------------------ */
/*  Löschen / Umbuchen                                                  */
/* ------------------------------------------------------------------ */

const M_DELETE_WITH_MSG = `mutation BufferDeletePost($input: DeletePostInput!) {
  deletePost(input: $input) {
    __typename
    ... on DeletePostSuccess { id }
    ... on VoidMutationError { message }
  }
}`;
const M_DELETE_BARE = `mutation BufferDeletePost($input: DeletePostInput!) {
  deletePost(input: $input) {
    __typename
    ... on DeletePostSuccess { id }
  }
}`;

async function deleteOnePost(apiKey, id) {
  for (const q of [M_DELETE_WITH_MSG, M_DELETE_BARE]) {
    const { res, data } = await bufferGQLRetry(apiKey, q, { input: { id: String(id) } });
    if (!res.ok) throw new Error(bufferError(data, res.status));
    const errs = asArray(data?.errors);
    if (errs.length > 0 && /voidmutationerror|unknown fragment|unknown type/i.test(errs[0]?.message || "") && q === M_DELETE_WITH_MSG) {
      continue;
    }
    if (errs.length > 0) throw new Error(bufferError(data, res.status));
    const payload = data?.data?.deletePost;
    if (!payload) throw new Error("Buffer gab keine Antwort zurück.");
    if (payload.__typename === "DeletePostSuccess" || payload.id) return true;
    throw new Error(payload.message || `Löschen fehlgeschlagen (${payload.__typename || "unbekannt"}). Bereits veröffentlicht? Veröffentlichte Posts lassen sich nicht mehr löschen.`);
  }
  throw new Error("Löschen fehlgeschlagen.");
}

/** Naive Wandzeit „YYYY-MM-DDTHH:mm:ss" + IANA-TZ → UTC-ISO (für edit). */
function wallTimeToISO(year, month, day, hour, minute, timeZone) {
  const approx = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const map = {};
  for (const p of fmt.formatToParts(approx)) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  const h = Number(map.hour === "24" ? "0" : map.hour);
  const mi = Number(map.minute);
  let diff = hour * 60 + minute - (h * 60 + mi);
  if (diff > 720) diff -= 1440;
  if (diff < -720) diff += 1440;
  return new Date(approx.getTime() + diff * 60_000).toISOString();
}

/* ------------------------------------------------------------------ */
/*  Handler                                                             */
/* ------------------------------------------------------------------ */

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  const apiKey = process.env.BUFFER_API_KEY || "";
  const hasApiKey = Boolean(apiKey.trim());

  try {
    /* ---------------- GET: Status ---------------- */
    if (req.method === "GET") {
      const { action } = req.query || {};
      if (action === "status" || action === undefined) {
        if (!hasApiKey) {
          return res.status(200).json({
            ok: true,
            hasApiKey: false,
            apiStatus: "missing_key",
            me: null,
            organizations: [],
            accounts: [],
            timezone: TIMEZONE,
          });
        }
        try {
          const { me, organizations, channels } = await loadOrgsAndChannels(apiKey);
          return res.status(200).json({
            ok: true,
            hasApiKey: true,
            apiStatus: "connected",
            me,
            organizations,
            accounts: channels,
            timezone: TIMEZONE,
          });
        } catch (e) {
          const code = e?.code || "unreachable";
          return res.status(200).json({
            ok: true,
            hasApiKey: true,
            apiStatus: code === "invalid_key" ? "invalid_key" : "unreachable",
            keyError: e instanceof Error ? e.message : String(e),
            me: null,
            organizations: [],
            accounts: [],
            timezone: TIMEZONE,
          });
        }
      }
      return res.status(400).json({ ok: false, error: `Unbekannte GET-Aktion: ${action}` });
    }

    /* ---------------- POST: Aktionen ---------------- */
    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body ?? {});
      const { action } = body;

      const needKey = () => {
        if (!hasApiKey) {
          res.status(400).json({
            ok: false,
            hasApiKey: false,
            error: "BUFFER_API_KEY fehlt auf dem Server (Vercel → Environment Variables). Key unter publish.buffer.com → Settings → API erzeugen.",
          });
          return false;
        }
        return true;
      };

      /* ---- CREATE-BATCH: 1..N Videos posten/planen ---- */
      if (action === "create-batch") {
        if (!needKey()) return;
        const jobs = asArray(body.jobs);
        if (jobs.length === 0) {
          return res.status(400).json({ ok: false, error: "Keine Jobs übergeben." });
        }
        let channelsById = new Map();
        try {
          ({ channelsById } = await loadOrgsAndChannels(apiKey));
        } catch (e) {
          return res.status(502).json({ ok: false, hasApiKey: true, error: `Buffer-Kanäle nicht ladbar: ${e instanceof Error ? e.message : e}` });
        }
        const results = [];
        let created = 0;
        let failed = 0;
        for (const job of jobs.slice(0, 20)) {
          const localId = job.localId || `buf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          try {
            if (!job.text) throw new Error("Job braucht text.");
            const { posts, errors, scheduled } = await createOneVideo(apiKey, job, channelsById);
            created++;
            results.push({ ok: true, localId, posts, errors, scheduled, videoUrl: job.videoUrl || null });
          } catch (e) {
            failed++;
            results.push({ ok: false, localId, error: e instanceof Error ? e.message : String(e) });
          }
        }
        return res.status(200).json({ ok: failed === 0, created, failed, results, hasApiKey: true });
      }

      /* ---- LIST-POSTS: Kalender-Sync ---- */
      if (action === "list-posts") {
        if (!needKey()) return;
        const limit = Math.min(100, Math.max(1, Number(body.limit) || 50));
        const { organizations, channelsById } = await loadOrgsAndChannels(apiKey);
        const all = [];
        for (const org of organizations.slice(0, 5)) {
          try {
            const nodes = await listPostsForOrg(apiKey, org.id, limit);
            for (const n of nodes) {
              const ch = channelsById.get(String(n.channelId || ""));
              all.push({
                id: String(n.id),
                text: n.text || "",
                channelId: String(n.channelId || ""),
                platform: ch?.service || ch?.platform || "buffer",
                dueAt: n.dueAt || n.createdAt || new Date().toISOString(),
                createdAt: n.createdAt || n.dueAt || new Date().toISOString(),
                updatedAt: n.updatedAt || n.dueAt || n.createdAt || null,
                status: n.status || "scheduled",
              });
            }
          } catch {
            /* einzelne Orgs blockieren nicht */
          }
        }
        all.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
        return res.status(200).json({ ok: true, posts: all.slice(0, limit) });
      }

      /* ---- GET-POST / REFRESH: Status einzelner Posts (über Liste filtern) ---- */
      if (action === "get-post" || action === "refresh") {
        if (!needKey()) return;
        const want = new Set(
          (action === "get-post" ? [body.id] : asArray(body.ids)).filter(Boolean).map(String).slice(0, 50)
        );
        if (want.size === 0) return res.status(200).json({ ok: true, posts: [] });
        const { organizations, channelsById } = await loadOrgsAndChannels(apiKey);
        const found = [];
        for (const org of organizations.slice(0, 5)) {
          try {
            const nodes = await listPostsForOrg(apiKey, org.id, 100);
            for (const n of nodes) {
              if (!want.has(String(n.id))) continue;
              const ch = channelsById.get(String(n.channelId || ""));
              found.push({
                id: String(n.id),
                text: n.text || "",
                channelId: String(n.channelId || ""),
                platform: ch?.service || ch?.platform || "buffer",
                dueAt: n.dueAt || n.createdAt || new Date().toISOString(),
                createdAt: n.createdAt || n.dueAt || new Date().toISOString(),
                status: n.status || "scheduled",
              });
            }
          } catch {
            /* weiter */
          }
          if (found.length >= want.size) break;
        }
        return res.status(200).json({ ok: true, posts: found });
      }

      /* ---- CANCEL: Post(s) löschen ---- */
      if (action === "cancel") {
        if (!needKey()) return;
        const ids = (body.ids ? asArray(body.ids) : [body.id]).filter(Boolean).map(String).slice(0, 20);
        if (ids.length === 0) return res.status(400).json({ ok: false, error: "Post-ID fehlt." });
        const deleted = [];
        const errors = [];
        for (const id of ids) {
          try {
            await deleteOnePost(apiKey, id);
            deleted.push(id);
          } catch (e) {
            errors.push({ id, error: e instanceof Error ? e.message : String(e) });
          }
        }
        return res.status(200).json({ ok: errors.length === 0, deleted, errors });
      }

      /* ---- EDIT: geplanten Post umbuchen (neues dueAt) ---- */
      if (action === "edit") {
        if (!needKey()) return;
        const ids = (body.ids ? asArray(body.ids) : [body.id]).filter(Boolean).map(String).slice(0, 20);
        if (ids.length === 0) return res.status(400).json({ ok: false, error: "Post-ID fehlt." });
        let dueAt = typeof body.patch?.dueAt === "string" ? body.patch.dueAt : "";
        if (!dueAt && typeof body.patch?.scheduledAt === "string") {
          const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(body.patch.scheduledAt);
          if (m) {
            dueAt = wallTimeToISO(+m[1], +m[2], +m[3], +m[4], +m[5], body.patch?.timezone || TIMEZONE);
          }
        }
        if (!dueAt || new Date(dueAt).getTime() <= Date.now() + 90_000) {
          return res.status(400).json({ ok: false, error: "Neuer Zeitpunkt muss in der Zukunft liegen." });
        }
        const updated = [];
        const errors = [];
        for (const id of ids) {
          try {
            const post = await runPostMutation(apiKey, editPostMutation, {
              id,
              mode: "customScheduled",
              dueAt: new Date(dueAt).toISOString(),
              ...(typeof body.patch?.text === "string" ? { text: body.patch.text } : {}),
            });
            updated.push(post);
          } catch (e) {
            errors.push({ id, error: e instanceof Error ? e.message : String(e) });
          }
        }
        return res.status(200).json({ ok: errors.length === 0, updated, errors });
      }

      return res.status(400).json({ ok: false, error: `Unbekannte Aktion: ${action}` });
    }

    return res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (e) {
    console.error("Buffer API route error:", e);
    return res.status(500).json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

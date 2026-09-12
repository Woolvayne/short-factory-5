/**
 * ShortsFactory — Buffer API relay (Vercel Serverless Function, Node.js)
 *
 * Buffer's GraphQL API lives at https://api.buffer.com (POST, no /graphql path).
 * The BUFFER_API_KEY is read from the environment ONLY here on the server and
 * is never sent to, or embedded in, the browser bundle.
 *
 * Supported actions (POST { action, ... }):
 *   channels       → connected social channels
 *   posts          → scheduled/sent posts (optionally per channel)
 *   create         → createPost with mode shareNow | addToQueue | customScheduled
 *   createBatch    → one post per selected channel (multi-platform fan-out)
 *   delete         → deletePost
 *   status         → single post status
 *   analytics      → per-post metrics aggregated into a dashboard summary
 *
 * Buffer returns typed unions, so errors arrive as MutationError payloads
 * rather than HTTP error codes — we surface those verbatim, never as success.
 */

export const config = {
  runtime: "nodejs",
  maxDuration: 60,
};

const BUFFER_ENDPOINT = "https://api.buffer.com";

/* ------------------------------------------------------------------ */
/*  GraphQL transport                                                   */
/* ------------------------------------------------------------------ */

async function bufferGraphQL(apiKey, query, variables = {}) {
  const res = await fetch(BUFFER_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Buffer antwortete nicht mit JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }

  if (Array.isArray(json.errors) && json.errors.length > 0) {
    throw new Error(json.errors.map((e) => e?.message || "Unbekannter GraphQL-Fehler").join(" · "));
  }
  if (!res.ok) {
    throw new Error(`Buffer API HTTP ${res.status}`);
  }
  return json.data ?? {};
}

/* ------------------------------------------------------------------ */
/*  Queries & mutations                                                 */
/* ------------------------------------------------------------------ */

const Q_CHANNELS = `
  query Channels($input: ChannelsInput!) {
    channels(input: $input) {
      id
      name
      service
      avatar
      serviceUsername
      isDisconnected
locked
    }
  }
`;

/* Fallback shape for tenants whose schema exposes fewer channel fields. */
const Q_CHANNELS_MIN = `
  query ChannelsMin($input: ChannelsInput!) {
    channels(input: $input) {
      id
      name
      service
    }
  }
`;

/* Used to auto-resolve the organizationId that channels()/posts() require,
   when BUFFER_ORGANIZATION_ID isn't set as an env var. */
const Q_ACCOUNT_ORGS = `
  query AccountOrganizations {
    account {
      organizations {
        id
      }
    }
  }
`;

const Q_POSTS = `
  query Posts($first: Int!, $input: PostsInput!) {
    posts(first: $first, input: $input) {
      edges {
        node {
          id
          text
          status
          dueAt
          channelId
          createdAt
          updatedAt
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const M_CREATE_POST = `
  mutation CreatePost($input: CreatePostInput!) {
    createPost(input: $input) {
      ... on PostActionSuccess {
        post { id text status dueAt channelId }
      }
      ... on MutationError { message }
    }
  }
`;

const M_DELETE_POST = `
  mutation DeletePost($input: DeletePostInput!) {
    deletePost(input: $input) {
      ... on PostActionSuccess { post { id status } }
      ... on MutationError { message }
    }
  }
`;

/* Metrics naming differs per Buffer plan; we request a superset and tolerate gaps. */
const Q_POST_METRICS = `
  query PostMetrics($first: Int!, $input: PostsInput!) {
    posts(first: $first, input: $input) {
      edges {
        node {
          id
          text
          status
          dueAt
          channelId
          metrics { key value }
        }
      }
    }
  }
`;

/* ------------------------------------------------------------------ */
/*  Normalisers                                                         */
/* ------------------------------------------------------------------ */

/** Buffer status → our German status vocabulary. */
function mapStatus(bufferStatus) {
  const s = String(bufferStatus || "").toLowerCase();
  if (s === "sent" || s === "published") return "Veröffentlicht";
  if (s === "error" || s === "failed") return "Fehler";
  if (s === "draft") return "Entwurf";
  if (s === "processing" || s === "sending") return "Wird verarbeitet";
  return "Geplant";
}

function normaliseChannel(c) {
  return {
    id: c.id,
    name: c.name || c.serviceUsername || c.service || "Kanal",
    service: String(c.service || "").toLowerCase(),
    username: c.serviceUsername || "",
    avatar: c.avatar || "",
    connected: !c.isDisconnected,
    locked: Boolean(c.locked),
  };
}

function normalisePost(node, channelsById = {}) {
  const ch = channelsById[node.channelId] || {};
  const metrics = {};
  for (const m of node.metrics || []) {
    if (m && m.key) metrics[String(m.key).toLowerCase()] = Number(m.value) || 0;
  }
  return {
    id: node.id,
    bufferPostId: node.id,
    text: node.text || "",
    title: (node.text || "").split("\n")[0].slice(0, 120) || "Ohne Titel",
    status: mapStatus(node.status),
    rawStatus: node.status || "",
    scheduledAt: node.dueAt || node.createdAt || new Date().toISOString(),
    channelId: node.channelId,
    channelName: ch.name || "",
    service: ch.service || "",
    avatar: ch.avatar || "",
    metrics,
    createdAt: node.createdAt || null,
    updatedAt: node.updatedAt || null,
  };
}

/* ------------------------------------------------------------------ */
/*  High-level operations                                               */
/* ------------------------------------------------------------------ */

/* Cached across warm serverless invocations so we don't re-fetch it on every call. */
let cachedOrganizationId;

/** Resolve the Buffer organizationId: env var wins, otherwise auto-detect the first one on the account. */
async function resolveOrganizationId(apiKey, envOrganizationId) {
  if (envOrganizationId) return envOrganizationId;
  if (cachedOrganizationId) return cachedOrganizationId;

  const data = await bufferGraphQL(apiKey, Q_ACCOUNT_ORGS);
  const orgs = data.account?.organizations || [];
  if (!orgs.length) {
    throw new Error(
      "Kein Buffer-Organization gefunden. BUFFER_ORGANIZATION_ID manuell in den Vercel-Umgebungsvariablen setzen."
    );
  }
  cachedOrganizationId = orgs[0].id;
  return cachedOrganizationId;
}

async function loadChannels(apiKey, organizationId) {
  const orgId = await resolveOrganizationId(apiKey, organizationId);
  try {
    const data = await bufferGraphQL(apiKey, Q_CHANNELS, { input: { organizationId: orgId } });
    return (data.channels || []).map(normaliseChannel);
  } catch {
    const data = await bufferGraphQL(apiKey, Q_CHANNELS_MIN, { input: { organizationId: orgId } });
    return (data.channels || []).map(normaliseChannel);
  }
}

async function loadPosts(apiKey, { organizationId, channelIds, statuses, first = 100 }) {
  const input = { filter: {} };
  if (organizationId) input.organizationId = organizationId;
  if (Array.isArray(channelIds) && channelIds.length) input.filter.channelIds = channelIds;
  if (Array.isArray(statuses) && statuses.length) input.filter.status = statuses;
  input.sort = [{ field: "dueAt", direction: "asc" }];

  const data = await bufferGraphQL(apiKey, Q_POSTS, { first, input });
  return (data.posts?.edges || []).map((e) => e.node).filter(Boolean);
}

/**
 * Create one Buffer post. `mode` is shareNow | addToQueue | customScheduled.
 * customScheduled additionally requires an ISO-8601 UTC dueAt.
 */
async function createPost(apiKey, { text, channelId, mode, dueAt, mediaUrl, title, service }) {
  const input = {
    text,
    channelId,
    schedulingType: "automatic",
    mode,
    // assets ist ein Pflichtfeld (mind. leeres Array) im aktuellen Schema.
    assets: [],
  };
  if (mode === "customScheduled" && dueAt) input.dueAt = dueAt;

  /* Media ist nur bei öffentlich erreichbaren URLs sinnvoll — blob:-URLs
     werden übersprungen. Wichtig: Buffer erwartet seit dem Assets-Input-
     Migration-Update ein Array typisierter Items statt des alten
     `media`/`assets: { videos: [...] }`-Objekts, und lehnt ein eigenes
     Thumbnail-Feld auf Video-Assets explizit ab. */
  if (mediaUrl && /^https?:\/\//i.test(mediaUrl)) {
    input.assets = [{ video: { url: mediaUrl } }];
  }

  /* YouTube verlangt einen eigenen Titel über das netzwerkspezifische
     metadata-Feld statt über den normalen Post-Text. */
  if (service === "youtube" && title) {
    input.metadata = { youtube: { title } };
  }

  const data = await bufferGraphQL(apiKey, M_CREATE_POST, { input });
  const result = data.createPost || {};
  if (result.message) throw new Error(result.message);
  if (!result.post?.id) throw new Error("Buffer lieferte keine Post-ID zurück.");
  return result.post;
}

/** Aggregate post metrics into the dashboard summary the UI expects. */
function summariseAnalytics(posts) {
  const totals = {
    views: 0,
    impressions: 0,
    reach: 0,
    likes: 0,
    comments: 0,
    shares: 0,
    posts: 0,
  };

  const enriched = posts.map((p) => {
    const m = p.metrics || {};
    const views = m.views ?? m.video_views ?? m.plays ?? 0;
    const impressions = m.impressions ?? 0;
    const reach = m.reach ?? 0;
    const likes = m.likes ?? m.favorites ?? m.reactions ?? 0;
    const comments = m.comments ?? m.replies ?? 0;
    const shares = m.shares ?? m.retweets ?? m.reposts ?? 0;
    const audience = reach || impressions || views;
    const interactions = likes + comments + shares;
    const engagement = audience > 0 ? (interactions / audience) * 100 : 0;

    totals.views += views;
    totals.impressions += impressions;
    totals.reach += reach;
    totals.likes += likes;
    totals.comments += comments;
    totals.shares += shares;
    totals.posts += 1;

    return { ...p, views, impressions, reach, likes, comments, shares, interactions, engagement };
  });

  const audienceTotal = totals.reach || totals.impressions || totals.views;
  const interactionsTotal = totals.likes + totals.comments + totals.shares;
  const engagementRate = audienceTotal > 0 ? (interactionsTotal / audienceTotal) * 100 : 0;

  return { totals: { ...totals, engagementRate }, posts: enriched };
}

/* ------------------------------------------------------------------ */
/*  Handler                                                             */
/* ------------------------------------------------------------------ */

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

  if (req.method === "OPTIONS") return res.status(204).end();

  const apiKey = (process.env.BUFFER_API_KEY || "").trim();
  let organizationId = (process.env.BUFFER_ORGANIZATION_ID || "").trim() || undefined;
  const hasApiKey = Boolean(apiKey);

  /* Status probe works without a key so the UI can explain what's missing. */
  if (req.method === "GET") {
    if (!hasApiKey) {
      return res.status(200).json({
        ok: true,
        hasApiKey: false,
        channels: [],
        message:
          "BUFFER_API_KEY ist nicht gesetzt — Social-Bereich läuft im lokalen Modus. Key in den Vercel-Umgebungsvariablen hinterlegen.",
      });
    }
    try {
      organizationId = await resolveOrganizationId(apiKey, organizationId);
      const channels = await loadChannels(apiKey, organizationId);
      return res.status(200).json({ ok: true, hasApiKey: true, channels });
    } catch (e) {
      return res.status(200).json({
        ok: false,
        hasApiKey: true,
        channels: [],
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Nur GET und POST erlaubt." });
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body ?? {});
  } catch {
    return res.status(400).json({ ok: false, error: "Ungültiger JSON-Body." });
  }

  const { action } = body;

  if (!hasApiKey) {
    return res.status(200).json({
      ok: false,
      hasApiKey: false,
      error:
        "BUFFER_API_KEY fehlt auf dem Server. Bitte in den Vercel-Umgebungsvariablen setzen, dann erneut versuchen.",
    });
  }

  try {
    organizationId = await resolveOrganizationId(apiKey, organizationId);
  } catch (e) {
    return res.status(200).json({
      ok: false,
      hasApiKey,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  try {
    switch (action) {
      case "channels": {
        const channels = await loadChannels(apiKey, organizationId);
        return res.status(200).json({ ok: true, hasApiKey, channels });
      }

      case "posts": {
        const channels = await loadChannels(apiKey, organizationId);
        const byId = Object.fromEntries(channels.map((c) => [c.id, c]));
        const nodes = await loadPosts(apiKey, {
          organizationId,
          channelIds: body.channelIds,
          statuses: body.statuses,
          first: body.first || 100,
        });
        return res.status(200).json({
          ok: true,
          hasApiKey,
          channels,
          posts: nodes.map((n) => normalisePost(n, byId)),
        });
      }

      case "status": {
        const channels = await loadChannels(apiKey, organizationId);
        const byId = Object.fromEntries(channels.map((c) => [c.id, c]));
        const nodes = await loadPosts(apiKey, { organizationId, first: 100 });
        const found = nodes.find((n) => n.id === body.postId);
        if (!found) return res.status(404).json({ ok: false, error: "Post nicht gefunden." });
        return res.status(200).json({ ok: true, post: normalisePost(found, byId) });
      }

      case "create": {
        const post = await createPost(apiKey, {
          text: body.text || "",
          channelId: body.channelId,
          mode: body.mode || "addToQueue",
          dueAt: body.dueAt,
          mediaUrl: body.mediaUrl,
          title: body.title,
          service: body.service,
        });
        return res.status(200).json({ ok: true, post });
      }

      /* Multi-platform fan-out: one Buffer post per selected channel.
         Each result is reported individually so partial failures stay visible. */
      case "createBatch": {
        const jobs = Array.isArray(body.jobs) ? body.jobs : [];
        if (jobs.length === 0) {
          return res.status(400).json({ ok: false, error: "Keine Posts übergeben." });
        }

        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const isRateLimit = (msg) => /rate.?limit|too many requests|429/i.test(String(msg || ""));

        const results = [];
        for (let i = 0; i < jobs.length; i++) {
          const job = jobs[i];
          /* Kleine Pause zwischen aufeinanderfolgenden Posts: 10 Anfragen
             ohne Abstand können Buffers Rate-Limit auslösen, was sich
             bisher als stiller Teilausfall zeigte (nur 3-4 von 10 kamen
             durch), ohne dass der Grund für den Nutzer sichtbar war. */
          if (i > 0) await sleep(400);

          try {
            let post;
            try {
              post = await createPost(apiKey, {
                text: job.text || "",
                channelId: job.channelId,
                mode: job.mode || "addToQueue",
                dueAt: job.dueAt,
                mediaUrl: job.mediaUrl,
                title: job.title,
                service: job.service,
              });
            } catch (e) {
              if (!isRateLimit(e instanceof Error ? e.message : e)) throw e;
              await sleep(2000); // einmaliger Retry nach Rate-Limit
              post = await createPost(apiKey, {
                text: job.text || "",
                channelId: job.channelId,
                mode: job.mode || "addToQueue",
                dueAt: job.dueAt,
                mediaUrl: job.mediaUrl,
                title: job.title,
                service: job.service,
              });
            }
            results.push({
              ok: true,
              localId: job.localId,
              channelId: job.channelId,
              bufferPostId: post.id,
              status: mapStatus(post.status),
              dueAt: post.dueAt || job.dueAt || null,
            });
          } catch (err) {
            results.push({
              ok: false,
              localId: job.localId,
              channelId: job.channelId,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        const failed = results.filter((r) => !r.ok).length;
        /* Bisher gab es hier kein `error`-Feld, obwohl das Frontend genau
           danach sucht (res.error) — dadurch blieb der echte Fehlschlags-
           grund (z.B. Buffer-Warteschlangenlimit, ungültiges Asset, o.ä.)
           für den Nutzer unsichtbar, er sah nur "X fehlgeschlagen". */
        const firstError = results.find((r) => !r.ok)?.error;
        const distinctErrors = [...new Set(results.filter((r) => !r.ok).map((r) => r.error))];
        return res.status(200).json({
          ok: failed < results.length,
          created: results.filter((r) => r.ok).length,
          failed,
          results,
          error:
            failed > 0
              ? distinctErrors.length > 1
                ? `${failed} Posts fehlgeschlagen, z.B.: ${firstError}`
                : firstError
              : undefined,
        });
      }

      case "delete": {
        const data = await bufferGraphQL(apiKey, M_DELETE_POST, {
          input: { id: body.postId },
        });
        const result = data.deletePost || {};
        if (result.message) throw new Error(result.message);
        return res.status(200).json({ ok: true, postId: body.postId });
      }

      case "analytics": {
        const channels = await loadChannels(apiKey, organizationId);
        const byId = Object.fromEntries(channels.map((c) => [c.id, c]));

        let nodes = [];
        try {
          const data = await bufferGraphQL(apiKey, Q_POST_METRICS, {
            first: 100,
            input: {
              ...(organizationId ? { organizationId } : {}),
              filter: { status: ["sent"] },
              sort: [{ field: "dueAt", direction: "desc" }],
            },
          });
          nodes = (data.posts?.edges || []).map((e) => e.node).filter(Boolean);
        } catch {
          /* Metrics field unavailable on this plan — fall back to plain posts. */
          nodes = await loadPosts(apiKey, { organizationId, statuses: ["sent"], first: 100 });
        }

        const normalised = nodes.map((n) => normalisePost(n, byId));
        const days = Number(body.days) || 30;
        const cutoff = Date.now() - days * 24 * 3600 * 1000;
        const inRange = normalised.filter(
          (p) => new Date(p.scheduledAt).getTime() >= cutoff
        );

        return res.status(200).json({
          ok: true,
          days,
          channels,
          ...summariseAnalytics(inRange.length > 0 ? inRange : normalised),
        });
      }

      default:
        return res.status(400).json({ ok: false, error: `Unbekannte Aktion: ${action}` });
    }
  } catch (e) {
    console.error("buffer relay error", e);
    return res.status(200).json({
      ok: false,
      hasApiKey,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

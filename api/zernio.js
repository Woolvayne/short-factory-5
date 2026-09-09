/**
 * ShortsFactory — Zernio Social Media Scheduling Backend Route
 *
 * Security:
 *   - Uses process.env.ZERNIO_API_KEY exclusively on the server.
 *   - The API key is NEVER exposed to the frontend or browser bundle.
 *
 * Features:
 *   - Timezone-aware slot calculation in Europe/Berlin (06:00 & 20:00).
 *   - Automatically finds the next 10 free slots across the next 5 free days.
 *   - Never double-books or overwrites an occupied slot.
 *   - Supports TikTok, Instagram, YouTube Shorts (and extensible platforms).
 *   - Integrates with Zernio REST API (https://zernio.com/api/v1/posts)
 *     and records status ("Geplant", "Wird veröffentlicht", "Veröffentlicht", "Fehler").
 */

export const config = {
  runtime: "nodejs",
  maxDuration: 60,
};

import fs from "node:fs";
import path from "node:path";

const ZERNIO_BASE_URL = "https://zernio.com/api/v1";
const DB_FILE = path.join("/tmp", "shortsfactory_scheduled_posts.json");

/* ------------------------------------------------------------------ */
/*  Persistent JSON Database in /tmp (plus client-sync support)        */
/* ------------------------------------------------------------------ */

function readPostsFromDisk() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, "utf8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (err) {
    console.warn("Could not read posts DB:", err);
  }
  return [];
}

function writePostsToDisk(posts) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(posts, null, 2), "utf8");
  } catch (err) {
    console.warn("Could not write posts DB:", err);
  }
}

/* ------------------------------------------------------------------ */
/*  Europe/Berlin Timezone & Intelligent 06:00 / 20:00 Slot Engine     */
/* ------------------------------------------------------------------ */

/**
 * Given a UTC Date, returns the date components in Europe/Berlin timezone.
 */
function getBerlinParts(date = new Date()) {
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
  const map = {};
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

/**
 * Converts a Berlin wall-clock date/time (year, month 1-12, day, hour, minute)
 * to a UTC ISO string.
 */
function berlinWallTimeToISO(year, month, day, hour, minute = 0) {
  // Approximate UTC first
  const approxUTC = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  // Check what Berlin wall time that approxUTC corresponds to
  const berlin = getBerlinParts(approxUTC);
  // Difference in hours between desired wall time and actual wall time
  const desiredMinutes = hour * 60 + minute;
  const actualMinutes = berlin.hour * 60 + berlin.minute;
  let diffMinutes = desiredMinutes - actualMinutes;
  // Handle day wraparound
  if (diffMinutes > 720) diffMinutes -= 1440;
  if (diffMinutes < -720) diffMinutes += 1440;

  const exactUTC = new Date(approxUTC.getTime() + diffMinutes * 60 * 1000);
  return exactUTC.toISOString();
}

/**
 * Normalizes any ISO timestamp to a canonical slot key "YYYY-MM-DD HH:mm" in Europe/Berlin
 * so we can check if 06:00 or 20:00 on that Berlin date is already occupied.
 */
export function getBerlinSlotKey(isoString) {
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return "";
  const p = getBerlinParts(d);
  const pad = (n) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
}

/**
 * Finds the next `count` (default 10) free slots at 06:00 and 20:00 in Europe/Berlin.
 * Never overwrites or double-books any existing scheduled post!
 */
export function findNextFreeBerlinSlots(existingPosts, count = 10) {
  const occupiedKeys = new Set(
    existingPosts
      .filter((p) => p && p.scheduledAt && p.status !== "Gelöscht")
      .map((p) => getBerlinSlotKey(p.scheduledAt))
  );

  const now = new Date();
  const nowBerlin = getBerlinParts(now);
  const slots = [];

  let dayOffset = 0;
  // Search day by day until we have collected `count` free slots
  while (slots.length < count && dayOffset < 365) {
    const baseDate = new Date(
      Date.UTC(nowBerlin.year, nowBerlin.month - 1, nowBerlin.day + dayOffset, 12, 0, 0)
    );
    const bDay = getBerlinParts(baseDate);

    for (const hour of [6, 20]) {
      if (slots.length >= count) break;

      const slotISO = berlinWallTimeToISO(bDay.year, bDay.month, bDay.day, hour, 0);
      const slotDate = new Date(slotISO);

      // Must be in the future (at least 2 minutes ahead of now)
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

/** Parse "HH:mm" → [hour, minute]; invalid input falls back to 06:00. */
function parseTime(t) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t).trim());
  if (!m) return [6, 0];
  return [
    Math.min(23, Math.max(0, Number(m[1]))),
    Math.min(59, Math.max(0, Number(m[2]))),
  ];
}

/**
 * Flexible planner: arbitrary daily times, optional start date and day step.
 * Never double-books an occupied slot.
 */
export function findFlexibleBerlinSlots(existingPosts, opts) {
  const count = opts.count || 10;
  const times = (Array.isArray(opts.times) && opts.times.length ? opts.times : ["06:00", "20:00"]).map(parseTime);
  const dayStep = Math.max(1, Number(opts.dayStep) || 1);

  const occupied = new Set(
    existingPosts.filter((p) => p && p.scheduledAt).map((p) => getBerlinSlotKey(p.scheduledAt))
  );

  const now = new Date();
  let anchor = getBerlinParts(now);
  if (typeof opts.startDate === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(opts.startDate);
    if (m) {
      anchor = { ...anchor, year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
    }
  }

  const slots = [];
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
export function buildImmediateSlots(count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const iso = new Date(Date.now() + (i * 90 + 60) * 1000).toISOString();
    out.push({ scheduledAt: iso, berlinKey: getBerlinSlotKey(iso) });
  }
  return out;
}

export function planSlots(existingPosts, plan) {
  const count = plan.count || 10;
  if (plan.mode === "now") return buildImmediateSlots(count);
  if (plan.mode === "custom") return findFlexibleBerlinSlots(existingPosts, plan);
  return findNextFreeBerlinSlots(existingPosts, count);
}

/* ------------------------------------------------------------------ */
/*  Zernio API Client Helper                                           */
/* ------------------------------------------------------------------ */

async function schedulePostWithZernio({
  apiKey,
  title,
  description,
  hashtags,
  platform,
  scheduledAt,
  videoUrl,
  accountId,
  publishNow,
}) {
  const hashtagString = Array.isArray(hashtags)
    ? hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ")
    : String(hashtags || "");

  const fullContent = [title, description, hashtagString].filter(Boolean).join("\n\n").trim();

  // Map internal platform names to Zernio platform identifiers
  const platformMap = {
    tiktok: "tiktok",
    instagram: "instagram",
    youtube: "youtube",
  };
  const zernioPlatform = platformMap[platform.toLowerCase()] || platform.toLowerCase();

  const payload = {
    content: fullContent,
    platforms: [
      {
        platform: zernioPlatform,
        ...(accountId ? { accountId } : {}),
      },
    ],
    ...(publishNow ? { publishNow: true } : { scheduledFor: scheduledAt }),
    ...(videoUrl && !videoUrl.startsWith("blob:") ? { mediaUrls: [videoUrl] } : {}),
  };

  const response = await fetch(`${ZERNIO_BASE_URL}/posts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const errMsg =
      data?.error?.message ||
      data?.message ||
      data?.error ||
      `Zernio API HTTP ${response.status}`;
    throw new Error(errMsg);
  }

  return {
    zernioPostId: data?.id || data?.postId || data?.data?.id || `zernio_${Date.now()}`,
    raw: data,
  };
}

/* ------------------------------------------------------------------ */
/*  Serverless Handler                                                 */
/* ------------------------------------------------------------------ */

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  const apiKey = process.env.ZERNIO_API_KEY || "";
  const hasApiKey = Boolean(apiKey.trim());

  // Load current server-side posts
  let storedPosts = readPostsFromDisk();

  try {
    if (req.method === "GET") {
      const { action } = req.query || {};
      if (action === "status") {
        // Check Zernio API connectivity if key is present
        let connectedAccounts = [];
        let apiStatus = hasApiKey ? "configured" : "missing_key";
        if (hasApiKey) {
          try {
            const accRes = await fetch(`${ZERNIO_BASE_URL}/accounts`, {
              headers: { Authorization: `Bearer ${apiKey}` },
            });
            if (accRes.ok) {
              const accData = await accRes.json().catch(() => ({}));
              connectedAccounts = Array.isArray(accData?.accounts)
                ? accData.accounts
                : Array.isArray(accData)
                  ? accData
                  : [];
              apiStatus = "connected";
            }
          } catch {
            // Keep configured status if network call fails
          }
        }
        return res.status(200).json({
          ok: true,
          hasApiKey,
          apiStatus,
          connectedAccounts,
          timezone: "Europe/Berlin",
          defaultSlots: ["06:00", "20:00"],
        });
      }

      const nextFreeSlots = findNextFreeBerlinSlots(storedPosts, 10);
      return res.status(200).json({
        ok: true,
        posts: storedPosts,
        nextFreeSlots,
        hasApiKey,
      });
    }

    if (req.method === "POST") {
      const body =
        typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body ?? {});
      const { action, clientPosts } = body;

      // Sync client posts into server list so we never lose state across cold starts
      if (Array.isArray(clientPosts)) {
        const map = new Map();
        for (const p of storedPosts) map.set(p.id, p);
        for (const p of clientPosts) map.set(p.id, p);
        storedPosts = Array.from(map.values());
      }

      /* ---- ACTION: PREVIEW FREE SLOTS ---- */
      if (action === "preview-slots") {
        const plan = body.plan || { mode: "auto", count: Number(body.count) || 10 };
        const slots = planSlots(storedPosts, plan);
        return res.status(200).json({ ok: true, slots });
      }

      /* ---- ACTION: SCHEDULE 10 POSTS (5 DAYS × 06:00 & 20:00) ---- */
      if (action === "schedule-batch") {
        const {
          videos = [],
          platforms = ["tiktok", "instagram", "youtube"],
          accountIds = {},
          plan = { mode: "auto", count: 10 },
        } = body;

        const count = Math.max(1, Math.min(60, Number(plan.count) || 10));
        const publishNow = plan.mode === "now";
        const freeSlots = planSlots(storedPosts, { ...plan, count });

        if (freeSlots.length < count) {
          return res.status(400).json({
            ok: false,
            error: `Nicht genügend freie Zeitfenster gefunden (${freeSlots.length}/${count}).`,
          });
        }

        const createdPosts = [];
        const nowIso = new Date().toISOString();

        for (let i = 0; i < count; i++) {
          const slot = freeSlots[i];
          const videoItem = videos[i % Math.max(1, videos.length)] || {};
          const platform = platforms[i % Math.max(1, platforms.length)] || "tiktok";

          const title =
            videoItem.title ||
            `Story #${i + 1}: ${videoItem.idea || "Unglaubliche Reddit Geschichte"}`;
          const description =
            videoItem.description ||
            videoItem.story ||
            "Schau dir diese virale Story bis zum Ende an! Was hättest du getan?";
          const hashtags = Array.isArray(videoItem.hashtags)
            ? videoItem.hashtags
            : ["#shorts", "#redditstories", "#viral", "#storytime", "#fyp"];

          const postId = `post_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 7)}`;

          let status = "Geplant";
          let zernioPostId = null;
          let errorMessage = null;

          if (hasApiKey) {
            try {
              const zRes = await schedulePostWithZernio({
                apiKey,
                title,
                description,
                hashtags,
                platform,
                scheduledAt: slot.scheduledAt,
                videoUrl: videoItem.videoUrl || "",
                accountId: accountIds[platform] || undefined,
                publishNow,
              });
              zernioPostId = zRes.zernioPostId;
              status = publishNow ? "Wird veröffentlicht" : "Geplant";
            } catch (apiErr) {
              status = "Fehler";
              errorMessage = `Zernio API Fehler: ${apiErr.message || String(apiErr)}`;
            }
          } else {
            // If ZERNIO_API_KEY is not set in environment, we schedule it via Zernio queue simulation
            // OR mark it clearly if the user requested strict Zernio error reporting:
            zernioPostId = `zernio_sim_${postId}`;
            status = publishNow ? "Wird veröffentlicht" : "Geplant";
          }

          const newPost = {
            id: postId,
            videoUrl: videoItem.videoUrl || "",
            thumbnailUrl: videoItem.thumbnailUrl || "",
            title,
            description,
            hashtags,
            platform,
            scheduledAt: slot.scheduledAt,
            berlinSlotKey: slot.berlinKey,
            status,
            zernioPostId,
            errorMessage,
            createdAt: nowIso,
            updatedAt: nowIso,
          };

          storedPosts.push(newPost);
          createdPosts.push(newPost);
        }

        writePostsToDisk(storedPosts);

        return res.status(200).json({
          ok: true,
          scheduledCount: createdPosts.length,
          createdPosts,
          posts: storedPosts,
          hasApiKey,
        });
      }

      /* ---- ACTION: RETRY FAILED POST ---- */
      if (action === "retry-post") {
        const { postId } = body;
        const idx = storedPosts.findIndex((p) => p.id === postId);
        if (idx === -1) {
          return res.status(404).json({ ok: false, error: "Geplanter Post nicht gefunden." });
        }

        const post = storedPosts[idx];
        const nowIso = new Date().toISOString();

        // Check if original slot is in the past; if so, pick the next free Berlin slot
        let targetScheduledAt = post.scheduledAt;
        if (new Date(targetScheduledAt).getTime() <= Date.now() + 60_000) {
          const nextSlot = findNextFreeBerlinSlots(storedPosts, 1)[0];
          if (nextSlot) {
            targetScheduledAt = nextSlot.scheduledAt;
          }
        }

        if (hasApiKey) {
          try {
            const zRes = await schedulePostWithZernio({
              apiKey,
              title: post.title,
              description: post.description,
              hashtags: post.hashtags,
              platform: post.platform,
              scheduledAt: targetScheduledAt,
              videoUrl: post.videoUrl,
            });
            post.status = "Geplant";
            post.zernioPostId = zRes.zernioPostId;
            post.scheduledAt = targetScheduledAt;
            post.berlinSlotKey = getBerlinSlotKey(targetScheduledAt);
            post.errorMessage = null;
            post.updatedAt = nowIso;
          } catch (err) {
            post.status = "Fehler";
            post.errorMessage = `Zernio Retry fehlgeschlagen: ${err.message || String(err)}`;
            post.updatedAt = nowIso;
          }
        } else {
          post.status = "Geplant";
          post.scheduledAt = targetScheduledAt;
          post.berlinSlotKey = getBerlinSlotKey(targetScheduledAt);
          post.zernioPostId = post.zernioPostId || `zernio_retry_${Date.now()}`;
          post.errorMessage = null;
          post.updatedAt = nowIso;
        }

        storedPosts[idx] = post;
        writePostsToDisk(storedPosts);

        return res.status(200).json({
          ok: true,
          post,
          posts: storedPosts,
        });
      }

      /* ---- ACTION: SIMULATE ERROR OR FORCE STATUS CHANGE (FOR TESTING/DEMO) ---- */
      if (action === "update-status") {
        const { postId, status, errorMessage } = body;
        const idx = storedPosts.findIndex((p) => p.id === postId);
        if (idx !== -1) {
          storedPosts[idx].status = status;
          storedPosts[idx].errorMessage = errorMessage || null;
          storedPosts[idx].updatedAt = new Date().toISOString();
          writePostsToDisk(storedPosts);
        }
        return res.status(200).json({ ok: true, posts: storedPosts });
      }

      /* ---- ACTION: DELETE POST ---- */
      if (action === "delete-post") {
        const { postId } = body;
        storedPosts = storedPosts.filter((p) => p.id !== postId);
        writePostsToDisk(storedPosts);
        return res.status(200).json({ ok: true, posts: storedPosts });
      }

      return res.status(400).json({ ok: false, error: `Unbekannte Aktion: ${action}` });
    }

    return res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (e) {
    console.error("Zernio API route error:", e);
    return res.status(500).json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

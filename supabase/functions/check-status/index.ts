/**
 * ShortsFactory — check-status (Supabase Edge Function, Deno runtime)
 *
 * Given a batch_id, asks Shotstack about every queued render, syncs the
 * "renders" table (status + final video_url when done) and returns all
 * 10 rows so the frontend can paint its progress grid.
 *
 * Deploy:  supabase functions deploy check-status --no-verify-jwt
 */

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve: (handler: (req: Request) => Promise<Response> | Response) => void;
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SHOTSTACK_API_KEY = Deno.env.get("SHOTSTACK_API_KEY") ?? "";
const SHOTSTACK_BASE = "https://api.shotstack.io/v1"; // production — matches generate-batch

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

async function db(path: string, init: RequestInit = {}): Promise<Response> {
  return await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
      ...(init.headers ?? {}),
    },
  });
}

interface RenderRow {
  id: string;
  batch_id: string;
  idea_index: number;
  story_text: string | null;
  shotstack_render_id: string | null;
  status: string;
  video_url: string | null;
  error_message: string | null;
  created_at: string;
}

async function syncWithShotstack(row: RenderRow): Promise<RenderRow> {
  if (row.status !== "rendering" || !row.shotstack_render_id) return row;

  try {
    const res = await fetch(`${SHOTSTACK_BASE}/render/${row.shotstack_render_id}`, {
      headers: { "x-api-key": SHOTSTACK_API_KEY },
    });
    if (!res.ok) {
      console.error(`shotstack status ${row.shotstack_render_id} → HTTP ${res.status}`);
      return row; // transient — report last known state, retry next poll
    }
    const data = await res.json();
    const s = data?.response?.status as string | undefined;

    if (s === "done" && data?.response?.url) {
      const patch = { status: "done", video_url: data.response.url };
      await db(`renders?id=eq.${row.id}`, { method: "PATCH", body: JSON.stringify(patch) });
      return { ...row, ...patch };
    }
    if (s === "failed") {
      const patch = {
        status: "error",
        error_message: String(data?.response?.error ?? "Shotstack render failed").slice(0, 400),
      };
      await db(`renders?id=eq.${row.id}`, { method: "PATCH", body: JSON.stringify(patch) });
      return { ...row, ...patch };
    }
    /* queued / fetching / rendering / saving → still cooking */
    return row;
  } catch (e) {
    console.error("poll failed", e);
    return row;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);

  try {
    const { batch_id } = await req.json();
    if (!batch_id || typeof batch_id !== "string") {
      return json({ ok: false, error: "batch_id (uuid) is required" }, 400);
    }
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return json({ ok: false, error: "function is missing SUPABASE_URL / SERVICE_ROLE env" }, 500);
    }

    const res = await db(
      `renders?batch_id=eq.${batch_id}&select=*&order=idea_index.asc`
    );
    if (!res.ok) {
      return json({ ok: false, error: `renders select failed: ${(await res.text()).slice(0, 240)}` }, 500);
    }
    const rows = (await res.json()) as RenderRow[];

    /* only rows already handed to Shotstack need syncing */
    const active = rows.filter((r) => r.status === "rendering" && r.shotstack_render_id);
    if (SHOTSTACK_API_KEY && active.length > 0) {
      const synced = await Promise.all(active.map(syncWithShotstack));
      const byId = new Map(synced.map((r) => [r.id, r]));
      return json({ ok: true, renders: rows.map((r) => byId.get(r.id) ?? r) });
    }
    return json({ ok: true, renders: rows });
  } catch (e) {
    console.error("check-status crashed", e);
    return json({ ok: false, error: String(e instanceof Error ? e.message : e) }, 500);
  }
});

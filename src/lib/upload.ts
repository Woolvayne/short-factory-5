/**
 * Uploads a finished short (in-memory Blob) to the Supabase "renders"
 * bucket so it gets a public HTTPS URL — required before handing it to
 * Buffer, since TikTok/Instagram/YouTube all reject posts without a
 * publicly reachable video/image.
 *
 * Direct browser → Supabase upload with the anon key (the "renders"
 * bucket is public with an anon-insert policy), no server round-trip,
 * no token dance — same pattern the app already uses elsewhere.
 */
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

const supabase = supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;

/** Cache so the same rendered clip isn't re-uploaded for every selected channel. */
const uploadCache = new Map<string, Promise<string>>();

function extFor(mime?: string): string {
  if (!mime) return "mp4";
  if (mime.includes("webm")) return "webm";
  if (mime.includes("quicktime")) return "mov";
  return "mp4";
}

/**
 * Upload one rendered clip and return its public URL.
 * `cacheKey` should uniquely identify the clip (e.g. `render-${index}`) so
 * repeated calls for the same clip (posting to multiple channels) reuse the
 * same upload instead of sending the bytes again.
 */
export async function uploadClipForBuffer(blob: Blob, cacheKey: string, mime?: string): Promise<string> {
  if (!supabase) {
    throw new Error(
      "Supabase ist nicht konfiguriert (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY fehlen). Ohne öffentliche Video-URL kann Buffer keine Posts mit Medien erstellen."
    );
  }

  const cached = uploadCache.get(cacheKey);
  if (cached) return cached;

  const path = `${cacheKey}-${Date.now()}.${extFor(mime || blob.type)}`;

  const promise = supabase.storage
    .from("renders")
    .upload(path, blob, {
      contentType: mime || blob.type || "video/mp4",
      upsert: true,
    })
    .then(({ error }) => {
      if (error) throw error;
      const { data } = supabase.storage.from("renders").getPublicUrl(path);
      return data.publicUrl;
    })
    .catch((e) => {
      uploadCache.delete(cacheKey); // allow retry on failure
      throw e;
    });

  uploadCache.set(cacheKey, promise);
  return promise;
}

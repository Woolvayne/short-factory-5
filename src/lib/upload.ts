/**
 * Video-Hosting für den Buffer-Versand.
 *
 * Buffer hat keinen Upload-Endpoint (docs: „Hosting Media") — das Video muss
 * unter einer dauerhaft erreichbaren, öffentlichen HTTPS-URL liegen (keine
 * signierten/ablaufenden Links, Buffer lädt erst beim Publish). Dafür dient
 * der öffentliche Supabase-„renders"-Bucket. Dateien dort bitte NICHT löschen,
 * solange Posts geplant sind.
 */
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

const supabase = supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;

function extFor(mime?: string): string {
  if (!mime) return "mp4";
  if (mime.includes("webm")) return "webm";
  if (mime.includes("quicktime")) return "mov";
  return "mp4";
}

/** Plattformen akzeptieren MP4/MOV/WebM — alles andere als MP4 deklarieren. */
function mimeFor(mime?: string): string {
  const m = (mime || "video/mp4").split(";")[0].trim().toLowerCase();
  if (m === "video/webm") return "video/webm";
  if (m === "video/quicktime" || m === "video/mov") return "video/quicktime";
  return "video/mp4";
}

/** Cache, damit derselbe Clip nicht mehrfach hochgeladen wird. */
const bufferUrlCache = new Map<string, Promise<string>>();

/**
 * Lädt einen fertigen Clip für den Buffer-Versand hoch und gibt die
 * öffentliche, stabile HTTPS-URL zurück. `cacheKey` identifiziert den Clip
 * (z. B. `manual-${index}`).
 */
export async function uploadClipForBuffer(
  blob: Blob,
  cacheKey: string,
  mime?: string
): Promise<string> {
  const cached = bufferUrlCache.get(cacheKey);
  if (cached) return cached;

  const promise = (async () => {
    if (!supabase) {
      throw new Error(
        "Buffer-Versand braucht Video-Hosting: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY konfigurieren (Buffer akzeptiert nur öffentliche HTTPS-URLs, keine Datei-Uploads)."
      );
    }
    const contentType = mimeFor(mime || blob.type);
    const path = `buffer/${cacheKey}-${Date.now()}.${extFor(contentType)}`;
    const { error } = await supabase.storage.from("renders").upload(path, blob, {
      contentType,
      upsert: true,
    });
    if (error) throw new Error(`Video-Hosting fehlgeschlagen: ${error.message || "Supabase-Upload abgelehnt."}`);
    const { data } = supabase.storage.from("renders").getPublicUrl(path);
    const url = data?.publicUrl || "";
    if (!/^https:\/\//i.test(url)) {
      throw new Error("Video-Hosting lieferte keine öffentliche HTTPS-URL.");
    }
    return url;
  })().catch((e) => {
    bufferUrlCache.delete(cacheKey); // Retry erlauben
    throw e;
  });

  bufferUrlCache.set(cacheKey, promise);
  return promise;
}

/**
 * Lädt einen Clip nur in den Supabase-"renders"-Bucket hoch (für lokale
 * Kalender-Vorschau ohne Buffer-Key). Gibt die öffentliche URL zurück.
 */
export async function uploadClipPreview(
  blob: Blob,
  cacheKey: string,
  mime?: string
): Promise<string | null> {
  if (!supabase) return null;
  try {
    const path = `${cacheKey}-${Date.now()}.${extFor(mime || blob.type)}`;
    const { error } = await supabase.storage.from("renders").upload(path, blob, {
      contentType: mime || blob.type || "video/mp4",
      upsert: true,
    });
    if (error) return null;
    return supabase.storage.from("renders").getPublicUrl(path).data.publicUrl;
  } catch {
    return null;
  }
}

/**
 * Video-Upload für den Postlake-Versand.
 *
 * Primärweg (empfohlen, kein Extra-Setup):
 *   1. Frontend fragt /api/postlake (action "media-sign") nach einer
 *      signierten PUT-URL (POST /v1/media/batch, JSON). Der POSTLAKE_API_KEY
 *      bleibt serverseitig — der Browser sieht ihn nie.
 *   2. Browser lädt die Render-Bytes per PUT direkt hoch (5-Min-Fenster).
 *   3. Die zurückgegebene med_…-ID wandert in POST /v1/posts als `media`.
 *
 * Fallback: Supabase-"renders"-Bucket (öffentliche URL) + serverseitiger
 * URL-Ingest/Forward (action "media-from-url") — für den Fall, dass der
 * Signierweg einmal nicht zur Verfügung steht.
 */
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

const supabase = supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;

/** Cache, damit derselbe Clip nicht mehrfach hochgeladen wird. */
const uploadCache = new Map<string, Promise<string>>();

function extFor(mime?: string): string {
  if (!mime) return "mp4";
  if (mime.includes("webm")) return "webm";
  if (mime.includes("quicktime")) return "mov";
  return "mp4";
}

/** Postlake akzeptiert MP4/MOV/WebM (Doku) — alles andere als MP4 deklarieren. */
function mimeFor(mime?: string): string {
  const m = (mime || "video/mp4").split(";")[0].trim().toLowerCase();
  if (m === "video/webm") return "video/webm";
  if (m === "video/quicktime" || m === "video/mov") return "video/quicktime";
  return "video/mp4";
}

async function signUpload(contentType: string, sizeBytes: number): Promise<{
  uploadUrl: string;
  headers: Record<string, string>;
  mediaId: string;
}> {
  const res = await fetch("/api/postlake", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "media-sign", contentType, sizeBytes }),
  });
  const data = await res.json();
  if (!data?.ok || !data.uploadUrl || !data.mediaId) {
    throw new Error(data?.error || "Postlake Media-Sign fehlgeschlagen.");
  }
  return { uploadUrl: data.uploadUrl, headers: data.headers || {}, mediaId: data.mediaId };
}

async function uploadViaSignedPut(blob: Blob, contentType: string): Promise<string> {
  const { uploadUrl, headers, mediaId } = await signUpload(contentType, blob.size);
  // Signierte URLs verlangen EXAKT die vorgegebenen Header — Content-Type nur
  // ergänzen, wenn er (case-insensitiv) nicht bereits vorhanden ist, sonst
  // kann der Header-Mix die Signatur brechen (HTTP 403/InvalidHeaders).
  const putHeaders: Record<string, string> = { ...(headers || {}) };
  if (!Object.keys(putHeaders).some((k) => k.toLowerCase() === "content-type")) {
    putHeaders["Content-Type"] = contentType;
  }
  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: putHeaders,
    body: blob,
  });
  if (!put.ok) {
    // Fehler-Body (gekürzt) mitschleifen — signierte Endpunkte erklären dort den Grund.
    const errText = (await put.text().catch(() => "")).slice(0, 160);
    throw new Error(
      `Upload zu Postlake fehlgeschlagen (HTTP ${put.status})${errText ? `: ${errText}` : "."}`
    );
  }
  return mediaId;
}

async function uploadViaSupabaseThenIngest(
  blob: Blob,
  cacheKey: string,
  contentType: string,
  primaryError?: unknown
): Promise<string> {
  const primaryHint = () => {
    const m = primaryError instanceof Error ? primaryError.message : String(primaryError || "");
    return m ? ` (Primärweg zuvor: ${m.slice(0, 160)})` : "";
  };
  if (!supabase) {
    throw new Error(
      `Weder Postlake-Signierung noch Supabase verfügbar${primaryHint()}: POSTLAKE_API_KEY auf dem Server setzen (empfohlen) oder VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY konfigurieren.`
    );
  }
  const path = `${cacheKey}-${Date.now()}.${extFor(contentType)}`;
  const { error } = await supabase.storage.from("renders").upload(path, blob, {
    contentType,
    upsert: true,
  });
  if (error) throw new Error(`${error.message || "Supabase-Upload fehlgeschlagen."}${primaryHint()}`);
  const { data } = supabase.storage.from("renders").getPublicUrl(path);

  const res = await fetch("/api/postlake", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "media-from-url", url: data.publicUrl, contentType }),
  });
  const out = await res.json();
  if (!out?.ok || !out.mediaId) {
    throw new Error(
      `${out?.error || "Medien-Übergabe an Postlake fehlgeschlagen."}${primaryHint()}`
    );
  }
  return out.mediaId as string;
}

/**
 * Lädt einen fertigen Clip hoch und gibt die Postlake-Medien-ID (med_…)
 * zurück. `cacheKey` identifiziert den Clip (z. B. `render-${index}`).
 */
export async function uploadClipForPostlake(
  blob: Blob,
  cacheKey: string,
  mime?: string
): Promise<string> {
  const cached = uploadCache.get(cacheKey);
  if (cached) return cached;

  const contentType = mimeFor(mime || blob.type);

  const promise = (async () => {
    try {
      return await uploadViaSignedPut(blob, contentType);
    } catch (signErr) {
      console.warn("Postlake-Signierung nicht möglich, nutze Supabase-Fallback:", signErr);
      // Primärfehler einketten, damit die Fallback-Fehlermeldung beide Diagnosen zeigt
      return await uploadViaSupabaseThenIngest(blob, cacheKey, contentType, signErr);
    }
  })().catch((e) => {
    uploadCache.delete(cacheKey); // Retry erlauben
    throw e;
  });

  uploadCache.set(cacheKey, promise);
  return promise;
}

/**
 * Lädt einen fertigen Clip für den BUFFER-Versand hoch und gibt die
 * öffentliche, stabile HTTPS-URL zurück.
 *
 * Buffer hat keinen Upload-Endpoint (docs: „Hosting Media") — das Video muss
 * unter einer dauerhaft erreichbaren URL liegen (keine signierten/ablaufenden
 * Links, Buffer lädt erst beim Publish). Dafür dient der öffentliche
 * Supabase-„renders"-Bucket. Dateien dort bitte NICHT löschen, solange Posts
 * geplant sind.
 */
const bufferUrlCache = new Map<string, Promise<string>>();

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
 * Kalender-Vorschau ohne Postlake-Key). Gibt die öffentliche URL zurück.
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

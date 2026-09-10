/**
 * Uploads a finished short (in-memory Blob) to Vercel Blob storage so it
 * gets a public HTTPS URL — required before handing it to Buffer, since
 * TikTok/Instagram/YouTube all reject posts without a publicly reachable
 * video/image.
 *
 * Direct browser → Blob upload (via a short-lived client token issued by
 * api/upload.js), so the video never round-trips through a serverless
 * function body-size limit.
 */
import { upload } from "@vercel/blob/client";

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
  const cached = uploadCache.get(cacheKey);
  if (cached) return cached;

  const filename = `shortsfactory/${cacheKey}-${Date.now()}.${extFor(mime || blob.type)}`;

  const promise = upload(filename, blob, {
    access: "public",
    handleUploadUrl: "/api/upload",
    contentType: mime || blob.type || "video/mp4",
  })
    .then((result) => result.url)
    .catch((e) => {
      uploadCache.delete(cacheKey); // allow retry on failure
      throw e;
    });

  uploadCache.set(cacheKey, promise);
  return promise;
}

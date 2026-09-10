// Vercel Serverless Function — issues short-lived client tokens for direct
// browser-to-Vercel-Blob uploads (@vercel/blob/client). Needed because
// Buffer/TikTok/Instagram require a public HTTPS URL for media, and the
// finished shorts only exist as in-memory blobs in the browser otherwise.
//
// Zero extra config: as soon as a Blob store is attached to this Vercel
// project (Storage → Create Database → Blob), BLOB_READ_WRITE_TOKEN is
// injected automatically — nothing to set by hand.
import { handleUpload } from "@vercel/blob/client";

export const config = {
  runtime: "nodejs",
  maxDuration: 60,
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Nur POST erlaubt." });
  }

  // Kein manueller Zugangsdaten-Check hier: @vercel/blob löst sowohl das
  // klassische BLOB_READ_WRITE_TOKEN als auch die neuere OIDC-Authentifizierung
  // (VERCEL_OIDC_TOKEN, automatisch bei verknüpften Blob Stores ohne
  // langlebiges Token) selbst auf. Ein eigener Vorab-Check auf
  // BLOB_READ_WRITE_TOKEN würde OIDC-Setups fälschlich blockieren.

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body ?? {});
  } catch {
    return res.status(400).json({ error: "Ungültiger JSON-Body." });
  }

  try {
    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: [
          "video/mp4",
          "video/webm",
          "video/quicktime",
          "image/jpeg",
          "image/png",
          "image/webp",
        ],
        addRandomSuffix: true,
        maximumSizeInBytes: 500 * 1024 * 1024, // 500 MB — plenty for a 9:16 short
      }),
      onUploadCompleted: async () => {
        // No server-side bookkeeping needed — the caller gets the public
        // URL back directly from upload() and uses it immediately.
      },
    });
    return res.status(200).json(jsonResponse);
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
}

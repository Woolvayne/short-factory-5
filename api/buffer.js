/**
 * DEPRECATED: Buffer API relay has been removed.
 * All social media scheduling now goes through Zernio only.
 * 
 * This file is kept for reference but should not be used.
 * 
 * See: api/zernio.js for the current implementation.
 */

export const config = {
  runtime: "nodejs",
  maxDuration: 60,
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

  if (req.method === "OPTIONS") return res.status(204).end();

  return res.status(410).json({
    ok: false,
    error: "Buffer API integration has been deprecated. Please use Zernio (/api/zernio) for all social media scheduling.",
  });
}

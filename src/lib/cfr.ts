/**
 * Forces a genuinely constant frame rate on a rendered clip using
 * ffmpeg.wasm (`-vsync cfr`) — the same industry-standard technique nearly
 * every professional video pipeline uses before handing footage to a
 * platform like TikTok/Instagram/YouTube.
 *
 * Why this exists: browsers timestamp MediaRecorder/WebCodecs output based
 * on real capture time. Under any real-world irregularity — a slow device,
 * a backgrounded tab, a long batch of renders back to back, even ordinary
 * garbage-collection pauses — those timestamps end up unevenly spaced,
 * producing a *variable* frame rate file even when the nominal fps setting
 * looks correct. TikTok's ingestion validates for a truly constant rate and
 * rejects anything else. Rather than trying to make the capture itself
 * perfectly even (which real-time browser APIs fundamentally cannot
 * guarantee), this step re-encodes the finished file with explicit,
 * evenly-spaced frame timestamps — the same fix used industry-wide.
 *
 * Uses the single-threaded ffmpeg-core build, which needs no
 * cross-origin-isolation (COOP/COEP) headers — this app has none, and the
 * multi-threaded build would silently fail to load without them.
 */
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL, fetchFile } from "@ffmpeg/util";

const CORE_BASE_URL = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd";

let ffmpegPromise: Promise<FFmpeg> | null = null;

async function getFFmpeg(): Promise<FFmpeg> {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const ffmpeg = new FFmpeg();
      await ffmpeg.load({
        coreURL: await toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.wasm`, "application/wasm"),
      });
      return ffmpeg;
    })().catch((e) => {
      ffmpegPromise = null; // allow retrying on a later render
      throw e;
    });
  }
  return ffmpegPromise;
}

export async function forceConstantFrameRate(
  input: Blob,
  fps: number,
  onProgress?: (ratio: number) => void
): Promise<Blob> {
  const ffmpeg = await getFFmpeg();

  const inName = "in" + (input.type.includes("webm") ? ".webm" : ".mp4");
  const outName = "out.mp4";

  const progressHandler = ({ progress }: { progress: number }) => {
    if (Number.isFinite(progress)) onProgress?.(Math.max(0, Math.min(1, progress)));
  };
  ffmpeg.on("progress", progressHandler);

  try {
    await ffmpeg.writeFile(inName, await fetchFile(input));
    await ffmpeg.exec([
      "-i",
      inName,
      "-r",
      String(fps),
      "-vsync",
      "cfr",
      "-c:v",
      "libx264",
      "-profile:v",
      "main",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      outName,
    ]);
    const data = await ffmpeg.readFile(outName);
    const bytes =
      data instanceof Uint8Array ? new Uint8Array(data) : new TextEncoder().encode(String(data));
    return new Blob([bytes], { type: "video/mp4" });
  } finally {
    ffmpeg.off("progress", progressHandler);
    try {
      await ffmpeg.deleteFile(inName);
    } catch { /* noop */ }
    try {
      await ffmpeg.deleteFile(outName);
    } catch { /* noop */ }
  }
}

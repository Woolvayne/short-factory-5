/**
 * Forces a genuinely constant 60 fps on a rendered clip using ffmpeg.wasm's
 * `minterpolate` filter — the same class of technique professional video
 * pipelines use before handing footage to a platform like TikTok/Instagram.
 *
 * Why this exists: browsers timestamp MediaRecorder/WebCodecs output based
 * on real capture time. Under any real-world irregularity — a slow device,
 * a backgrounded tab, a long batch of renders back to back, even ordinary
 * garbage-collection pauses — those timestamps end up unevenly spaced,
 * producing a *variable* frame rate file even when the nominal fps setting
 * looks correct. TikTok's ingestion validates for a truly constant rate and
 * rejects anything else.
 *
 * Using `minterpolate` instead of a plain `-r 60` also means clips whose
 * source content is effectively lower-motion-resolution (e.g. captured from
 * 24/30fps background footage) get real frame-blended interpolation up to
 * 60fps rather than naive frame duplication — smoother output, not just a
 * technically-correct frame count.
 *
 * Uses the single-threaded ffmpeg-core build, which needs no
 * cross-origin-isolation (COOP/COEP) headers — this app has none, and the
 * multi-threaded build would silently fail to load without them.
 */
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL, fetchFile } from "@ffmpeg/util";

const CORE_BASE_URL = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd";

/* Ohne diese Timeouts kann ein einzelner hängender Schritt (CDN langsam/
   blockiert beim Laden, oder minterpolate zu rechenintensiv bei 60fps auf
   schwächeren Geräten) den Render-Fortschrittsbalken für IMMER blockieren —
   und zwar nicht nur für dieses Video, sondern für jeden weiteren
   Render-Versuch in derselben Sitzung, weil `ffmpegPromise` unten sonst nie
   zurückgesetzt wird. */
const LOAD_TIMEOUT_MS = 20_000;
const INTERPOLATE_TIMEOUT_MS = 30_000;
const PLAIN_ENCODE_TIMEOUT_MS = 60_000;

/* CRASH-FIX: Core-Blobs werden genau EINMAL geladen und gecacht. Jeder
   frische Worker (nach Timeout/OOM/Terminate) bekommt sie sonst per erneuem
   ~31-MB-Download von unpkg — langsamer (LOAD-Timeout-Kaskaden) und
   unnötiger Speicher-Churn genau dann, wenn der Tab ohnehin am Limit ist. */
let coreURLsCache: { coreURL: string; wasmURL: string } | null = null;

async function getCoreURLs(): Promise<{ coreURL: string; wasmURL: string }> {
  if (!coreURLsCache) {
    coreURLsCache = {
      coreURL: await toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.wasm`, "application/wasm"),
    };
  }
  return coreURLsCache;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

let ffmpegPromise: Promise<FFmpeg> | null = null;

async function getFFmpeg(): Promise<FFmpeg> {
  if (!ffmpegPromise) {
    ffmpegPromise = withTimeout(
      (async () => {
        const ffmpeg = new FFmpeg();
        const { coreURL, wasmURL } = await getCoreURLs();
        await ffmpeg.load({ coreURL, wasmURL });
        return ffmpeg;
      })(),
      LOAD_TIMEOUT_MS,
      "ffmpeg-core laden"
    ).catch((e) => {
      ffmpegPromise = null; // allow retrying on a later render, don't poison the cache forever
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
  let ffmpeg = await getFFmpeg();

  const inName = "in" + (input.type.includes("webm") ? ".webm" : ".mp4");
  const outName = "out.mp4";

  let progressHandler = ({ progress }: { progress: number }) => {
    if (Number.isFinite(progress)) onProgress?.(Math.max(0, Math.min(1, progress)));
  };
  ffmpeg.on("progress", progressHandler);

  /* If a step times out below, the WASM worker may still be churning away
     on it in the background — ffmpeg.wasm can only run one command at a
     time, so reusing that same instance for a fallback attempt (or for
     the *next* render) could hang or corrupt the result. Terminate and
     start a fresh worker whenever a step times out. */
  const restartWorker = async () => {
    try {
      ffmpeg.off("progress", progressHandler);
      ffmpeg.terminate();
    } catch { /* already gone */ }
    ffmpegPromise = null;
    ffmpeg = await getFFmpeg();
    progressHandler = ({ progress }: { progress: number }) => {
      if (Number.isFinite(progress)) onProgress?.(Math.max(0, Math.min(1, progress)));
    };
    ffmpeg.on("progress", progressHandler);
    await ffmpeg.writeFile(inName, await fetchFile(input));
  };

  try {
    await ffmpeg.writeFile(inName, await fetchFile(input));
    try {
      await withTimeout(
        ffmpeg.exec([
          "-i",
          inName,
          "-vf",
          `minterpolate=fps=${fps}:mi_mode=blend`,
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
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
        ]),
        INTERPOLATE_TIMEOUT_MS,
        "minterpolate-Encoding"
      );
    } catch (e) {
      /* minterpolate can be too slow/memory-hungry for very long clips on
         weaker devices — fall back to a plain, guaranteed-CFR duplicate-
         frame re-encode on a fresh worker rather than losing the render
         entirely. Still hits exactly `fps`, just without motion-blended
         smoothing. */
      console.warn("minterpolate failed or timed out, falling back to plain CFR re-encode:", e);
      await restartWorker();
      await withTimeout(
        ffmpeg.exec([
          "-i",
          inName,
          "-r",
          String(fps),
          "-vsync",
          "cfr",
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
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
        ]),
        PLAIN_ENCODE_TIMEOUT_MS,
        "CFR-Encoding"
      );
    }
    const data = await ffmpeg.readFile(outName);
    const bytes =
      data instanceof Uint8Array ? new Uint8Array(data) : new TextEncoder().encode(String(data));
    return new Blob([bytes], { type: "video/mp4" });
  } catch (e) {
    /* Whatever failed, make sure the *next* render doesn't inherit a
       possibly-still-busy worker — the finally block below terminates it
       and frees the whole WASM heap, so no extra restart is needed here. */
    throw e;
  } finally {
    try {
      ffmpeg.off("progress", progressHandler);
    } catch { /* noop */ }
    try {
      await ffmpeg.deleteFile(inName);
    } catch { /* noop */ }
    try {
      await ffmpeg.deleteFile(outName);
    } catch { /* noop */ }

    /* CRASH-FIX: Der WASM-Heap von ffmpeg.wasm wächst nur (hartes 2-GB-Limit
       im Core) und wird vom Browser erst freigegeben, wenn der Worker
       terminiert wird. Bliebe die Instanz gecacht, stünde die
       High-Water-Mark des bisher schlimmsten Clips dauerhaft im Speicher —
       über eine 10er-Batch bzw. endlose Autopilot-Runden summiert sich das
       mit den fertigen Video-Blobs, bis der Tab mit OOM abstürzt. Deshalb:
       nach jedem Clip bewusst terminieren; der nächste Render startet mit
       einem frischen, kleinen Heap (die Core-Blobs sind gecacht, ein Reload
       kostet nur die WASM-Kompilierung, keinen erneuten Download). */
    try {
      ffmpeg.terminate();
    } catch { /* already gone */ }
    ffmpegPromise = null;
  }
}

/** Media probing + formatting helpers — all local, all Safari-safe. */

export function probeVideo(
  file: File
): Promise<{ width: number; height: number; duration: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const objectUrl = URL.createObjectURL(file);
    const timer = window.setTimeout(() => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Timed out reading video metadata"));
    }, 10000);
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.onloadedmetadata = () => {
      window.clearTimeout(timer);
      const meta = {
        width: video.videoWidth,
        height: video.videoHeight,
        duration: isFinite(video.duration) ? video.duration : 0,
      };
      URL.revokeObjectURL(objectUrl);
      resolve(meta);
    };
    video.onerror = () => {
      window.clearTimeout(timer);
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Unreadable video file"));
    };
    video.src = objectUrl;
  });
}

export function probeAudio(file: File): Promise<number> {
  return new Promise((resolve) => {
    const audio = document.createElement("audio");
    const objectUrl = URL.createObjectURL(file);
    const timer = window.setTimeout(() => {
      URL.revokeObjectURL(objectUrl);
      resolve(0);
    }, 8000);
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      window.clearTimeout(timer);
      const d = audio.duration;
      URL.revokeObjectURL(objectUrl);
      resolve(isFinite(d) ? d : 0);
    };
    audio.onerror = () => {
      window.clearTimeout(timer);
      URL.revokeObjectURL(objectUrl);
      resolve(0);
    };
    audio.src = objectUrl;
  });
}

export const isPortrait916 = (w: number, h: number) =>
  w > 0 && h > 0 && Math.abs(w / h - 9 / 16) < 0.03;

export function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDuration(s: number): string {
  if (!isFinite(s) || s <= 0) return "—";
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return m > 0 ? `${m}:${String(sec).padStart(2, "0")}` : `0:${String(sec).padStart(2, "0")}`;
}

export const formatClock = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

export const uid = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const shuffle = <T,>(arr: T[]): T[] => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

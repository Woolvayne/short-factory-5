import { useRef, useState } from "react";
import {
  Check,
  CircleAlert,
  Dices,
  Film,
  FolderOpen,
  Info,
  Layers,
  Link2,
  Loader2,
  Scissors,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import Section from "./Section";
import { cn } from "../utils/cn";
import type { BgFile } from "../lib/types";
import { frameRateNote, isLowFrameRate, sourceFpsLabel } from "../lib/quality";
import { TARGET_FPS } from "../lib/settings";
import type { ClipPlan, ClipSource, PlatformInfo } from "../lib/clips";
import { timecode } from "../lib/clips";
import { formatBytes, formatDuration } from "../lib/media";

export type SourceMode = "single" | "files";

export interface FetchState {
  active: boolean;
  received: number;
  total: number;
  error: string | null;
  platform: PlatformInfo | null;
}

export default function ClipMill({
  mode,
  onModeChange,
  /* single-source */
  source,
  clips,
  fetchState,
  linkValue,
  onLinkChange,
  onLoadLink,
  onPickSource,
  onClearSource,
  onReslice,
  onRerollClip,
  /* multi-file */
  bgs,
  onAddFiles,
  onRemoveFile,
  onClearFiles,
  disabled,
}: {
  mode: SourceMode;
  onModeChange: (m: SourceMode) => void;
  source: ClipSource | null;
  clips: ClipPlan[];
  fetchState: FetchState;
  linkValue: string;
  onLinkChange: (v: string) => void;
  onLoadLink: () => void;
  onPickSource: (f: File) => void;
  onClearSource: () => void;
  onReslice: () => void;
  onRerollClip: (id: string) => void;
  bgs: BgFile[];
  onAddFiles: (files: File[]) => void;
  onRemoveFile: (id: string) => void;
  onClearFiles: () => void;
  disabled?: boolean;
}) {
  const singleRef = useRef<HTMLInputElement>(null);
  const multiRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  const readyFiles = bgs.filter((b) => b.status === "ready").length;
  const complete = mode === "single" ? clips.length === 10 && !!source : readyFiles === 10;

  return (
    <Section
      index="02"
      title="Clip Mill"
      hint={mode === "single" ? `${clips.length}/10 CLIPS CUT` : `${readyFiles}/10 LOADED`}
      complete={complete}
      aside={
        <div className="flex gap-1">
          {(
            [
              ["single", "1 SOURCE → 10", Scissors],
              ["files", "10 FILES", Layers],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              disabled={disabled}
              onClick={() => onModeChange(id)}
              className={cn(
                "flex min-h-[32px] items-center gap-1.5 border px-2.5 py-1 font-mono text-[9.5px] font-bold tracking-widest transition-colors disabled:opacity-40",
                mode === id
                  ? "bg-heat border-volt-400 text-coal-950"
                  : "border-coal-600 text-coal-300 hover:border-coal-400"
              )}
            >
              <Icon className="size-3" /> {label}
            </button>
          ))}
        </div>
      }
    >
      {/* ============================ SINGLE SOURCE ============================ */}
      {mode === "single" && (
        <div className="grid gap-4">
          {!source ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {/* pick a local file */}
              <button
                type="button"
                disabled={disabled}
                onClick={() => singleRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (!disabled) setDrag(true);
                }}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDrag(false);
                  const f = Array.from(e.dataTransfer.files).find(
                    (x) => x.type.startsWith("video/") || /\.(mp4|mov|m4v|webm)$/i.test(x.name)
                  );
                  if (f && !disabled) onPickSource(f);
                }}
                className={cn(
                  "group relative flex flex-col items-center justify-center gap-2 border border-dashed px-4 py-8 text-center transition-all",
                  drag
                    ? "border-volt-400 bg-volt-400/10"
                    : "border-coal-600 bg-coal-850/60 hover:border-coal-400 hover:bg-coal-800/60",
                  disabled && "cursor-not-allowed opacity-40"
                )}
              >
                {drag && <div className="hazard absolute inset-x-0 top-0 h-1 animate-belt" />}
                <input
                  ref={singleRef}
                  type="file"
                  accept="video/mp4,video/quicktime,video/x-m4v,video/webm,.mp4,.mov,.m4v,.webm"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onPickSource(f);
                    e.target.value = "";
                  }}
                />
                <FolderOpen className="size-7 text-coal-400 group-hover:text-coal-200" strokeWidth={1.6} />
                <span className="font-display text-xs font-black tracking-[0.12em] text-coal-200 uppercase">
                  Pick one long video
                </span>
                <span className="font-mono text-[10px] leading-relaxed tracking-wider text-coal-400">
                  IT GETS SLICED INTO 10 CLIPS AUTOMATICALLY · MP4 / MOV / WEBM · STAYS ON DEVICE
                </span>
                <span className="mt-1 inline-flex items-center gap-1.5 border border-coal-600 px-3 py-1.5 font-mono text-[10px] font-bold tracking-widest text-coal-200 group-hover:border-volt-400 group-hover:text-volt-300">
                  TAP TO BROWSE
                </span>
              </button>

              {/* paste a direct link */}
              <div className="flex flex-col gap-2 border border-coal-700/80 bg-coal-850/60 p-4">
                <div className="flex items-center gap-2">
                  <Link2 className="size-4 text-coal-300" />
                  <span className="font-display text-xs font-black tracking-[0.12em] text-coal-200 uppercase">
                    …or paste a video link
                  </span>
                </div>
                <div className="flex items-stretch border border-coal-700 bg-coal-900 focus-within:border-volt-400/70">
                  <input
                    type="url"
                    inputMode="url"
                    value={linkValue}
                    disabled={disabled || fetchState.active}
                    onChange={(e) => onLinkChange(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && onLoadLink()}
                    placeholder="https://…/clip.mp4  or a YouTube link"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    className="min-w-0 flex-1 bg-transparent px-3 py-2.5 font-mono text-[11px] text-paper-100 placeholder:text-coal-500 focus:outline-none disabled:opacity-50"
                  />
                  <button
                    type="button"
                    onClick={onLoadLink}
                    disabled={disabled || fetchState.active || !linkValue.trim()}
                    className="min-h-[44px] border-l border-coal-700 bg-coal-800 px-3 font-mono text-[10px] font-bold tracking-widest text-volt-300 transition-colors hover:bg-volt-400 hover:text-coal-950 disabled:opacity-40"
                  >
                    {fetchState.active ? <Loader2 className="size-3.5 animate-spin" /> : "LOAD"}
                  </button>
                </div>

                {fetchState.active && (
                  <div>
                    <div className="h-1 w-full overflow-hidden bg-coal-800">
                      <div
                        className="h-full bg-volt-400 transition-[width] duration-300"
                        style={{
                          width: `${fetchState.total ? (fetchState.received / fetchState.total) * 100 : 25}%`,
                        }}
                      />
                    </div>
                    <p className="mt-1 font-mono text-[9px] tracking-wider text-coal-400">
                      DOWNLOADING {formatBytes(fetchState.received)}
                      {fetchState.total ? ` / ${formatBytes(fetchState.total)}` : ""}
                    </p>
                  </div>
                )}

                {fetchState.error && !fetchState.platform && (
                  <div className="flex items-start gap-2 border border-rose-err/50 bg-rose-err/10 px-3 py-2">
                    <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-rose-err" />
                    <p className="font-mono text-[10px] leading-relaxed text-rose-err">
                      {fetchState.error}
                    </p>
                  </div>
                )}

                {/* platform (YouTube etc.) guidance */}
                {fetchState.platform && (
                  <div className="border border-amber-warn/50 bg-amber-warn/10 px-3 py-2.5">
                    <div className="flex items-start gap-2">
                      <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-warn" />
                      <div className="min-w-0">
                        <p className="font-display text-[11px] font-black tracking-wide text-amber-warn uppercase">
                          {fetchState.platform.platform} links can't be downloaded here
                        </p>
                        <p className="mt-1 font-mono text-[9.5px] leading-relaxed text-coal-200">
                          {fetchState.platform.note}
                        </p>
                        <ul className="mt-2 grid gap-1">
                          {fetchState.platform.steps.map((s, i) => (
                            <li
                              key={i}
                              className="flex gap-2 font-mono text-[9.5px] leading-relaxed text-coal-300"
                            >
                              <span className="text-volt-400">{i + 1}.</span>
                              <span>{s}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                )}

                <p className="mt-auto flex items-start gap-1.5 font-mono text-[9px] leading-relaxed tracking-wider text-coal-500">
                  <Info className="mt-0.5 size-3 shrink-0" />
                  DIRECT LINKS MUST ALLOW CROSS-ORIGIN ACCESS (YOUR OWN HOSTING, S3/R2, PEXELS,
                  COVERR, MIXKIT). ONLY USE FOOTAGE YOU HAVE THE RIGHTS TO.
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* loaded source header */}
              <div className="flex flex-wrap items-center justify-between gap-3 border border-coal-600 bg-coal-850 p-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="grid size-10 shrink-0 place-items-center border border-coal-600 bg-coal-900 text-volt-400">
                    <Film className="size-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-mono text-[11px] text-coal-100" title={source.name}>
                      {source.name}
                    </p>
                    <p className="font-mono text-[9px] tracking-wider text-coal-400">
                      {source.width}×{source.height} · {formatDuration(source.duration)}
                      {source.size ? ` · ${formatBytes(source.size)}` : ""} ·{" "}
                      {source.fps != null ? `${sourceFpsLabel(source.fps)} FPS` : "FPS ?"} ·{" "}
                      {source.origin === "url" ? "REMOTE → CACHED LOCALLY" : "LOCAL FILE"}
                      {!source.portrait && " · WILL BE CENTRE-CROPPED TO 9:16"}
                    </p>
                    <p
                      className={cn(
                        "font-mono text-[8.5px] tracking-wider",
                        isLowFrameRate(source.fps) ? "text-amber-warn" : "text-mint-400"
                      )}
                    >
                      {frameRateNote(source.fps ?? null, isLowFrameRate(source.fps))} · OUTPUT{" "}
                      {TARGET_FPS} FPS
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onReslice}
                    disabled={disabled}
                    className="flex min-h-[36px] items-center gap-1.5 border border-coal-600 px-3 py-1.5 font-mono text-[10px] font-bold tracking-widest text-coal-200 transition-colors hover:border-volt-400 hover:text-volt-300 disabled:opacity-40"
                  >
                    <Scissors className="size-3" /> RE-SLICE
                  </button>
                  <button
                    type="button"
                    onClick={onClearSource}
                    disabled={disabled}
                    className="flex min-h-[36px] items-center gap-1.5 border border-coal-600 px-3 py-1.5 font-mono text-[10px] font-bold tracking-widest text-coal-300 transition-colors hover:border-rose-err hover:text-rose-err disabled:opacity-40"
                  >
                    <Trash2 className="size-3" /> EJECT
                  </button>
                </div>
              </div>

              {/* the 10 cut windows */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
                {clips.map((c) => (
                  <div
                    key={c.id}
                    className="group relative flex min-h-[76px] flex-col justify-between border border-coal-600 bg-coal-850 p-2"
                  >
                    <div className="flex items-start justify-between">
                      <span className="font-mono text-[10px] font-bold text-volt-400 tabular-nums">
                        {String(c.index + 1).padStart(2, "0")}
                      </span>
                      <Check className="size-3.5 text-volt-400" />
                    </div>
                    <div>
                      <p className="font-mono text-[11px] font-bold text-coal-100 tabular-nums">
                        {timecode(c.start)}
                      </p>
                      <p className="font-mono text-[8.5px] tracking-wider text-coal-400">
                        → {timecode(c.start + c.length)} · {Math.round(c.length)}s
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onRerollClip(c.id)}
                      disabled={disabled}
                      title="Pick another moment"
                      className="absolute top-1 right-1 grid size-7 place-items-center text-coal-400 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 max-md:opacity-100 hover:text-volt-300 disabled:opacity-30"
                    >
                      <Dices className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              <p className="flex items-start gap-2 font-mono text-[10px] leading-relaxed tracking-wider text-coal-400">
                <Scissors className="mt-0.5 size-3.5 shrink-0 text-coal-500" />
                EACH STORY GETS ITS OWN WINDOW OUT OF THE SAME SOURCE — TWEAK DISTRIBUTION, SKIP
                INTRO/OUTRO AND LENGTH UNDER SETTINGS → CLIPS.
              </p>
            </>
          )}
        </div>
      )}

      {/* ============================= 10 FILES ============================= */}
      {mode === "files" && (
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <button
            type="button"
            disabled={disabled || bgs.length >= 10}
            onClick={() => multiRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              if (!disabled) setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              if (!disabled) onAddFiles(Array.from(e.dataTransfer.files));
            }}
            className={cn(
              "group relative flex flex-col items-center justify-center gap-2 border border-dashed px-4 py-9 text-center transition-all",
              drag
                ? "border-volt-400 bg-volt-400/10"
                : "border-coal-600 bg-coal-850/60 hover:border-coal-400 hover:bg-coal-800/60",
              (disabled || bgs.length >= 10) && "cursor-not-allowed opacity-40"
            )}
          >
            <input
              ref={multiRef}
              type="file"
              multiple
              accept="video/mp4,video/quicktime,video/x-m4v,.mp4,.mov,.m4v"
              onChange={(e) => {
                onAddFiles(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
            <Layers className="size-7 text-coal-400 group-hover:text-coal-200" strokeWidth={1.6} />
            <span className="font-display text-xs font-black tracking-[0.12em] text-coal-200 uppercase">
              {bgs.length >= 10 ? "ROSTER FULL — 10/10" : "PICK 10 VERTICAL VIDEOS"}
            </span>
            <span className="font-mono text-[10px] leading-relaxed tracking-wider text-coal-400">
              9:16 PORTRAIT · MP4 / MOV FROM YOUR CAMERA ROLL · ONE PER STORY
            </span>
            <span className="mt-1 inline-flex items-center gap-1.5 border border-coal-600 px-3 py-1.5 font-mono text-[10px] font-bold tracking-widest text-coal-200 group-hover:border-volt-400 group-hover:text-volt-300">
              TAP TO BROWSE
            </span>
          </button>

          <div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
              {Array.from({ length: 10 }).map((_, i) => {
                const bg = bgs[i];
                return (
                  <div
                    key={bg?.id ?? `empty-${i}`}
                    className={cn(
                      "group relative flex min-h-[96px] flex-col justify-between border p-2",
                      !bg && "border-dashed border-coal-700/70 bg-coal-850/40",
                      bg?.status === "ready" && "border-coal-600 bg-coal-850",
                      bg?.status === "validating" && "border-amber-warn/60 bg-coal-850",
                      bg?.status === "error" && "border-rose-err/60 bg-coal-850"
                    )}
                  >
                    <div className="flex items-start justify-between gap-1">
                      <span
                        className={cn(
                          "font-mono text-[10px] font-bold tabular-nums",
                          bg ? "text-volt-400" : "text-coal-500"
                        )}
                      >
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      {bg?.status === "ready" && <Check className="size-3.5 text-volt-400" />}
                      {bg?.status === "validating" && (
                        <Loader2 className="size-3.5 animate-spin text-amber-warn" />
                      )}
                      {bg?.status === "error" && (
                        <TriangleAlert className="size-3.5 text-rose-err" />
                      )}
                    </div>
                    <div className="min-w-0">
                      {bg ? (
                        <>
                          <p className="truncate font-mono text-[9.5px] text-coal-200" title={bg.file.name}>
                            {bg.file.name}
                          </p>
                          <p className="mt-0.5 font-mono text-[9px] leading-snug text-coal-400">
                            {bg.status === "error"
                              ? bg.reason ?? "REJECTED"
                              : bg.status === "validating"
                                ? "FPS + METRIC…"
                                : `${bg.width}×${bg.height} · ${formatDuration(bg.duration)} · ${
                                    bg.fps != null ? `${sourceFpsLabel(bg.fps)}FPS` : "FPS?"
                                  }`}
                          </p>
                        </>
                      ) : (
                        <p className="font-mono text-[9px] text-coal-500">AWAITING SLOT</p>
                      )}
                    </div>
                    {bg && (
                      <button
                        type="button"
                        onClick={() => onRemoveFile(bg.id)}
                        disabled={disabled}
                        className="absolute top-1 right-1 grid size-6 place-items-center text-coal-400 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 max-md:opacity-100 hover:text-rose-err"
                      >
                        <X className="size-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            {bgs.length > 0 && (
              <button
                type="button"
                onClick={onClearFiles}
                disabled={disabled}
                className="mt-2 flex min-h-[32px] items-center gap-1.5 border border-coal-600 px-2.5 py-1 font-mono text-[10px] font-bold tracking-widest text-coal-300 transition-colors hover:border-rose-err hover:text-rose-err disabled:opacity-40"
              >
                <Trash2 className="size-3" /> CLEAR ALL
              </button>
            )}
          </div>
        </div>
      )}
    </Section>
  );
}

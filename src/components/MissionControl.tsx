import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  Captions,
  Check,
  Clapperboard,
  Cpu,
  Download,
  Film,
  Loader2,
  Mic,
  Package,
  Play,
  RefreshCw,
  RotateCw,
  Sparkles,
  Timer,
  TriangleAlert,
  X,
  Zap,
} from "lucide-react";
import Section from "./Section";
import { cn } from "../utils/cn";
import type { LocalRenderItem, Phase, RenderStage } from "../lib/types";
import { STAGES, stageIndex } from "../lib/types";
import { formatBytes, formatClock, formatDuration } from "../lib/media";

export interface ZipState {
  active: boolean;
  done: number;
  total: number;
  url: string | null;
  name: string | null;
  size: number;
  error: string | null;
}

export const videoFileName = (item: LocalRenderItem) =>
  `shortsfactory_${String(item.index + 1).padStart(2, "0")}.${
    item.mime?.includes("webm") ? "webm" : "mp4"
  }`;

const STAGE_ICONS: Record<RenderStage, typeof Cpu> = {
  idle: Film,
  script: Cpu,
  voice: Mic,
  staged: Clapperboard,
  rendering: Captions,
  done: Film,
  error: TriangleAlert,
};

const PROVIDER_BADGE: Record<string, string> = {
  qwen: "QWEN",
  mistral: "MISTRAL",
  offline: "LOCAL",
};

/* ------------------------------------------------------------------ */
/*  ASSEMBLY PANEL — prepare + explicit render buttons                  */
/* ------------------------------------------------------------------ */

export function AssemblyPanel({
  phase,
  canPrepare,
  blockers,
  stagedCount,
  doneCount,
  errorCount,
  renderProgress,
  error,
  disabled = false,
  onPrepare,
  onRenderAll,
  onCancel,
}: {
  phase: Phase;
  canPrepare: boolean;
  blockers: string[];
  stagedCount: number;
  doneCount: number;
  errorCount: number;
  renderProgress: number;
  error: string | null;
  disabled?: boolean;
  onPrepare: () => void;
  onRenderAll: () => void;
  onCancel: () => void;
}) {
  const preparing = phase === "preparing";
  const rendering = phase === "rendering";
  const busy = preparing || rendering;
  const hasStaged = stagedCount > 0;

  return (
    <Section
      index="04"
      title="Assembly Line"
      hint={preparing ? "WRITING + VOICING" : rendering ? "RENDERING" : "STANDING BY"}
      active={busy}
      complete={phase === "ready"}
    >
      <div className="grid gap-2.5">
        {/* STEP A — prepare scripts + voices */}
        <button
          type="button"
          onClick={onPrepare}
          disabled={!canPrepare || busy || disabled}
          className={cn(
            "group relative w-full overflow-hidden border transition-all duration-300",
            preparing
              ? "border-amber-warn/70 bg-coal-850"
              : canPrepare && !busy && !disabled
                ? "border-coal-500 bg-coal-850 hover:border-volt-400 hover:bg-coal-800"
                : "border-coal-700 bg-coal-850 opacity-60"
          )}
        >
          {preparing && <span className="hazard-ember absolute inset-x-0 top-0 h-1 animate-belt" />}
          <span className="relative flex items-center gap-4 px-5 py-4">
            <span
              className={cn(
                "grid size-10 shrink-0 place-items-center border",
                preparing
                  ? "border-amber-warn/50 text-amber-warn"
                  : "border-coal-600 text-coal-300 group-hover:border-volt-400 group-hover:text-volt-300"
              )}
            >
              {preparing ? (
                <Loader2 className="size-5 animate-spin" />
              ) : (
                <Sparkles className="size-5" strokeWidth={2.2} />
              )}
            </span>
            <span className="min-w-0 text-left">
              <span className="block font-display text-sm font-black tracking-tight text-paper-100 uppercase">
                {preparing ? "Writing stories + voicing…" : "① Prepare 10 scripts + voices"}
              </span>
              <span className="mt-0.5 block font-mono text-[9.5px] leading-relaxed tracking-[0.14em] text-coal-400">
                {canPrepare || busy
                  ? "FAST STEP · NO VIDEO IS RENDERED YET"
                  : blockers.join("  ·  ")}
              </span>
            </span>
          </span>
        </button>

        {/* STEP B — the render button */}
        <button
          type="button"
          onClick={rendering && !disabled ? onCancel : onRenderAll}
          disabled={(!hasStaged && !rendering) || disabled}
          className={cn(
            "group relative w-full overflow-hidden border transition-all duration-300",
            rendering
              ? "border-ember-500/70 bg-coal-850"
              : hasStaged
                ? "glow-volt bg-heat border-volt-400 text-coal-950 hover:opacity-95"
                : "border-coal-700 bg-coal-850 text-coal-500"
          )}
        >
          {rendering ? (
            <span className="hazard-ember absolute inset-x-0 top-0 h-1.5 animate-belt" />
          ) : (
            hasStaged && <span className="hazard absolute inset-x-0 top-0 h-1.5" />
          )}

          <span className="relative flex min-h-[104px] flex-col items-center justify-center gap-3 px-6 py-6 sm:flex-row sm:gap-5">
            <span
              className={cn(
                "grid size-12 shrink-0 place-items-center border",
                rendering
                  ? "border-ember-500/50 text-ember-400"
                  : hasStaged
                    ? "border-coal-950/30 bg-coal-950/10"
                    : "border-coal-700 text-coal-600"
              )}
            >
              {rendering ? (
                <Loader2 className="size-6 animate-spin" />
              ) : (
                <Zap className="size-6" strokeWidth={2.4} />
              )}
            </span>
            <span className="text-center sm:text-left">
              <span className="block font-display text-xl font-black tracking-tight uppercase sm:text-2xl">
                {rendering
                  ? `Rendering ${doneCount + errorCount}/10 — tap to stop`
                  : hasStaged
                    ? `② Render ${stagedCount} video${stagedCount === 1 ? "" : "s"}`
                    : "② Render — prepare first"}
              </span>
              <span
                className={cn(
                  "mt-1 block max-w-md font-mono text-[10px] leading-relaxed tracking-[0.14em]",
                  rendering ? "text-ember-400" : hasStaged ? "text-coal-950/70" : "text-coal-500"
                )}
              >
                {rendering
                  ? "REAL-TIME CANVAS CAPTURE · KEEP THIS TAB ON SCREEN"
                  : hasStaged
                    ? "PRESS TO RENDER EVERY STAGED UNIT — OR RENDER THEM ONE BY ONE BELOW"
                    : "EACH UNIT ALSO HAS ITS OWN RENDER BUTTON IN THE OUTPUT BAY"}
              </span>
            </span>
          </span>

          {rendering && (
            <span
              className="absolute bottom-0 left-0 h-1 bg-ember-500 transition-[width] duration-500 ease-out"
              style={{ width: `${Math.min(100, renderProgress * 100)}%` }}
            />
          )}
        </button>
      </div>

      {error && (
        <div className="mt-3 flex items-start gap-2 border border-rose-err/50 bg-rose-err/10 px-3 py-2.5">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-rose-err" />
          <p className="font-mono text-[11px] leading-relaxed text-rose-err">{error}</p>
        </div>
      )}
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/*  OUTPUT BAY                                                          */
/* ------------------------------------------------------------------ */

function StageStepper({ status }: { status: RenderStage }) {
  const active = stageIndex(status);
  return (
    <div className="flex items-center gap-0">
      {STAGES.map((stage, i) => {
        const state =
          status === "error"
            ? i === 0 ? "done" : "idle"
            : i < active
              ? "done"
              : i === active
                ? status === "done" ? "done" : "current"
                : "idle";
        return (
          <div key={stage.id} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center gap-1">
              <span
                className={cn(
                  "grid size-4 place-items-center rounded-full border transition-colors duration-500",
                  state === "done" && "bg-heat border-volt-400 text-coal-950",
                  state === "current" && "animate-led rounded-full border-ember-400 text-ember-400",
                  state === "idle" && "border-coal-600 text-transparent",
                  status === "error" && i === 0 && "border-rose-err bg-rose-err text-coal-950"
                )}
              >
                <Check className="size-2.5" strokeWidth={4} />
              </span>
              <span
                className={cn(
                  "font-mono text-[7.5px] tracking-[0.14em] uppercase",
                  state === "done"
                    ? "text-volt-400"
                    : state === "current"
                      ? "text-ember-400"
                      : "text-coal-500"
                )}
              >
                {stage.label}
              </span>
            </div>
            {i < STAGES.length - 1 && (
              <div
                className={cn(
                  "mx-1 mb-3.5 h-px flex-1 transition-colors duration-500",
                  i < active ? "bg-volt-400" : "bg-coal-700"
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function VideoModal({ item, onClose }: { item: LocalRenderItem; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-coal-950/90 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div className="relative max-h-[92dvh] animate-rise" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="font-mono text-[10px] tracking-[0.2em] text-coal-300">
            UNIT {String(item.index + 1).padStart(2, "0")} — FINAL CUT
          </span>
          <div className="flex items-center gap-2">
            {item.blobUrl && (
              <a
                href={item.blobUrl}
                download={videoFileName(item)}
                className="bg-heat flex items-center gap-1.5 border border-volt-400 px-2.5 py-1.5 font-mono text-[9px] font-bold tracking-widest text-coal-950"
              >
                <Download className="size-3" strokeWidth={2.6} /> SAVE
              </a>
            )}
            <button
              type="button"
              onClick={onClose}
              className="border border-coal-600 p-1.5 text-coal-300 hover:border-volt-400 hover:text-volt-300"
              aria-label="Close preview"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
        <video
          src={item.blobUrl}
          controls
          autoPlay
          playsInline
          className="max-h-[78dvh] w-auto max-w-full border border-coal-600 bg-black"
          style={{ aspectRatio: "9 / 16" }}
        />
      </div>
    </div>
  );
}

export function OutputPanel({
  phase,
  items,
  placeholderCount,
  zip,
  elapsed,
  activeIndex,
  activeProgress,
  disabled = false,
  onBuildZip,
  onRenderOne,
}: {
  phase: Phase;
  items: LocalRenderItem[];
  placeholderCount: number;
  zip: ZipState;
  elapsed: number;
  activeIndex: number | null;
  activeProgress: number;
  disabled?: boolean;
  onBuildZip: () => void;
  onRenderOne: (index: number) => void;
}) {
  const [preview, setPreview] = useState<LocalRenderItem | null>(null);
  const doneCount = items.filter((r) => r.status === "done").length;
  const busy = phase === "preparing" || phase === "rendering";

  const cells = useMemo<(LocalRenderItem | null)[]>(() => {
    if (items.length > 0) return items;
    return Array.from({ length: placeholderCount }, () => null);
  }, [items, placeholderCount]);

  return (
    <Section
      index="05"
      title="Output Bay"
      hint={`${doneCount}/10 SHIPPED`}
      active={phase === "rendering"}
      complete={phase === "ready"}
      aside={
        doneCount > 0 ? (
          <span className="mono-label text-[9px] text-volt-400">{doneCount} UNITS READY</span>
        ) : undefined
      }
    >
      <div className="grid grid-cols-1 gap-2.5 min-[420px]:grid-cols-2 xl:grid-cols-5">
        {cells.map((item, i) => {
          if (!item) {
            return (
              <div
                key={`ph-${i}`}
                className="flex min-h-[130px] flex-col justify-between border border-dashed border-coal-700/70 bg-coal-850/40 p-3"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] font-bold text-coal-500 tabular-nums">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <Film className="size-3.5 text-coal-600" />
                </div>
                <p className="font-mono text-[9px] tracking-wider text-coal-500">STANDBY</p>
              </div>
            );
          }

          const Icon = STAGE_ICONS[item.status] ?? Film;
          const isActive = activeIndex === item.index && item.status === "rendering";

          return (
            <div
              key={`unit-${item.index}`}
              className={cn(
                "group/cell relative flex min-h-[130px] flex-col justify-between border p-3 transition-all duration-300",
                item.status === "done" && "border-volt-400/60 bg-coal-850",
                item.status === "rendering" && "border-ember-500/60 bg-coal-850",
                item.status === "staged" && "border-coal-500 bg-coal-850",
                (item.status === "script" || item.status === "voice") &&
                  "border-amber-warn/40 bg-coal-850",
                item.status === "error" && "border-rose-err/50 bg-rose-err/5",
                item.status === "idle" && "border-coal-700/70 bg-coal-850/40"
              )}
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[10px] font-bold text-volt-400 tabular-nums">
                      {String(item.index + 1).padStart(2, "0")}
                    </span>
                    {item.provider && (
                      <span className="border border-coal-700 px-1 py-px font-mono text-[7px] tracking-[0.12em] text-coal-400">
                        {PROVIDER_BADGE[item.provider] ?? "AI"}
                      </span>
                    )}
                  </div>
                  <Icon
                    className={cn(
                      "size-3.5",
                      item.status === "done" && "text-volt-400",
                      item.status === "error" && "text-rose-err",
                      item.status === "staged" && "text-coal-300",
                      (item.status === "script" || item.status === "voice") &&
                        "animate-pulse text-amber-warn",
                      item.status === "rendering" && "animate-pulse text-ember-400"
                    )}
                  />
                </div>

                {item.status === "done" && item.blobUrl ? (
                  <div className="relative mt-2">
                    <button
                      type="button"
                      onClick={() => setPreview(item)}
                      className="relative block w-full overflow-hidden border border-coal-700 bg-black"
                      title="Preview"
                    >
                      <div className="relative" style={{ aspectRatio: "9 / 16" }}>
                        <video
                          src={item.blobUrl}
                          muted
                          playsInline
                          preload="metadata"
                          className="absolute inset-0 h-full w-full object-cover opacity-80 transition-opacity group-hover/cell:opacity-100"
                        />
                        <span className="absolute inset-0 grid place-items-center">
                          <span className="grid size-9 place-items-center rounded-full bg-coal-950/80 text-volt-300 transition-transform group-hover/cell:scale-110">
                            <Play className="ml-0.5 size-3.5" fill="currentColor" />
                          </span>
                        </span>
                      </div>
                    </button>
                    <a
                      href={item.blobUrl}
                      download={videoFileName(item)}
                      title="Download this video"
                      className="absolute top-1.5 right-1.5 grid size-8 place-items-center border border-coal-600 bg-coal-950/85 text-coal-200 transition-colors hover:border-volt-400 hover:text-volt-300"
                    >
                      <Download className="size-3.5" strokeWidth={2.4} />
                    </a>
                    <p className="mt-1 truncate font-mono text-[8.5px] tracking-wider text-coal-400">
                      {item.duration ? `${formatDuration(item.duration)} · ` : ""}
                      {item.size ? formatBytes(item.size) : ""} ·{" "}
                      {item.mime?.includes("webm") ? "WEBM" : "MP4"}
                    </p>
                  </div>
                ) : (
                  <p className="mt-2 line-clamp-4 min-h-[48px] font-mono text-[9.5px] leading-relaxed text-coal-400">
                    {item.status === "error"
                      ? item.error ?? "FAILED"
                      : item.story
                        ? item.story
                        : item.status === "idle"
                          ? "AWAITING PREPARATION"
                          : "GENERATING STORY…"}
                  </p>
                )}

                {isActive && (
                  <div className="mt-2 h-1 w-full overflow-hidden bg-coal-800">
                    <div
                      className="h-full bg-ember-500 transition-[width] duration-300"
                      style={{ width: `${Math.min(100, activeProgress * 100)}%` }}
                    />
                  </div>
                )}
              </div>

              <div className="mt-2 grid gap-2">
                <StageStepper status={item.status} />

                {/* per-unit render controls */}
                {(item.status === "staged" || item.status === "done" || item.status === "error") && (
                  <div className="grid gap-1.5">
                    <button
                      type="button"
                      onClick={() => onRenderOne(item.index)}
                      disabled={busy || disabled}
                      className={cn(
                        "flex min-h-[34px] w-full items-center justify-center gap-1.5 border px-2 py-1.5 font-mono text-[9.5px] font-bold tracking-widest transition-colors disabled:opacity-40",
                        item.status === "staged"
                          ? "bg-heat border-volt-400 text-coal-950 hover:opacity-90"
                          : "border-coal-600 text-coal-300 hover:border-volt-400 hover:text-volt-300"
                      )}
                    >
                      {item.status === "staged" ? (
                        <>
                          <Zap className="size-3" strokeWidth={2.6} /> RENDER
                        </>
                      ) : (
                        <>
                          <RotateCw className="size-3" /> {item.status === "error" ? "RETRY" : "RE-RENDER"}
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* export bay */}
      <div className="mt-5 border border-coal-700 bg-coal-850/70 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Archive className="size-5 shrink-0 text-coal-300" />
            <div>
              <p className="font-display text-xs font-black tracking-[0.1em] text-coal-200 uppercase">
                ZIP Dispatch
              </p>
              <p className="mono-label mt-0.5 text-[9px] leading-relaxed text-coal-400">
                LOCAL BLOBS · JSZIP · REAL BLOB ANCHOR — SAFARI SAFE, NO CLOUD ROUND-TRIP
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {elapsed > 0 && (
              <span className="flex items-center gap-1.5 font-mono text-[10px] tracking-widest text-coal-300">
                <Timer className="size-3.5 text-coal-400" />
                {formatClock(elapsed)}
              </span>
            )}
            {zip.url && zip.name ? (
              <a
                href={zip.url}
                download={zip.name}
                className="flex min-h-[44px] items-center gap-2 border border-coal-600 bg-coal-850 px-4 py-2.5 font-display text-sm font-black tracking-tight text-coal-100 uppercase transition-colors hover:border-volt-400"
              >
                <Download className="size-4" strokeWidth={2.6} />
                Download ZIP · {formatBytes(zip.size)}
              </a>
            ) : (
              <button
                type="button"
                onClick={onBuildZip}
                disabled={doneCount === 0 || zip.active}
                className={cn(
                  "flex min-h-[44px] items-center gap-2 border px-4 py-2.5 font-display text-sm font-black tracking-tight uppercase transition-colors",
                  doneCount > 0 && !zip.active
                    ? "bg-heat border-volt-400 text-coal-950 hover:opacity-90"
                    : "border-coal-700 text-coal-500"
                )}
              >
                {zip.active ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    BUNDLING {zip.done}/{zip.total}…
                  </>
                ) : (
                  <>
                    <Package className="size-4" strokeWidth={2.4} />
                    Bundle {doneCount} video{doneCount === 1 ? "" : "s"} → ZIP
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {zip.active && (
          <div className="mt-3 h-1 w-full overflow-hidden bg-coal-800">
            <div
              className="h-full bg-volt-400 transition-[width] duration-500"
              style={{ width: `${zip.total ? (zip.done / zip.total) * 100 : 0}%` }}
            />
          </div>
        )}

        {zip.error && (
          <div className="mt-3 flex items-start gap-2 border border-rose-err/50 bg-rose-err/10 px-3 py-2.5">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-rose-err" />
            <p className="font-mono text-[11px] leading-relaxed text-rose-err">{zip.error}</p>
          </div>
        )}
      </div>

      {(phase === "partial" || phase === "failed") && (
        <div className="mt-3 flex items-center gap-2 border border-amber-warn/40 bg-amber-warn/10 px-3 py-2.5">
          <RefreshCw className="size-4 shrink-0 text-amber-warn" />
          <p className="font-mono text-[11px] leading-relaxed text-amber-warn">
            {phase === "partial"
              ? "SOME UNITS FAULTED — HIT RETRY ON THE RED CARDS, THE REST ARE READY TO SHIP."
              : "EVERY UNIT FAULTED — CHECK THE RED CARDS, THEN RETRY."}
          </p>
        </div>
      )}

      {preview && <VideoModal item={preview} onClose={() => setPreview(null)} />}
    </Section>
  );
}

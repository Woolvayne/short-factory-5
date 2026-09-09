import { useRef, useState, type ReactNode } from "react";
import { FileAudio, Music, Smartphone, X } from "lucide-react";
import Section from "./Section";
import { cn } from "../utils/cn";
import type { MusicFile } from "../lib/types";
import { formatBytes, formatDuration } from "../lib/media";

function DropZone({
  accept,
  multiple,
  disabled,
  onFiles,
  icon,
  title,
  subtitle,
  compact,
}: {
  accept: string;
  multiple?: boolean;
  disabled?: boolean;
  onFiles: (files: File[]) => void;
  icon: ReactNode;
  title: string;
  subtitle: string;
  compact?: boolean;
}) {
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        if (disabled) return;
        onFiles(Array.from(e.dataTransfer.files));
      }}
      className={cn(
        "group relative flex w-full flex-col items-center justify-center gap-2 overflow-hidden border border-dashed text-center transition-all duration-200",
        compact ? "px-4 py-6" : "px-4 py-9",
        drag
          ? "border-volt-400 bg-volt-400/10"
          : "border-coal-600 bg-coal-850/60 active:border-coal-400 hover:border-coal-400 hover:bg-coal-800/60",
        disabled && "cursor-not-allowed opacity-40 hover:border-coal-600"
      )}
    >
      {drag && (
        <div className="hazard pointer-events-none absolute inset-x-0 top-0 h-1 animate-belt" />
      )}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      <span
        className={cn(
          "transition-colors",
          drag ? "text-volt-300" : "text-coal-400 group-hover:text-coal-200"
        )}
      >
        {icon}
      </span>
      <span className="font-display text-xs font-black tracking-[0.12em] text-coal-200 uppercase">
        {title}
      </span>
      <span className="font-mono text-[10px] leading-relaxed tracking-wider text-coal-400">
        {subtitle}
      </span>
      <span className="mt-1 inline-flex items-center gap-1.5 border border-coal-600 px-3 py-1.5 font-mono text-[10px] font-bold tracking-widest text-coal-200 group-hover:border-volt-400 group-hover:text-volt-300">
        <Smartphone className="size-3" /> TAP TO PICK FILES
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  MUSIC — optional soundtrack bed                                      */
/* ------------------------------------------------------------------ */

export function MusicPanel({
  tracks,
  onAdd,
  onSelect,
  onRemove,
  disabled,
}: {
  tracks: MusicFile[];
  onAdd: (files: File[]) => void;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  disabled?: boolean;
}) {
  const ready = tracks.some((t) => t.selected);

  return (
    <Section
      index="03"
      title="Soundtrack Deck"
      hint="OPTIONAL · 13% VOL"
      complete={ready}
    >
      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <DropZone
          accept="audio/*,.mp3,.m4a,.aac,.wav"
          multiple
          compact
          disabled={disabled}
          onFiles={onAdd}
          icon={<Music className="size-6" strokeWidth={1.6} />}
          title="PICK BACKGROUND MUSIC"
          subtitle="MP3 / M4A / AAC · MIXED UNDER THE VOICE AT LOW VOLUME"
        />

        <div className="flex flex-col gap-1.5">
          {tracks.length === 0 && (
            <div className="grid min-h-[72px] flex-1 place-items-center border border-dashed border-coal-700/70 bg-coal-850/40 p-3">
              <p className="px-2 text-center font-mono text-[9.5px] leading-relaxed tracking-wider text-coal-500">
                NO TRACKS LOADED — FULLY OPTIONAL, VIDEOS WORK FINE WITHOUT A MUSIC BED
              </p>
            </div>
          )}
          {tracks.map((t) => (
            <div
              key={t.id}
              className={cn(
                "group flex min-h-[44px] items-center gap-3 border px-3 py-2 transition-colors",
                t.selected
                  ? "border-volt-400/70 bg-volt-400/10"
                  : "border-coal-700/80 bg-coal-850 hover:border-coal-500"
              )}
            >
              <FileAudio
                className={cn("size-4 shrink-0", t.selected ? "text-volt-300" : "text-coal-400")}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-[10.5px] text-coal-200" title={t.file.name}>
                  {t.file.name}
                </p>
                <p className="font-mono text-[9px] text-coal-400">
                  {formatDuration(t.duration ?? 0)} · {formatBytes(t.file.size)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onSelect(t.id)}
                disabled={disabled}
                className={cn(
                  "min-h-[32px] border px-2.5 py-1 font-mono text-[9px] font-bold tracking-widest transition-colors disabled:opacity-40",
                  t.selected
                    ? "bg-heat border-volt-400 text-coal-950"
                    : "border-coal-600 text-coal-300 hover:border-volt-400 hover:text-volt-300"
                )}
              >
                {t.selected ? "ON DECK" : "USE"}
              </button>
              <button
                type="button"
                onClick={() => onRemove(t.id)}
                disabled={disabled}
                className="grid size-8 place-items-center text-coal-500 transition-colors hover:text-rose-err disabled:opacity-30"
                title="Remove"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}

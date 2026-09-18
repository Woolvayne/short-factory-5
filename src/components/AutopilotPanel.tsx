import { useEffect, useState } from "react";
import {
  Bot,
  Check,
  Clock,
  Coins,
  Gauge,
  Loader2,
  OctagonX,
  Play,
  Rocket,
  Send,
  TriangleAlert,
} from "lucide-react";
import { cn } from "../utils/cn";
import {
  AUTOPILOT_MAX_PER_HOUR,
  AUTOPILOT_MIN_PER_HOUR,
  clampPerHour,
  countDispatchesLastHour,
  formatWait,
  msUntilNextDispatch,
  type AutopilotConfig,
  type AutopilotLogEntry,
  type AutopilotStats,
} from "../lib/autopilot";
import { PROVIDER_META } from "../lib/dispatch";
import type { SocialPlatform } from "../lib/postlake";

const PLATFORM_META: Record<SocialPlatform, { label: string; short: string }> = {
  tiktok: { label: "TikTok", short: "TIKTOK" },
  instagram: { label: "Instagram Reels", short: "REELS" },
  youtube: { label: "YouTube Shorts", short: "SHORTS" },
};

const PRESETS = [1, 6, 10, 25, 50, 100];

export default function AutopilotPanel({
  config,
  onConfig,
  running,
  stats,
  log,
  queueDepth,
  posting,
  canStart,
  blockers,
  hasKey,
  credits,
  bufferHasKey,
  bufferChannels,
  onStart,
  onStop,
}: {
  config: AutopilotConfig;
  onConfig: (cfg: AutopilotConfig) => void;
  running: boolean;
  stats: AutopilotStats;
  log: AutopilotLogEntry[];
  queueDepth: number;
  posting: boolean;
  canStart: boolean;
  blockers: string[];
  hasKey: boolean;
  credits: number | null;
  bufferHasKey: boolean;
  bufferChannels: number;
  onStart: () => void;
  onStop: () => void;
}) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setTick((x) => x + 1), 1000);
    return () => window.clearInterval(t);
  }, [running]);

  const hourCount = countDispatchesLastHour();
  const waitMs = running ? msUntilNextDispatch(config.videosPerHour) : 0;

  const togglePlatform = (p: SocialPlatform) => {
    const has = config.platforms.includes(p);
    const next = has ? config.platforms.filter((x) => x !== p) : [...config.platforms, p];
    if (next.length === 0) return;
    onConfig({ ...config, platforms: next });
  };

  return (
    <section className="card-bracket border border-coal-600 bg-coal-900/90 p-4 sm:p-5">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-coal-700/70 pb-4">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "grid size-10 place-items-center",
              running ? "bg-heat animate-pulse text-coal-950" : "bg-coal-800 text-volt-300"
            )}
          >
            <Bot className="size-5" strokeWidth={2.2} />
          </div>
          <div>
            <h2 className="font-display text-base font-black tracking-tight text-paper-100 uppercase">
              Autopilot · Auto-Modus
            </h2>
            <p className="font-mono text-[10px] text-coal-300">
              Rendern + Posten über {PROVIDER_META[config.provider].label} — vollautomatisch,
              ohne Klick
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "flex items-center gap-1.5 border px-3 py-1.5 font-mono text-[10px] font-bold tracking-wider",
              running
                ? "border-mint-400/60 bg-mint-400/10 text-mint-400"
                : "border-coal-600 bg-coal-850 text-coal-300"
            )}
          >
            <span
              className={cn(
                "inline-block size-1.5 rounded-full",
                running ? "animate-led bg-mint-400" : "bg-coal-600"
              )}
            />
            {running ? "LÄUFT" : "BEREIT"}
          </span>
          {config.provider === "postlake" ? (
            <span
              className={cn(
                "flex items-center gap-1.5 border px-3 py-1.5 font-mono text-[10px] font-bold tracking-wider",
                credits !== null && credits <= 10
                  ? "border-rose-err/60 bg-rose-err/10 text-rose-err"
                  : "border-coal-600 bg-coal-850 text-coal-300"
              )}
              title="1 Credit pro veröffentlichtem Kanal-Post"
            >
              <Coins className="size-3.5" />
              {credits !== null ? `${credits} CREDITS` : "CREDITS –"}
            </span>
          ) : (
            <span
              className="flex items-center gap-1.5 border border-coal-600 bg-coal-850 px-3 py-1.5 font-mono text-[10px] font-bold tracking-wider text-coal-300"
              title="Verbundene Buffer-Kanäle"
            >
              📦 {bufferChannels} KANÄLE
            </span>
          )}
        </div>
      </div>

      {/* start / stop */}
      <div className="mt-4">
        {running ? (
          <button
            type="button"
            onClick={onStop}
            className="flex w-full items-center justify-center gap-2 border border-rose-err/70 bg-rose-err/15 px-4 py-3.5 font-display text-sm font-black tracking-wider text-rose-err uppercase transition-colors hover:bg-rose-err hover:text-coal-950"
          >
            <OctagonX className="size-5" /> Autopilot stoppen
          </button>
        ) : (
          <button
            type="button"
            onClick={onStart}
            disabled={!canStart}
            className={cn(
              "flex w-full items-center justify-center gap-2 border px-4 py-3.5 font-display text-sm font-black tracking-wider uppercase transition-opacity",
              canStart
                ? "bg-heat glow-volt border-volt-400 text-coal-950 hover:opacity-95"
                : "border-coal-700 bg-coal-850 text-coal-500"
            )}
          >
            <Play className="size-5" strokeWidth={2.6} /> Autopilot starten
          </button>
        )}
        {!canStart && !running && blockers.length > 0 && (
          <p className="mt-2 font-mono text-[9.5px] leading-relaxed tracking-wider text-amber-warn">
            {blockers.join("  ·  ")}
          </p>
        )}
      </div>

      {/* live stats */}
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          {
            label: "DIESE STUNDE",
            value: `${hourCount}/${config.videosPerHour}`,
            tone: hourCount >= config.videosPerHour ? "text-amber-warn" : "text-volt-300",
          },
          {
            label: "WARTESCHLANGE",
            value: String(queueDepth + (posting ? 1 : 0)),
            tone: "text-paper-100",
          },
          { label: "GEPOSTET", value: String(stats.totalPosted), tone: "text-mint-400" },
          {
            label: "FEHLER",
            value: String(stats.totalFailed),
            tone: stats.totalFailed > 0 ? "text-rose-err" : "text-coal-400",
          },
        ].map((c) => (
          <div key={c.label} className="border border-coal-700/80 bg-coal-850/80 p-2.5">
            <span className="mono-label block text-[8px] text-coal-400">{c.label}</span>
            <span className={cn("mt-0.5 block font-display text-lg font-black", c.tone)}>
              {c.value}
            </span>
          </div>
        ))}
      </div>

      {running && (
        <div className="mt-2 flex items-center gap-2 border border-coal-700/70 bg-coal-850/60 px-3 py-2">
          {posting ? (
            <Loader2 className="size-3.5 animate-spin text-volt-300" />
          ) : (
            <Clock className="size-3.5 text-coal-400" />
          )}
          <span className="font-mono text-[10px] text-coal-300">
            {posting ? (
              <>Sende Video an {PROVIDER_META[config.provider].label} …</>
            ) : queueDepth > 0 ? (
              <>
                Nächster Versand in <strong className="text-volt-300">{formatWait(waitMs)}</strong>{" "}
                (Limit {config.videosPerHour}/h)
              </>
            ) : (
              <>Rendere weiter — Versand ist bereit ({config.videosPerHour}/h)</>
            )}
          </span>
        </div>
      )}

      {/* provider */}
      <div className="mt-4">
        <label className="mono-label mb-1.5 block text-[9px] text-coal-400">
          SENDE-DIENST (AUTO-MODUS)
        </label>
        <div className="grid grid-cols-2 gap-2">
          {(["postlake", "buffer"] as const).map((pp) => {
            const active = config.provider === pp;
            return (
              <button
                key={pp}
                type="button"
                onClick={() => onConfig({ ...config, provider: pp })}
                className={cn(
                  "flex items-center justify-center gap-2 border px-3 py-2.5 transition-colors",
                  active
                    ? "border-volt-400 bg-volt-400/15"
                    : "border-coal-700 bg-coal-850 hover:border-coal-500"
                )}
              >
                <span className="text-base">{PROVIDER_META[pp].icon}</span>
                <span
                  className={cn(
                    "font-display text-[12px] font-black tracking-wide uppercase",
                    active ? "text-paper-100" : "text-coal-400"
                  )}
                >
                  {PROVIDER_META[pp].label}
                </span>
                {active && <Check className="size-3.5 text-volt-300" strokeWidth={3} />}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 font-mono text-[9px] leading-relaxed text-coal-500">
          {config.provider === "buffer"
            ? "Buffer: 1 Mutation pro Kanal, Videos laufen vorab ins Supabase-Hosting (öffentliche URL)."
            : "Postlake: 1 Call fächert auf alle Kanäle auf, Upload per signierter PUT-URL."}
        </p>
      </div>

      {/* limit */}
      <div className="mt-4">
        <label className="mono-label mb-1.5 flex items-center gap-1.5 text-[9px] text-coal-400">
          <Gauge className="size-3.5" /> VIDEOS PRO STUNDE AN {PROVIDER_META[config.provider].short} · LIMIT (1–100)
        </label>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={AUTOPILOT_MIN_PER_HOUR}
            max={AUTOPILOT_MAX_PER_HOUR}
            value={config.videosPerHour}
            onChange={(e) => onConfig({ ...config, videosPerHour: clampPerHour(+e.target.value) })}
            className="flex-1 accent-volt-400"
            aria-label="Videos pro Stunde"
          />
          <input
            type="number"
            min={AUTOPILOT_MIN_PER_HOUR}
            max={AUTOPILOT_MAX_PER_HOUR}
            value={config.videosPerHour}
            onChange={(e) => onConfig({ ...config, videosPerHour: clampPerHour(+e.target.value) })}
            className="w-20 border border-coal-700 bg-coal-850 px-2 py-1.5 text-center font-mono text-[14px] font-bold text-volt-300 focus:border-volt-400 focus:outline-none"
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onConfig({ ...config, videosPerHour: p })}
              className={cn(
                "border px-2.5 py-1 font-mono text-[10px] font-bold transition-colors",
                config.videosPerHour === p
                  ? "bg-heat border-volt-400 text-coal-950"
                  : "border-coal-700 bg-coal-850 text-coal-300 hover:border-coal-500"
              )}
            >
              {p}/h
            </button>
          ))}
        </div>
        <p className="mt-1.5 font-mono text-[9px] leading-relaxed text-coal-500">
          Das Limit drosselt den {PROVIDER_META[config.provider].label}-Versand — gerendert wird
          durchgehend, der Rest wartet in der Queue. Beachte zusätzlich die Tages-Limits der
          Plattformen (z. B. TikTok) und bei Buffer die Queue-Limits des Plans.
        </p>
      </div>

      {/* mode */}
      <div className="mt-4">
        <label className="mono-label mb-1.5 block text-[9px] text-coal-400">SENDE-MODUS</label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onConfig({ ...config, mode: "now" })}
            className={cn(
              "flex items-center gap-2 border px-3 py-2.5 text-left transition-colors",
              config.mode === "now"
                ? "border-volt-400 bg-volt-400/15"
                : "border-coal-700 bg-coal-850 hover:border-coal-500"
            )}
          >
            <Rocket
              className={cn("size-4 shrink-0", config.mode === "now" ? "text-volt-300" : "text-coal-400")}
            />
            <span>
              <span className="block font-display text-[11px] font-bold text-paper-100">
                Sofort posten
              </span>
              <span className="block font-mono text-[8.5px] text-coal-400">sofort · live</span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => onConfig({ ...config, mode: "scheduled" })}
            className={cn(
              "flex items-center gap-2 border px-3 py-2.5 text-left transition-colors",
              config.mode === "scheduled"
                ? "border-volt-400 bg-volt-400/15"
                : "border-coal-700 bg-coal-850 hover:border-coal-500"
            )}
          >
            <Send
              className={cn(
                "size-4 shrink-0",
                config.mode === "scheduled" ? "text-volt-300" : "text-coal-400"
              )}
            />
            <span>
              <span className="block font-display text-[11px] font-bold text-paper-100">
                Slots planen
              </span>
              <span className="block font-mono text-[8.5px] text-coal-400">
                06:00 & 20:00 · Berlin
              </span>
            </span>
          </button>
        </div>
      </div>

      {/* platforms */}
      <div className="mt-4">
        <label className="mono-label mb-1.5 block text-[9px] text-coal-400">
          PLATTFORM-ROTATION ({config.platforms.length} AKTIV)
        </label>
        <div className="grid grid-cols-3 gap-2">
          {(Object.keys(PLATFORM_META) as SocialPlatform[]).map((p) => {
            const active = config.platforms.includes(p);
            return (
              <button
                key={p}
                type="button"
                onClick={() => togglePlatform(p)}
                className={cn(
                  "flex items-center justify-between gap-1 border px-2.5 py-2 transition-colors",
                  active
                    ? "border-volt-400 bg-volt-400/15 text-paper-100"
                    : "border-coal-700 bg-coal-850 text-coal-500 hover:border-coal-500"
                )}
              >
                <span className="font-mono text-[9.5px] font-bold">
                  {PLATFORM_META[p].short}
                </span>
                <span
                  className={cn(
                    "grid size-4 shrink-0 place-items-center rounded-full border",
                    active ? "border-volt-400 bg-volt-400 text-coal-950" : "border-coal-600"
                  )}
                >
                  {active && <Check className="size-2.5" strokeWidth={3.5} />}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* caption + hashtags */}
      <div className="mt-4 grid gap-3">
        <div>
          <label className="mono-label mb-1 block text-[9px] text-coal-400">
            CAPTION-VORLAGE
          </label>
          <textarea
            rows={2}
            value={config.caption}
            onChange={(e) => onConfig({ ...config, caption: e.target.value })}
            className="w-full border border-coal-700 bg-coal-850 px-3 py-2 font-mono text-[11px] leading-relaxed text-paper-100 focus:border-volt-400 focus:outline-none"
          />
        </div>
        <div>
          <label className="mono-label mb-1 block text-[9px] text-coal-400">HASHTAGS</label>
          <input
            type="text"
            value={config.hashtags}
            onChange={(e) => onConfig({ ...config, hashtags: e.target.value })}
            className="w-full border border-coal-700 bg-coal-850 px-3 py-2 font-mono text-[11px] text-paper-100 focus:border-volt-400 focus:outline-none"
          />
        </div>
        <label className="flex cursor-pointer items-center gap-2 font-mono text-[10px] text-coal-300">
          <input
            type="checkbox"
            checked={config.loopRounds}
            onChange={(e) => onConfig({ ...config, loopRounds: e.target.checked })}
            className="size-3.5 accent-volt-400"
          />
          Endlos-Modus: nach jeder 10er-Runde automatisch mit frischen Ideen weiter
        </label>
        <label className="flex cursor-pointer items-center gap-2 font-mono text-[10px] text-coal-300">
          <input
            type="checkbox"
            checked={config.pollStatus}
            onChange={(e) => onConfig({ ...config, pollStatus: e.target.checked })}
            className="size-3.5 accent-volt-400"
          />
          Live-Status bei Postlake pollen (Veröffentlicht / Fehler erkennen)
        </label>
      </div>

      {config.provider === "postlake" && !hasKey && (
        <div className="mt-4 flex items-start gap-2 border border-amber-warn/40 bg-amber-warn/10 px-3 py-2.5">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-warn" />
          <p className="font-mono text-[10px] leading-relaxed text-amber-warn">
            Kein POSTLAKE_API_KEY auf dem Server — der Autopilot rendert trotzdem, Posts werden
            lokal zwischengespeichert und gehen live, sobald der Key gesetzt ist.
          </p>
        </div>
      )}

      {config.provider === "buffer" && !bufferHasKey && (
        <div className="mt-4 flex items-start gap-2 border border-amber-warn/40 bg-amber-warn/10 px-3 py-2.5">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-warn" />
          <p className="font-mono text-[10px] leading-relaxed text-amber-warn">
            Kein BUFFER_API_KEY auf dem Server — der Autopilot rendert trotzdem, Posts werden
            lokal zwischengespeichert und gehen live, sobald der Key gesetzt ist. Für Buffer
            braucht es zusätzlich Supabase-Hosting (VITE_SUPABASE_*).
          </p>
        </div>
      )}

      {/* event log */}
      <div className="mt-4">
        <label className="mono-label mb-1.5 block text-[9px] text-coal-400">
          PROTOKOLL · RUNDE {stats.rounds} · {stats.totalRendered} GERENDERT
        </label>
        <div className="grid max-h-[180px] gap-1 overflow-y-auto border border-coal-700/70 bg-coal-950/60 p-2">
          {log.length === 0 && (
            <span className="font-mono text-[9.5px] text-coal-500">
              Noch keine Ereignisse — starte den Autopiloten.
            </span>
          )}
          {log
            .slice(-40)
            .reverse()
            .map((e, i) => (
              <div key={`${e.at}-${i}`} className="flex items-start gap-2 font-mono text-[9.5px]">
                <span className="shrink-0 text-coal-500 tabular-nums">
                  {new Date(e.at).toLocaleTimeString("de-DE", { hour12: false })}
                </span>
                <span
                  className={cn(
                    "shrink-0",
                    e.kind === "ok" && "text-mint-400",
                    e.kind === "warn" && "text-amber-warn",
                    e.kind === "error" && "text-rose-err",
                    e.kind === "info" && "text-coal-300"
                  )}
                >
                  {e.kind === "ok" ? "✓" : e.kind === "warn" ? "!" : e.kind === "error" ? "✕" : "·"}
                </span>
                <span className="text-coal-200">{e.text}</span>
              </div>
            ))}
        </div>
      </div>

      <p className="mt-3 font-mono text-[9px] leading-relaxed text-coal-500">
        Der Tab muss offen bleiben (Echtzeit-Rendering). Fehlgeschlagene Posts landen im Kalender
        und lassen sich dort erneut versuchen.
      </p>
    </section>
  );
}

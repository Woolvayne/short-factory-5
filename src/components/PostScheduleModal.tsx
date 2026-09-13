import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Calendar,
  Check,
  Clock,
  Globe,
  Loader2,
  Lock,
  Rocket,
  Send,
  ShieldCheck,
  Sliders,
  X,
} from "lucide-react";
import { cn } from "../utils/cn";
import { FIXED_HASHTAGS, FIXED_VIDEO_DESCRIPTION } from "../lib/settings";
import type { LocalRenderItem } from "../lib/types";
import {
  formatBerlinDateTime,
  loadZernioConfig,
  planSlots,
  saveZernioConfig,
  scheduleBatchTenPosts,
  type ScheduledPost,
  type ScheduleMode,
  type SocialPlatform,
  type ZernioConfigState,
} from "../lib/scheduler";

const PLATFORM_META: Record<
  SocialPlatform,
  { label: string; badge: string; color: string }
> = {
  tiktok: {
    label: "TikTok",
    badge: "TIKTOK",
    color: "border-volt-400/60 text-volt-300 bg-volt-400/10",
  },
  instagram: {
    label: "Instagram Reels",
    badge: "REELS",
    color: "border-ember-400/60 text-ember-400 bg-ember-500/10",
  },
  youtube: {
    label: "YouTube Shorts",
    badge: "SHORTS",
    color: "border-amber-warn/60 text-amber-warn bg-amber-warn/10",
  },
};

export default function PostScheduleModal({
  targetItems,
  existingPosts,
  onClose,
  onScheduled,
  onOpenCalendar,
}: {
  targetItems: LocalRenderItem[];
  existingPosts: ScheduledPost[];
  onClose: () => void;
  onScheduled: (allPosts: ScheduledPost[]) => void;
  onOpenCalendar: () => void;
}) {
  const [config, setConfig] = useState<ZernioConfigState>(() => loadZernioConfig());
  const [titleOverride, setTitleOverride] = useState(() => {
    const first = targetItems[0];
    return first?.idea ? `Storytime: ${first.idea}` : "";
  });
  /* description + hashtags are fixed for every video (settings.ts) */
  const [mode, setMode] = useState<ScheduleMode>("auto");
  const [postCount, setPostCount] = useState(10);
  const [customTimes, setCustomTimes] = useState("06:00, 20:00");
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  });
  const [dayStep, setDayStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successResult, setSuccessResult] = useState<{
    count: number;
    hasApiKey: boolean;
    failedCount: number;
    mode: ScheduleMode;
  } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !submitting && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, submitting]);

  const plan = useMemo(
    () => ({
      mode,
      count: postCount,
      times: customTimes
        .split(/[,\s]+/)
        .map((t) => t.trim())
        .filter(Boolean),
      startDate,
      dayStep,
    }),
    [mode, postCount, customTimes, startDate, dayStep]
  );

  const previewSlots = useMemo(
    () => planSlots(existingPosts, plan),
    [existingPosts, plan]
  );

  const togglePlatform = (p: SocialPlatform) => {
    setConfig((prev) => {
      const exists = prev.defaultPlatforms.includes(p);
      const next = exists
        ? prev.defaultPlatforms.filter((x) => x !== p)
        : [...prev.defaultPlatforms, p];
      const updated = {
        ...prev,
        defaultPlatforms: next.length > 0 ? next : [p],
      };
      saveZernioConfig(updated);
      return updated;
    });
  };

  const handleSchedule = async () => {
    if (submitting) return;
    setSubmitting(true);
    setErrorMsg(null);

    try {
      const hashtags = FIXED_HASHTAGS;

      const itemsPayload = Array.from({ length: postCount }, (_, i) => {
        const src = targetItems[i % Math.max(1, targetItems.length)];
        return {
          videoUrl: src?.blobUrl || "",
          thumbnailUrl: "",
          title:
            targetItems.length === 1 && titleOverride.trim()
              ? titleOverride.trim()
              : src?.idea
                ? `Story #${i + 1}: ${src.idea}`
                : `Short Video #${i + 1}`,
          description: FIXED_VIDEO_DESCRIPTION,
          hashtags,
        };
      });

      const res = await scheduleBatchTenPosts({
        items: itemsPayload,
        config,
        plan,
      });

      const failedCount = res.createdPosts.filter((p) => p.status === "Fehler").length;
      setSuccessResult({
        count: res.createdPosts.length,
        hasApiKey: res.hasApiKey,
        failedCount,
        mode,
      });
      onScheduled(res.allPosts);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-coal-950/90 p-4 overflow-y-auto"
      onClick={() => !submitting && onClose()}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="card-bracket relative w-full max-w-3xl border border-coal-600 bg-coal-900 p-5 sm:p-6 my-8 animate-rise"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-coal-700/70 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="bg-heat px-2 py-0.5 font-mono text-[10px] font-bold tracking-widest text-coal-950">
                ZERNIO API SCHEDULER
              </span>
              <span className="flex items-center gap-1 font-mono text-[10px] text-volt-300">
                <Globe className="size-3" /> Europe/Berlin
              </span>
            </div>
            <h3 className="mt-2 font-display text-lg font-black tracking-tight uppercase text-paper-100">
              Automatisches Social-Media-Planning (10 Posts)
            </h3>
            <p className="mt-0.5 font-mono text-[11px] text-coal-300">
              Sofort veröffentlichen oder flexibel planen — belegte Slots werden immer automatisch übersprungen.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="border border-coal-600 p-2 text-coal-300 hover:border-volt-400 hover:text-volt-300"
          >
            <X className="size-4" />
          </button>
        </div>

        {successResult ? (
          <div className="py-6 text-center">
            <div className="mx-auto grid size-14 place-items-center rounded-full border border-volt-400 bg-volt-400/10 text-volt-300">
              <Check className="size-7" strokeWidth={2.5} />
            </div>
            <h4 className="mt-4 font-display text-xl font-black uppercase text-paper-100">
              {successResult.count} {successResult.mode === "now" ? "Posts werden jetzt veröffentlicht!" : "Posts erfolgreich eingeplant!"}
            </h4>
            <p className="mx-auto mt-2 max-w-lg font-mono text-[11px] leading-relaxed text-coal-300">
              Alle 10 Veröffentlichungs-Slots wurden konfliktfrei in der Zeitzone{" "}
              <strong className="text-volt-300">Europe/Berlin</strong> reserviert und über die Zernio-Schnittstelle eingetragen.
            </p>

            {successResult.failedCount > 0 && (
              <div className="mx-auto mt-4 max-w-md border border-rose-err/50 bg-rose-err/10 px-4 py-3 text-left">
                <div className="flex items-center gap-2 font-mono text-[11px] font-bold text-rose-err">
                  <AlertTriangle className="size-4 shrink-0" />
                  {successResult.failedCount} Post(s) mit Status „Fehler“ markiert
                </div>
                <p className="mt-1 font-mono text-[10px] text-coal-200">
                  Du kannst fehlgeschlagene Posts jederzeit im Kalender einsehen und mit einem Klick erneut versuchen („Erneut versuchen“).
                </p>
              </div>
            )}

            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenCalendar();
                }}
                className="bg-heat flex items-center gap-2 border border-volt-400 px-5 py-3 font-display text-xs font-black tracking-wider text-coal-950 uppercase"
              >
                <Calendar className="size-4" /> Zum Kalender & Slots prüfen
              </button>
              <button
                type="button"
                onClick={onClose}
                className="border border-coal-600 px-4 py-3 font-mono text-[11px] font-bold text-coal-200 hover:border-volt-400"
              >
                Schließen
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-5 grid gap-5">
            {/* Veröffentlichungs-Modus */}
            <div>
              <label className="mono-label mb-2 block text-[9.5px] text-coal-300">
                VERÖFFENTLICHUNG
              </label>
              <div className="grid gap-2 sm:grid-cols-3">
                {(
                  [
                    {
                      id: "now" as ScheduleMode,
                      icon: Rocket,
                      title: "Jetzt posten",
                      sub: "Sofort veröffentlichen",
                    },
                    {
                      id: "auto" as ScheduleMode,
                      icon: Clock,
                      title: "Auto-Plan",
                      sub: "06:00 & 20:00 · 5 Tage",
                    },
                    {
                      id: "custom" as ScheduleMode,
                      icon: Sliders,
                      title: "Frei planen",
                      sub: "Zeiten & Start selbst wählen",
                    },
                  ]
                ).map(({ id, icon: Icon, title, sub }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setMode(id)}
                    className={cn(
                      "flex items-start gap-2.5 border px-3 py-2.5 text-left transition-all",
                      mode === id
                        ? "border-volt-400 bg-volt-400/15"
                        : "border-coal-700 bg-coal-850 hover:border-coal-500"
                    )}
                  >
                    <Icon
                      className={cn(
                        "mt-0.5 size-4 shrink-0",
                        mode === id ? "text-volt-300" : "text-coal-400"
                      )}
                    />
                    <span className="min-w-0">
                      <span
                        className={cn(
                          "block font-display text-xs font-bold uppercase",
                          mode === id ? "text-paper-100" : "text-coal-200"
                        )}
                      >
                        {title}
                      </span>
                      <span className="block font-mono text-[9px] leading-tight text-coal-400">
                        {sub}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Feineinstellungen je nach Modus */}
            <div className="grid gap-3 sm:grid-cols-4">
              <div>
                <label className="mono-label mb-1 block text-[9px] text-coal-400">
                  ANZAHL POSTS
                </label>
                <input
                  type="number"
                  min={1}
                  max={40}
                  value={postCount}
                  onChange={(e) =>
                    setPostCount(Math.max(1, Math.min(40, Number(e.target.value) || 1)))
                  }
                  className="w-full border border-coal-700 bg-coal-850 px-3 py-2 font-mono text-[12px] text-paper-100 focus:border-volt-400 focus:outline-none"
                />
              </div>
              {mode === "custom" && (
                <>
                  <div>
                    <label className="mono-label mb-1 block text-[9px] text-coal-400">
                      UHRZEITEN (BERLIN)
                    </label>
                    <input
                      type="text"
                      value={customTimes}
                      onChange={(e) => setCustomTimes(e.target.value)}
                      placeholder="06:00, 12:30, 20:00"
                      className="w-full border border-coal-700 bg-coal-850 px-3 py-2 font-mono text-[12px] text-paper-100 focus:border-volt-400 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mono-label mb-1 block text-[9px] text-coal-400">
                      STARTDATUM
                    </label>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="w-full border border-coal-700 bg-coal-850 px-3 py-2 font-mono text-[12px] text-paper-100 focus:border-volt-400 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mono-label mb-1 block text-[9px] text-coal-400">
                      RHYTHMUS
                    </label>
                    <select
                      value={dayStep}
                      onChange={(e) => setDayStep(Number(e.target.value))}
                      className="w-full border border-coal-700 bg-coal-850 px-3 py-2 font-mono text-[12px] text-paper-100 focus:border-volt-400 focus:outline-none"
                    >
                      <option value={1} className="bg-coal-900">Täglich</option>
                      <option value={2} className="bg-coal-900">Jeden 2. Tag</option>
                      <option value={3} className="bg-coal-900">Jeden 3. Tag</option>
                      <option value={7} className="bg-coal-900">Wöchentlich</option>
                    </select>
                  </div>
                </>
              )}
            </div>

            {/* Target Platforms Selection */}
            <div>
              <label className="mono-label mb-2 block text-[9.5px] text-coal-300">
                ZIEL-PLATTFORMEN (ZERNIO VERBINDUNGEN)
              </label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {(["tiktok", "instagram", "youtube"] as SocialPlatform[]).map((p) => {
                  const active = config.defaultPlatforms.includes(p);
                  const meta = PLATFORM_META[p];
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => togglePlatform(p)}
                      className={cn(
                        "flex items-center justify-between border px-3.5 py-2.5 text-left transition-all",
                        active
                          ? "border-volt-400 bg-volt-400/15 text-paper-100"
                          : "border-coal-700 bg-coal-850 text-coal-400 hover:border-coal-500"
                      )}
                    >
                      <div>
                        <span className="block font-display text-xs font-bold uppercase">
                          {meta.label}
                        </span>
                        <span className="font-mono text-[9px] text-coal-400">
                          {active ? "Aktiv für Rotation" : "Inaktiv"}
                        </span>
                      </div>
                      <span
                        className={cn(
                          "grid size-5 place-items-center rounded-full border",
                          active
                            ? "border-volt-400 bg-volt-400 text-coal-950"
                            : "border-coal-600"
                        )}
                      >
                        {active && <Check className="size-3" strokeWidth={3} />}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Content / Metadata Customization */}
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="mono-label mb-1 block text-[9px] text-coal-400">
                  TITEL / CAPTION VORLAGE
                </label>
                <input
                  type="text"
                  value={titleOverride}
                  onChange={(e) => setTitleOverride(e.target.value)}
                  placeholder="Story-Titel oder Hook..."
                  className="w-full border border-coal-700 bg-coal-850 px-3 py-2 font-mono text-[12px] text-paper-100 focus:border-volt-400 focus:outline-none"
                />
              </div>
              <div>
                <label className="mono-label mb-1 flex items-center gap-1.5 block text-[9px] text-coal-400">
                  <Lock className="size-3 text-volt-400" /> BESCHREIBUNG · FEST FÜR JEDES VIDEO
                </label>
                <textarea
                  rows={4}
                  value={FIXED_VIDEO_DESCRIPTION}
                  readOnly
                  disabled
                  className="w-full cursor-not-allowed border border-coal-700 bg-coal-850/60 px-3 py-2 font-mono text-[11px] leading-relaxed text-coal-300 focus:outline-none"
                />
              </div>
              <div>
                <label className="mono-label mb-1 block text-[9px] text-coal-400">
                  HASHTAGS (TEIL DER FIXEN BESCHREIBUNG)
                </label>
                <input
                  type="text"
                  value={FIXED_HASHTAGS.join(" ")}
                  readOnly
                  disabled
                  className="w-full cursor-not-allowed border border-coal-700 bg-coal-850/60 px-3 py-2 font-mono text-[12px] text-coal-300 focus:outline-none"
                />
              </div>
            </div>

            {/* 10 Free Slots Preview Grid (5 Days × 06:00 & 20:00 Europe/Berlin) */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="mono-label flex items-center gap-1.5 text-[9.5px] text-volt-300">
                  <Clock className="size-3.5" />
                  {mode === "now"
                    ? `SOFORT-VERÖFFENTLICHUNG (${previewSlots.length} POSTS)`
                    : `SLOT-VORSCHAU (${previewSlots.length} FREIE SLOTS)`}
                </span>
                <span className="font-mono text-[9.5px] text-coal-400">
                  {mode === "now"
                    ? "Leicht versetzt gegen Rate-Limits"
                    : "Belegte Slots werden automatisch übersprungen"}
                </span>
              </div>

              <div className="grid max-h-[220px] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-5">
                {previewSlots.map((slot, idx) => {
                  const fmt = formatBerlinDateTime(slot.scheduledAt);
                  const platform =
                    config.defaultPlatforms[idx % config.defaultPlatforms.length] || "tiktok";
                  return (
                    <div
                      key={slot.berlinKey}
                      className="border border-coal-700 bg-coal-850/90 p-2.5 text-left"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[10px] font-bold text-volt-300">
                          #{String(idx + 1).padStart(2, "0")}
                        </span>
                        <span className="border border-coal-600 px-1.5 py-0.5 font-mono text-[8px] uppercase text-coal-300">
                          {PLATFORM_META[platform]?.badge}
                        </span>
                      </div>
                      <p className="mt-1.5 font-mono text-[10.5px] font-bold text-paper-100">
                        {fmt.weekdayStr}, {fmt.dateStr}
                      </p>
                      <p className="font-mono text-[10px] text-volt-400">{fmt.timeStr}</p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Optional Test Toggle for Zernio Error Handling */}
            <div className="flex items-center justify-between border border-coal-700/80 bg-coal-850/60 px-3.5 py-2.5">
              <div className="flex items-center gap-2.5">
                <ShieldCheck className="size-4 text-volt-400 shrink-0" />
                <span className="font-mono text-[10px] text-coal-300">
                  Backend-Route <code className="text-volt-300">/api/zernio</code> schützt{" "}
                  <code className="text-volt-300">ZERNIO_API_KEY</code> (Server-Only).
                </span>
              </div>
              <label className="flex cursor-pointer items-center gap-2 font-mono text-[9.5px] text-coal-400">
                <input
                  type="checkbox"
                  checked={Boolean(config.simulateErrorOnNextPost)}
                  onChange={(e) =>
                    setConfig((prev) => {
                      const next = { ...prev, simulateErrorOnNextPost: e.target.checked };
                      saveZernioConfig(next);
                      return next;
                    })
                  }
                  className="size-3.5 accent-ember-500"
                  style={{ display: "inline-block" }}
                />
                Test: Zernio-Fehler bei Post #1 simulieren
              </label>
            </div>

            {errorMsg && (
              <div className="flex items-start gap-2 border border-rose-err/50 bg-rose-err/10 px-3.5 py-2.5">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-rose-err" />
                <p className="font-mono text-[11px] text-rose-err">{errorMsg}</p>
              </div>
            )}

            {/* Submit & Cancel Actions */}
            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-coal-700/70 pt-4">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="border border-coal-600 px-4 py-2.5 font-mono text-[11px] font-bold text-coal-300 hover:border-coal-400"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={handleSchedule}
                disabled={submitting}
                className="bg-heat flex items-center gap-2 border border-volt-400 px-6 py-3 font-display text-xs font-black tracking-wider text-coal-950 uppercase transition-opacity hover:opacity-95 disabled:opacity-50"
              >
                {submitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {mode === "now" ? "Veröffentliche über Zernio…" : "Plane über Zernio…"}
                  </>
                ) : mode === "now" ? (
                  <>
                    <Rocket className="size-4" /> {postCount} Video(s) sofort posten
                  </>
                ) : (
                  <>
                    <Send className="size-4" /> {postCount} Posts planen
                    {mode === "auto" ? " (06:00 & 20:00 Uhr)" : ""}
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  Clock,
  Layers,
  Loader2,
  Rocket,
  Send,
  ShieldCheck,
  Sliders,
  X,
} from "lucide-react";
import { cn } from "../utils/cn";
import type { LocalRenderItem } from "../lib/types";
import {
  createPosts,
  formatDateTime,
  loadPrefs,
  planAutoSlots,
  savePrefs,
  serviceMeta,
  wallTimeToISO,
  type BufferChannel,
  type BufferMode,
  type BufferPost,
  type BufferPrefs,
  type CreateJob,
} from "../lib/buffer";

type UiMode = "now" | "queue" | "custom" | "auto";

const MODE_TO_BUFFER: Record<UiMode, BufferMode> = {
  now: "shareNow",
  queue: "addToQueue",
  custom: "customScheduled",
  auto: "customScheduled",
};

const MODES: { id: UiMode; icon: typeof Rocket; title: string; sub: string }[] = [
  { id: "now", icon: Rocket, title: "Jetzt posten", sub: "shareNow · sofort live" },
  { id: "queue", icon: Layers, title: "Buffer Queue", sub: "addToQueue · nächster Slot" },
  { id: "custom", icon: CalendarClock, title: "Benutzerdefiniert", sub: "Datum & Uhrzeit wählen" },
  { id: "auto", icon: Sliders, title: "Automatisch planen", sub: "freie Slots über X Tage" },
];

const TIMEZONES = [
  "Europe/Berlin",
  "Europe/London",
  "Europe/Zurich",
  "Europe/Vienna",
  "America/New_York",
  "America/Los_Angeles",
  "UTC",
];

export default function BufferPostEditor({
  targetItems,
  channels,
  existingPosts,
  hasApiKey,
  onClose,
  onCreated,
  onOpenCalendar,
}: {
  targetItems: LocalRenderItem[];
  channels: BufferChannel[];
  existingPosts: BufferPost[];
  hasApiKey: boolean;
  onClose: () => void;
  onCreated: (posts: BufferPost[]) => void;
  onOpenCalendar: () => void;
}) {
  const [prefs, setPrefs] = useState<BufferPrefs>(() => loadPrefs());
  const [mode, setMode] = useState<UiMode>("auto");
  const [selected, setSelected] = useState<string[]>(() => {
    const stored = loadPrefs().selectedChannelIds.filter((id) => channels.some((c) => c.id === id));
    return stored.length ? stored : channels.filter((c) => c.connected).slice(0, 3).map((c) => c.id);
  });

  const [caption, setCaption] = useState(() => {
    const first = targetItems[0];
    return first?.idea ? `Storytime: ${first.idea}` : "";
  });
  const [hashtags, setHashtags] = useState(() => loadPrefs().defaultHashtags);
  const [ytTitle, setYtTitle] = useState(() => targetItems[0]?.idea?.slice(0, 90) || "Reddit Story");

  const now = new Date();
  const [date, setDate] = useState(
    () => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
  );
  const [time, setTime] = useState("20:00");
  const [timezone, setTimezone] = useState(prefs.timezone);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ created: number; failed: number; mode: UiMode } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  const videos = targetItems.filter((i) => i.blobUrl);
  const totalPosts = Math.max(1, videos.length) * Math.max(1, selected.length);

  /* Preview of the slots the automatic planner will occupy. */
  const autoSlots = useMemo(() => {
    if (mode !== "auto") return [];
    return planAutoSlots(existingPosts, {
      count: totalPosts,
      preferredTimes: prefs.preferredTimes,
      postsPerDay: prefs.postsPerDay,
      planDays: prefs.planDays,
      timezone,
    });
  }, [mode, existingPosts, totalPosts, prefs, timezone]);

  const toggleChannel = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const updatePrefs = (patch: Partial<BufferPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      savePrefs(next);
      return next;
    });
  };

  const submit = async () => {
    if (busy) return;
    if (selected.length === 0) {
      setError("Bitte mindestens einen Kanal auswählen.");
      return;
    }
    setBusy(true);
    setError(null);

    try {
      const tagList = hashtags.split(/[\s,]+/).map((t) => t.trim()).filter(Boolean);
      const bufferMode = MODE_TO_BUFFER[mode];
      const jobs: CreateJob[] = [];
      let slotIdx = 0;

      const sources = videos.length > 0 ? videos : targetItems.slice(0, 1);

      for (const item of sources) {
        for (const channelId of selected) {
          const ch = channels.find((c) => c.id === channelId);
          const body = caption.trim() || item.idea || "Neues Short";
          const text = [body, tagList.join(" ")].filter(Boolean).join("\n\n");

          let dueAt: string | undefined;
          if (mode === "custom") {
            const [y, m, d] = date.split("-").map(Number);
            const [hh, mm] = time.split(":").map(Number);
            dueAt = wallTimeToISO(y, m, d, hh, mm, timezone);
          } else if (mode === "auto") {
            dueAt = autoSlots[slotIdx]?.scheduledAt;
          }
          slotIdx++;

          jobs.push({
            localId: `bp_${Date.now()}_${slotIdx}_${Math.random().toString(36).slice(2, 6)}`,
            channelId,
            channelName: ch?.name,
            service: ch?.service,
            text,
            title: ch?.service === "youtube" ? ytTitle : body.slice(0, 100),
            caption: body,
            hashtags: tagList,
            mode: bufferMode,
            dueAt,
            mediaUrl: item.blobUrl,
          });
        }
      }

      const res = await createPosts(jobs);
      onCreated(res.posts);
      setResult({ created: res.created, failed: res.failed, mode });
      if (res.error && res.failed > 0) setError(res.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-coal-950/90 p-3 sm:p-4"
      onClick={() => !busy && onClose()}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="card-bracket mx-auto my-4 w-full max-w-4xl animate-rise border border-coal-600 bg-coal-900 p-4 sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-start justify-between gap-3 border-b border-coal-700/70 pb-4">
          <div className="min-w-0">
            <span className="bg-heat px-2 py-0.5 font-mono text-[10px] font-bold tracking-widest text-coal-950">
              BUFFER POST EDITOR
            </span>
            <h3 className="mt-2 font-display text-base font-black tracking-tight text-paper-100 uppercase sm:text-lg">
              Video veröffentlichen oder planen
            </h3>
            <p className="font-mono text-[10.5px] text-coal-300">
              {videos.length} Video(s) × {selected.length} Kanal(e) ={" "}
              <strong className="text-volt-300">{totalPosts} Buffer-Posts</strong>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="border border-coal-600 p-2 text-coal-300 hover:border-volt-400 hover:text-volt-300"
          >
            <X className="size-4" />
          </button>
        </div>

        {result ? (
          <div className="py-8 text-center">
            <div
              className={cn(
                "mx-auto grid size-14 place-items-center rounded-full border",
                result.failed === 0
                  ? "border-mint-400 bg-mint-400/10 text-mint-400"
                  : "border-amber-warn bg-amber-warn/10 text-amber-warn"
              )}
            >
              {result.failed === 0 ? (
                <Check className="size-7" strokeWidth={2.5} />
              ) : (
                <AlertTriangle className="size-7" />
              )}
            </div>
            <h4 className="mt-4 font-display text-lg font-black text-paper-100 uppercase">
              {result.failed === 0
                ? result.mode === "now"
                  ? `✓ ${result.created} Posts werden veröffentlicht`
                  : `✓ ${result.created} Posts erfolgreich geplant`
                : `${result.created} erfolgreich · ${result.failed} fehlgeschlagen`}
            </h4>
            {result.failed > 0 && (
              <p className="mx-auto mt-2 max-w-md font-mono text-[10.5px] leading-relaxed text-rose-err">
                ❌ Fehlgeschlagene Posts sind im Kalender rot markiert und können dort erneut
                versucht werden.
              </p>
            )}
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenCalendar();
                }}
                className="bg-heat flex items-center gap-2 border border-volt-400 px-5 py-3 font-display text-xs font-black tracking-wider text-coal-950 uppercase"
              >
                <CalendarClock className="size-4" /> Zum Kalender
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
          <div className="mt-4 grid gap-4 lg:grid-cols-[240px_1fr]">
            {/* ---------------- left: video preview ---------------- */}
            <div className="grid content-start gap-2">
              <span className="mono-label text-[9px] text-coal-400">VIDEO PREVIEW</span>
              <div className="overflow-hidden border border-coal-700 bg-black">
                {videos[0]?.blobUrl ? (
                  <video
                    src={videos[0].blobUrl}
                    controls
                    playsInline
                    muted
                    className="w-full"
                    style={{ aspectRatio: "9 / 16" }}
                  />
                ) : (
                  <div
                    className="grid place-items-center bg-coal-850 text-coal-500"
                    style={{ aspectRatio: "9 / 16" }}
                  >
                    <span className="font-mono text-[10px]">Kein Video</span>
                  </div>
                )}
              </div>
              {videos.length > 1 && (
                <p className="font-mono text-[9px] text-coal-400">
                  +{videos.length - 1} weitere Videos in diesem Batch
                </p>
              )}
            </div>

            {/* ---------------- right: controls ---------------- */}
            <div className="grid content-start gap-4">
              {/* platforms */}
              <div>
                <label className="mono-label mb-2 block text-[9px] text-coal-400">
                  PLATTFORM / KANAL ({selected.length} AUSGEWÄHLT)
                </label>
                {channels.length === 0 ? (
                  <div className="border border-amber-warn/40 bg-amber-warn/10 px-3 py-2.5">
                    <p className="font-mono text-[10px] leading-relaxed text-amber-warn">
                      Keine Buffer-Kanäle geladen. {hasApiKey
                        ? "Bitte Kanäle in Buffer verbinden."
                        : "BUFFER_API_KEY auf dem Server setzen — Posts werden bis dahin lokal gespeichert."}
                    </p>
                  </div>
                ) : (
                  <div className="grid max-h-[150px] gap-1.5 overflow-y-auto sm:grid-cols-2">
                    {channels.map((c) => {
                      const active = selected.includes(c.id);
                      const meta = serviceMeta(c.service);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => toggleChannel(c.id)}
                          className={cn(
                            "flex items-center gap-2 border px-2.5 py-2 text-left transition-colors",
                            active
                              ? "border-volt-400 bg-volt-400/15"
                              : "border-coal-700 bg-coal-850 hover:border-coal-500"
                          )}
                        >
                          <span className="text-base leading-none">{meta.icon}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-display text-[11px] font-bold text-paper-100">
                              {c.name}
                            </span>
                            <span className="block font-mono text-[8.5px] text-coal-400">
                              {meta.label}
                              {c.connected ? "" : " · getrennt"}
                            </span>
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
                )}
              </div>

              {/* caption + hashtags */}
              <div className="grid gap-3">
                <div>
                  <label className="mono-label mb-1 block text-[9px] text-coal-400">CAPTION</label>
                  <textarea
                    rows={2}
                    value={caption}
                    onChange={(e) => setCaption(e.target.value)}
                    placeholder="Was soll unter dem Video stehen?"
                    className="w-full border border-coal-700 bg-coal-850 px-3 py-2 font-mono text-[12px] leading-relaxed text-paper-100 focus:border-volt-400 focus:outline-none"
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mono-label mb-1 block text-[9px] text-coal-400">HASHTAGS</label>
                    <input
                      type="text"
                      value={hashtags}
                      onChange={(e) => setHashtags(e.target.value)}
                      className="w-full border border-coal-700 bg-coal-850 px-3 py-2 font-mono text-[12px] text-paper-100 focus:border-volt-400 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mono-label mb-1 block text-[9px] text-coal-400">
                      YOUTUBE-TITEL
                    </label>
                    <input
                      type="text"
                      value={ytTitle}
                      onChange={(e) => setYtTitle(e.target.value)}
                      maxLength={100}
                      className="w-full border border-coal-700 bg-coal-850 px-3 py-2 font-mono text-[12px] text-paper-100 focus:border-volt-400 focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* posting mode */}
              <div>
                <label className="mono-label mb-2 block text-[9px] text-coal-400">
                  VERÖFFENTLICHUNGSMODUS
                </label>
                <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
                  {MODES.map(({ id, icon: Icon, title, sub }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setMode(id)}
                      className={cn(
                        "flex items-start gap-2 border px-2.5 py-2 text-left transition-colors",
                        mode === id
                          ? "border-volt-400 bg-volt-400/15"
                          : "border-coal-700 bg-coal-850 hover:border-coal-500"
                      )}
                    >
                      <Icon
                        className={cn(
                          "mt-0.5 size-3.5 shrink-0",
                          mode === id ? "text-volt-300" : "text-coal-400"
                        )}
                      />
                      <span className="min-w-0">
                        <span className="block font-display text-[11px] font-bold text-paper-100">
                          {title}
                        </span>
                        <span className="block font-mono text-[8px] leading-tight text-coal-400">
                          {sub}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* mode-specific controls */}
              {mode === "custom" && (
                <div className="grid gap-3 border border-coal-700/80 bg-coal-850/50 p-3 sm:grid-cols-3">
                  <div>
                    <label className="mono-label mb-1 block text-[9px] text-coal-400">DATUM</label>
                    <input
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      className="w-full border border-coal-700 bg-coal-900 px-3 py-2 font-mono text-[12px] text-paper-100 focus:border-volt-400 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mono-label mb-1 block text-[9px] text-coal-400">UHRZEIT</label>
                    <input
                      type="time"
                      value={time}
                      onChange={(e) => setTime(e.target.value)}
                      className="w-full border border-coal-700 bg-coal-900 px-3 py-2 font-mono text-[12px] text-paper-100 focus:border-volt-400 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mono-label mb-1 block text-[9px] text-coal-400">ZEITZONE</label>
                    <select
                      value={timezone}
                      onChange={(e) => {
                        setTimezone(e.target.value);
                        updatePrefs({ timezone: e.target.value });
                      }}
                      className="w-full border border-coal-700 bg-coal-900 px-3 py-2 font-mono text-[12px] text-paper-100 focus:border-volt-400 focus:outline-none"
                    >
                      {TIMEZONES.map((tz) => (
                        <option key={tz} value={tz} className="bg-coal-900">
                          {tz}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {mode === "auto" && (
                <div className="grid gap-3 border border-coal-700/80 bg-coal-850/50 p-3">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <label className="mono-label mb-1 block text-[9px] text-coal-400">
                        POSTS PRO TAG
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={8}
                        value={prefs.postsPerDay}
                        onChange={(e) =>
                          updatePrefs({ postsPerDay: Math.max(1, Math.min(8, +e.target.value || 1)) })
                        }
                        className="w-full border border-coal-700 bg-coal-900 px-3 py-2 font-mono text-[12px] text-paper-100 focus:border-volt-400 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="mono-label mb-1 block text-[9px] text-coal-400">
                        ANZAHL TAGE
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={60}
                        value={prefs.planDays}
                        onChange={(e) =>
                          updatePrefs({ planDays: Math.max(1, Math.min(60, +e.target.value || 1)) })
                        }
                        className="w-full border border-coal-700 bg-coal-900 px-3 py-2 font-mono text-[12px] text-paper-100 focus:border-volt-400 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="mono-label mb-1 block text-[9px] text-coal-400">ZEITZONE</label>
                      <select
                        value={timezone}
                        onChange={(e) => {
                          setTimezone(e.target.value);
                          updatePrefs({ timezone: e.target.value });
                        }}
                        className="w-full border border-coal-700 bg-coal-900 px-3 py-2 font-mono text-[12px] text-paper-100 focus:border-volt-400 focus:outline-none"
                      >
                        {TIMEZONES.map((tz) => (
                          <option key={tz} value={tz} className="bg-coal-900">
                            {tz}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="mono-label mb-1 block text-[9px] text-coal-400">
                      BEVORZUGTE ZEITEN (KOMMAGETRENNT)
                    </label>
                    <input
                      type="text"
                      value={prefs.preferredTimes.join(", ")}
                      onChange={(e) =>
                        updatePrefs({
                          preferredTimes: e.target.value
                            .split(/[,\s]+/)
                            .map((t) => t.trim())
                            .filter(Boolean),
                        })
                      }
                      placeholder="06:00, 12:00, 18:00, 20:00"
                      className="w-full border border-coal-700 bg-coal-900 px-3 py-2 font-mono text-[12px] text-paper-100 focus:border-volt-400 focus:outline-none"
                    />
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {autoSlots.slice(0, 10).map((s, i) => {
                      const f = formatDateTime(s.scheduledAt, timezone);
                      return (
                        <span
                          key={s.key}
                          className="border border-coal-700 bg-coal-900 px-2 py-1 font-mono text-[9px] text-volt-300"
                        >
                          #{i + 1} {f.weekday} {f.date.slice(0, 5)} · {f.time.replace(" Uhr", "")}
                        </span>
                      );
                    })}
                    {autoSlots.length === 0 && (
                      <span className="font-mono text-[9px] text-coal-400">
                        Keine freien Slots gefunden — Zeiten oder Tage erhöhen.
                      </span>
                    )}
                  </div>
                </div>
              )}

              {mode === "queue" && (
                <div className="flex items-start gap-2 border border-coal-700/80 bg-coal-850/50 px-3 py-2.5">
                  <Clock className="mt-0.5 size-4 shrink-0 text-volt-400" />
                  <p className="font-mono text-[10px] leading-relaxed text-coal-300">
                    Buffer setzt jeden Post automatisch auf den nächsten freien Slot des jeweiligen
                    Kanal-Zeitplans (<code className="text-volt-300">addToQueue</code>).
                  </p>
                </div>
              )}

              {/* key notice */}
              <div className="flex items-start gap-2 border border-coal-700/80 bg-coal-850/60 px-3 py-2.5">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-volt-400" />
                <p className="font-mono text-[9.5px] leading-relaxed text-coal-300">
                  {hasApiKey
                    ? "Verbunden über /api/buffer — der BUFFER_API_KEY bleibt serverseitig."
                    : "Kein BUFFER_API_KEY gesetzt: Posts werden lokal gespeichert und erscheinen im Kalender, gehen aber noch nicht live."}
                </p>
              </div>

              {error && (
                <div className="flex items-start gap-2 border border-rose-err/50 bg-rose-err/10 px-3 py-2.5">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-rose-err" />
                  <p className="font-mono text-[10.5px] leading-relaxed text-rose-err">{error}</p>
                </div>
              )}

              {/* actions */}
              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-coal-700/70 pt-4">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={busy}
                  className="border border-coal-600 px-4 py-2.5 font-mono text-[11px] font-bold text-coal-300 hover:border-coal-400"
                >
                  Abbrechen
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={busy || selected.length === 0}
                  className="bg-heat flex min-h-[44px] items-center gap-2 border border-volt-400 px-5 py-3 font-display text-xs font-black tracking-wider text-coal-950 uppercase transition-opacity hover:opacity-95 disabled:opacity-50"
                >
                  {busy ? (
                    <>
                      <Loader2 className="size-4 animate-spin" /> Sende an Buffer…
                    </>
                  ) : mode === "now" ? (
                    <>
                      <Rocket className="size-4" /> Jetzt veröffentlichen ({totalPosts})
                    </>
                  ) : (
                    <>
                      <Send className="size-4" /> {totalPosts} Posts{" "}
                      {mode === "queue" ? "in Queue" : "planen"}
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

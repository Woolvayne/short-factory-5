import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  Film,
  Loader2,
  RefreshCw,
  RotateCw,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "../utils/cn";
import {
  STATUS_STYLE,
  cancelPost,
  dateKey,
  formatDateTime,
  refreshOpenPosts,
  reschedulePost,
  serviceMeta,
  syncPostsFromLake,
  type LakePost,
} from "../lib/postlake";
import {
  cancelBufferPost,
  refreshOpenBufferPosts,
  rescheduleBufferPost,
  syncBufferPosts,
} from "../lib/buffer";

type ViewMode = "month" | "week" | "day";

export default function PostlakeCalendar({
  posts,
  timezone,
  loading,
  onPostsChange,
  onRefresh,
}: {
  posts: LakePost[];
  timezone: string;
  loading: boolean;
  onPostsChange: (posts: LakePost[]) => void;
  onRefresh: () => void;
}) {
  const [view, setView] = useState<ViewMode>("week");
  const [cursor, setCursor] = useState(() => new Date());
  const [selected, setSelected] = useState<LakePost | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [editDate, setEditDate] = useState("");
  const [editTime, setEditTime] = useState("");
  const [error, setError] = useState<string | null>(null);

  const shift = (dir: -1 | 1) => {
    const next = new Date(cursor);
    if (view === "month") next.setMonth(next.getMonth() + dir);
    else if (view === "week") next.setDate(next.getDate() + dir * 7);
    else next.setDate(next.getDate() + dir);
    setCursor(next);
  };

  const days = useMemo(() => {
    const out: Date[] = [];
    if (view === "day") {
      out.push(new Date(cursor));
    } else if (view === "week") {
      const d = new Date(cursor);
      const dow = d.getDay() === 0 ? 6 : d.getDay() - 1;
      const monday = new Date(d);
      monday.setDate(d.getDate() - dow);
      for (let i = 0; i < 7; i++) {
        const c = new Date(monday);
        c.setDate(monday.getDate() + i);
        out.push(c);
      }
    } else {
      const y = cursor.getFullYear();
      const m = cursor.getMonth();
      const startOffset = (new Date(y, m, 1).getDay() + 6) % 7;
      const start = new Date(y, m, 1 - startOffset);
      for (let i = 0; i < 35; i++) {
        const c = new Date(start);
        c.setDate(start.getDate() + i);
        out.push(c);
      }
    }
    return out;
  }, [cursor, view]);

  const openDetail = (p: LakePost) => {
    setSelected(p);
    setError(null);
    const f = new Date(p.scheduledAt);
    const pad = (n: number) => String(n).padStart(2, "0");
    setEditDate(`${f.getFullYear()}-${pad(f.getMonth() + 1)}-${pad(f.getDate())}`);
    setEditTime(`${pad(f.getHours())}:${pad(f.getMinutes())}`);
  };

  const doSync = async () => {
    setSyncing(true);
    setError(null);
    try {
      // Beide Versandwege nacheinander (teilen sich denselben lokalen Spiegel)
      const lake = await syncPostsFromLake({ limit: 100 });
      const buf = await syncBufferPosts({ limit: 100 });
      onPostsChange(buf.posts);
      const errs = [lake.error, buf.error].filter(Boolean);
      if (errs.length > 0) setError(errs.join(" · "));
    } finally {
      setSyncing(false);
    }
  };

  const doPoll = async () => {
    setSyncing(true);
    try {
      const lake = await refreshOpenPosts();
      const buf = await refreshOpenBufferPosts();
      // Beide Refreshes teilen den Cache — der zweite Stand ist der frischeste
      onPostsChange(buf.posts.length >= 0 ? buf.posts : lake.posts);
    } finally {
      setSyncing(false);
    }
  };

  const doCancel = async (p: LakePost) => {
    setBusy(true);
    try {
      const next = p.provider === "buffer" ? await cancelBufferPost(p) : await cancelPost(p);
      onPostsChange(next);
      setSelected(null);
    } finally {
      setBusy(false);
    }
  };

  const doReschedule = async (p: LakePost) => {
    if (!editDate || !editTime) return;
    setBusy(true);
    setError(null);
    try {
      const naive = `${editDate}T${editTime}:00`;
      const res =
        p.provider === "buffer"
          ? await rescheduleBufferPost(p, naive, timezone)
          : await reschedulePost(p, naive, timezone);
      onPostsChange(res.posts);
      if (res.error) setError(res.error);
      else setSelected(res.posts.find((x) => x.id === p.id) || null);
    } finally {
      setBusy(false);
    }
  };

  const title = new Intl.DateTimeFormat("de-DE", {
    timeZone: timezone,
    month: "long",
    year: "numeric",
  }).format(cursor);

  return (
    <section className="card-bracket border border-coal-600 bg-coal-900/90 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-coal-700/70 pb-3">
        <div className="flex items-center gap-2.5">
          <CalendarDays className="size-4 text-volt-400" />
          <h3 className="font-display text-sm font-black tracking-wide text-paper-100 uppercase">
            Content Kalender
          </h3>
          <span className="font-mono text-[9.5px] text-coal-400">{posts.length} Posts</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={doPoll}
            disabled={syncing}
            title="Offene Posts bei Postlake pollen"
            className="flex min-h-[32px] items-center gap-1.5 border border-coal-600 px-2.5 py-1 font-mono text-[10px] font-bold tracking-widest text-coal-300 hover:border-volt-400 hover:text-volt-300 disabled:opacity-40"
          >
            {syncing ? <Loader2 className="size-3 animate-spin" /> : <RotateCw className="size-3" />}
            STATUS
          </button>
          <button
            type="button"
            onClick={() => {
              onRefresh();
              void doSync();
            }}
            disabled={loading || syncing}
            title="Postliste von Postlake laden"
            className="flex min-h-[32px] items-center gap-1.5 border border-coal-600 px-2.5 py-1 font-mono text-[10px] font-bold tracking-widest text-coal-300 hover:border-volt-400 hover:text-volt-300 disabled:opacity-40"
          >
            {loading || syncing ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <RefreshCw className="size-3" />
            )}
            SYNC
          </button>
        </div>
      </div>

      {/* Navigation */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => shift(-1)}
            className="border border-coal-600 p-1.5 text-coal-300 hover:border-volt-400 hover:text-volt-300"
            aria-label="Zurück"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setCursor(new Date())}
            className="border border-coal-600 px-2.5 py-1 font-mono text-[10px] font-bold tracking-widest text-coal-200 hover:border-volt-400"
          >
            HEUTE
          </button>
          <button
            type="button"
            onClick={() => shift(1)}
            className="border border-coal-600 p-1.5 text-coal-300 hover:border-volt-400 hover:text-volt-300"
            aria-label="Weiter"
          >
            <ChevronRight className="size-4" />
          </button>
          <h4 className="ml-1 font-display text-sm font-black text-paper-100 uppercase">{title}</h4>
        </div>
        <div className="flex gap-1">
          {(["month", "week", "day"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setView(m)}
              className={cn(
                "border px-2.5 py-1 font-mono text-[9.5px] font-bold tracking-widest",
                view === m
                  ? "bg-heat border-volt-400 text-coal-950"
                  : "border-coal-700 bg-coal-850 text-coal-300 hover:border-coal-500"
              )}
            >
              {m === "month" ? "MONAT" : m === "week" ? "WOCHE" : "TAG"}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mt-3 flex items-start gap-2 border border-rose-err/50 bg-rose-err/10 px-3 py-2">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-rose-err" />
          <p className="font-mono text-[10px] text-rose-err">{error}</p>
        </div>
      )}

      {/* Grid */}
      <div
        className={cn(
          "mt-3 grid gap-2",
          view === "month" ? "grid-cols-1 sm:grid-cols-7" : view === "week" ? "grid-cols-1 md:grid-cols-7" : "grid-cols-1"
        )}
      >
        {days.map((day) => {
          const key = dateKey(day, timezone);
          const isToday = key === dateKey(new Date(), timezone);
          const dayPosts = posts
            .filter((p) => dateKey(new Date(p.scheduledAt), timezone) === key)
            .sort((a, b) => +new Date(a.scheduledAt) - +new Date(b.scheduledAt));
          const wd = new Intl.DateTimeFormat("de-DE", { timeZone: timezone, weekday: "short" }).format(day);
          const dn = new Intl.DateTimeFormat("de-DE", {
            timeZone: timezone,
            day: "2-digit",
            month: "2-digit",
          }).format(day);

          return (
            <div
              key={key + day.getTime()}
              className={cn(
                "min-h-[120px] border p-2",
                isToday ? "border-volt-400/70 bg-coal-850/90" : "border-coal-700/80 bg-coal-850/40"
              )}
            >
              <div className="flex items-center justify-between border-b border-coal-700/60 pb-1.5">
                <span
                  className={cn(
                    "font-mono text-[10px] font-bold uppercase",
                    isToday ? "text-volt-300" : "text-coal-300"
                  )}
                >
                  {wd} · {dn}
                </span>
                {isToday && (
                  <span className="bg-heat px-1.5 py-px font-mono text-[8px] font-bold text-coal-950">
                    HEUTE
                  </span>
                )}
              </div>
              <div className="mt-1.5 grid gap-1.5">
                {dayPosts.map((p) => {
                  const f = formatDateTime(p.scheduledAt, timezone);
                  const st = STATUS_STYLE[p.status];
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => openDetail(p)}
                      className="w-full border border-coal-700 bg-coal-900 p-2 text-left transition-colors hover:border-volt-400"
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="flex items-center gap-1 font-mono text-[9.5px] font-bold text-volt-300">
                          <Clock className="size-3" /> {f.time.replace(" Uhr", "")}
                        </span>
                        <span className="font-mono text-[8px]">{st.dot}</span>
                      </div>
                      <p className="mt-1 truncate font-display text-[11px] font-bold text-paper-100">
                        {p.title}
                      </p>
                      <p className="font-mono text-[7.5px] tracking-widest text-coal-500">
                        {p.provider === "buffer" ? "📦 BUFFER" : "🌊 POSTLAKE"}
                      </p>
                      <div className="mt-1 flex items-center gap-1">
                        <span className="flex gap-0.5 text-[10px]">
                          {(p.platforms.length > 0 ? p.platforms : ["?"]).slice(0, 4).map((s, i) => (
                            <span key={i}>{serviceMeta(s).icon}</span>
                          ))}
                        </span>
                        <span
                          className={cn(
                            "ml-auto border px-1 py-px font-mono text-[7.5px] font-bold uppercase",
                            st.cls
                          )}
                        >
                          {p.status}
                        </span>
                      </div>
                    </button>
                  );
                })}
                {dayPosts.length === 0 && (
                  <span className="font-mono text-[8.5px] text-coal-600">—</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Detail */}
      {selected && (
        <div
          className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-coal-950/90 p-4"
          onClick={() => setSelected(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="card-bracket my-8 w-full max-w-2xl animate-rise border border-coal-600 bg-coal-900 p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-coal-700/70 pb-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "border px-2 py-0.5 font-mono text-[9px] font-bold uppercase",
                      STATUS_STYLE[selected.status].cls
                    )}
                  >
                    {STATUS_STYLE[selected.status].dot} {selected.status}
                  </span>
                  {selected.local && (
                    <span className="border border-coal-600 px-2 py-0.5 font-mono text-[9px] text-coal-300">
                      NUR LOKAL
                    </span>
                  )}
                </div>
                <h3 className="mt-2 truncate font-display text-base font-black text-paper-100 uppercase">
                  {selected.title}
                </h3>
                <p className="font-mono text-[10.5px] text-volt-300">
                  {formatDateTime(selected.scheduledAt, timezone).full} · {timezone}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="border border-coal-600 p-1.5 text-coal-300 hover:border-volt-400 hover:text-volt-300"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-[180px_1fr]">
              <div className="overflow-hidden border border-coal-700 bg-black">
                {selected.previewUrl ? (
                  <video
                    src={selected.previewUrl}
                    controls
                    playsInline
                    muted
                    className="w-full"
                    style={{ aspectRatio: "9 / 16" }}
                  />
                ) : (
                  <div
                    className="grid place-items-center bg-coal-850 p-4 text-center text-coal-500"
                    style={{ aspectRatio: "9 / 16" }}
                  >
                    <div>
                      <Film className="mx-auto mb-2 size-7" />
                      <span className="font-mono text-[9px]">Keine Vorschau</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="grid content-start gap-3">
                <p className="border border-coal-700/80 bg-coal-850 p-3 font-mono text-[10.5px] leading-relaxed whitespace-pre-line text-coal-200">
                  {selected.text || "—"}
                </p>

                {selected.hashtags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {selected.hashtags.map((t, i) => (
                      <span
                        key={i}
                        className="border border-coal-700 bg-coal-850 px-2 py-0.5 font-mono text-[10px] text-volt-300"
                      >
                        {t.startsWith("#") ? t : `#${t}`}
                      </span>
                    ))}
                  </div>
                )}

                <div>
                  <span className="mono-label mb-1 block text-[9px] text-coal-400">
                    ZIELE ({selected.targets.length})
                  </span>
                  <div className="grid gap-1.5">
                    {selected.targets.map((t, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 border border-coal-700/70 bg-coal-850/60 px-2.5 py-1.5"
                      >
                        <span className="text-sm">{serviceMeta(t.platform).icon}</span>
                        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-coal-200">
                          {serviceMeta(t.platform).label}
                          {t.error
                            ? ` — ${typeof t.error === "string" ? t.error : t.error.message || t.error.type}`
                            : ""}
                        </span>
                        {t.permalinkPending ? (
                          <span className="font-mono text-[9px] text-coal-400">Link folgt…</span>
                        ) : t.url ? (
                          <a
                            href={t.url}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-1 font-mono text-[9px] text-volt-300 underline"
                          >
                            Live <ExternalLink className="size-3" />
                          </a>
                        ) : (
                          <span className="font-mono text-[9px] text-coal-500">{t.state}</span>
                        )}
                      </div>
                    ))}
                    {selected.targets.length === 0 && (
                      <span className="font-mono text-[9.5px] text-coal-500">Keine Ziele.</span>
                    )}
                  </div>
                </div>

                {selected.provider === "buffer" && selected.videoUrl && (
                  <div className="border border-coal-700/70 bg-coal-850/60 px-2.5 py-1.5">
                    <p className="truncate font-mono text-[9px] text-coal-400">
                      🎬 Video-Host:{" "}
                      <a
                        href={selected.videoUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-volt-300 underline"
                      >
                        {selected.videoUrl}
                      </a>
                    </p>
                  </div>
                )}

                {selected.errorMessage && (
                  <div className="border border-rose-err/50 bg-rose-err/10 p-3">
                    <p className="font-mono text-[10px] text-rose-err">{selected.errorMessage}</p>
                  </div>
                )}

                {selected.warnings && selected.warnings.length > 0 && (
                  <div className="border border-amber-warn/40 bg-amber-warn/10 p-3">
                    {selected.warnings.map((w, i) => (
                      <p key={i} className="font-mono text-[10px] text-amber-warn">
                        ⚠ {w}
                      </p>
                    ))}
                  </div>
                )}

                {selected.status === "Geplant" && (
                  <div className="grid grid-cols-2 gap-2 border border-coal-700/80 bg-coal-850/50 p-3">
                    <div>
                      <label className="mono-label mb-1 block text-[9px] text-coal-400">DATUM</label>
                      <input
                        type="date"
                        value={editDate}
                        onChange={(e) => setEditDate(e.target.value)}
                        className="w-full border border-coal-700 bg-coal-900 px-2 py-1.5 font-mono text-[11px] text-paper-100"
                      />
                    </div>
                    <div>
                      <label className="mono-label mb-1 block text-[9px] text-coal-400">UHRZEIT</label>
                      <input
                        type="time"
                        value={editTime}
                        onChange={(e) => setEditTime(e.target.value)}
                        className="w-full border border-coal-700 bg-coal-900 px-2 py-1.5 font-mono text-[11px] text-paper-100"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => void doReschedule(selected)}
                      disabled={busy}
                      className="col-span-2 border border-volt-400 bg-volt-400/15 px-3 py-2 font-mono text-[10.5px] font-bold text-volt-300 hover:bg-volt-400/25 disabled:opacity-40"
                    >
                      {busy ? "SPEICHERE…" : "UMPLANEN"}
                    </button>
                  </div>
                )}

                <div className="flex flex-wrap justify-end gap-2 border-t border-coal-700/70 pt-3">
                  {(selected.status === "Geplant" || selected.status === "Entwurf") && (
                    <button
                      type="button"
                      onClick={() => void doCancel(selected)}
                      disabled={busy}
                      className="flex items-center gap-1.5 border border-rose-err/60 bg-rose-err/10 px-3.5 py-2 font-mono text-[10px] font-bold text-rose-err hover:bg-rose-err hover:text-coal-950 disabled:opacity-40"
                    >
                      <Trash2 className="size-3.5" /> Stornieren
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setSelected(null)}
                    className="border border-coal-600 px-3.5 py-2 font-mono text-[10px] font-bold text-coal-200 hover:border-volt-400"
                  >
                    Fertig
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

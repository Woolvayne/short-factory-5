import { useMemo, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  Film,
  Loader2,
  RefreshCw,
  Rocket,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "../utils/cn";
import {
  STATUS_DOTS,
  createPosts,
  dateKey,
  deletePost as apiDeletePost,
  formatDateTime,
  serviceMeta,
  updateCachedPost,
  wallTimeToISO,
  type BufferPost,
} from "../lib/buffer";

type ViewMode = "month" | "week" | "day";

export default function BufferCalendar({
  posts,
  loading,
  onPostsChange,
  onRefresh,
}: {
  posts: BufferPost[];
  loading: boolean;
  onPostsChange: (posts: BufferPost[]) => void;
  onRefresh: () => void;
}) {
  const [view, setView] = useState<ViewMode>("week");
  const [cursor, setCursor] = useState(() => new Date());
  const [selected, setSelected] = useState<BufferPost | null>(null);
  const [busy, setBusy] = useState(false);

  /* detail editor state */
  const [editCaption, setEditCaption] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editTime, setEditTime] = useState("");

  const openDetail = (p: BufferPost) => {
    setSelected(p);
    setEditCaption(p.caption || p.text || "");
    const f = new Date(p.scheduledAt);
    const pad = (n: number) => String(n).padStart(2, "0");
    setEditDate(`${f.getFullYear()}-${pad(f.getMonth() + 1)}-${pad(f.getDate())}`);
    setEditTime(`${pad(f.getHours())}:${pad(f.getMinutes())}`);
  };

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
      const first = new Date(y, m, 1);
      const offset = first.getDay() === 0 ? 6 : first.getDay() - 1;
      const start = new Date(y, m, 1 - offset);
      for (let i = 0; i < 35; i++) {
        const c = new Date(start);
        c.setDate(start.getDate() + i);
        out.push(c);
      }
    }
    return out;
  }, [cursor, view]);

  const title = new Intl.DateTimeFormat("de-DE", {
    month: "long",
    year: "numeric",
    timeZone: "Europe/Berlin",
  }).format(cursor);

  /* ---------------- actions ---------------- */

  const handleDelete = async (p: BufferPost) => {
    setBusy(true);
    try {
      const next = await apiDeletePost(p);
      onPostsChange(next);
      setSelected(null);
    } finally {
      setBusy(false);
    }
  };

  const handleSaveEdits = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const [y, m, d] = editDate.split("-").map(Number);
      const [hh, mm] = editTime.split(":").map(Number);
      const iso = wallTimeToISO(y, m, d, hh, mm, "Europe/Berlin");
      const next = updateCachedPost(selected.id, {
        caption: editCaption,
        text: editCaption,
        title: editCaption.split("\n")[0].slice(0, 120),
        scheduledAt: iso,
      });
      onPostsChange(next);
      setSelected({ ...selected, caption: editCaption, scheduledAt: iso });
    } finally {
      setBusy(false);
    }
  };

  /** Republish an existing entry immediately (also used as retry for errors). */
  const handlePublishNow = async (p: BufferPost) => {
    setBusy(true);
    try {
      const res = await createPosts([
        {
          localId: `retry_${Date.now()}`,
          channelId: p.channelId,
          channelName: p.channelName,
          service: p.service,
          text: p.text || p.caption || "",
          title: p.title,
          caption: p.caption || p.text || "",
          hashtags: p.hashtags || [],
          mode: "shareNow",
          mediaUrl: p.videoUrl,
        },
      ]);
      const cleaned = res.posts.filter((x) => x.id !== p.id);
      onPostsChange(cleaned);
      setSelected(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card-bracket border border-coal-600 bg-coal-900/90 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-coal-700/70 pb-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="size-4 shrink-0 text-volt-400" />
          <h3 className="font-display text-sm font-black tracking-wide text-paper-100 uppercase">
            Content Kalender
          </h3>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="ml-1 border border-coal-600 p-1.5 text-coal-300 hover:border-volt-400 hover:text-volt-300 disabled:opacity-40"
            title="Aus Buffer neu laden"
          >
            {loading ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <RefreshCw className="size-3" />
            )}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {(["month", "week", "day"] as ViewMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setView(m)}
              className={cn(
                "border px-2.5 py-1 font-mono text-[9.5px] font-bold tracking-widest transition-colors",
                view === m
                  ? "bg-heat border-volt-400 text-coal-950"
                  : "border-coal-700 bg-coal-850 text-coal-300 hover:border-coal-500"
              )}
            >
              {m === "month" ? "Monat" : m === "week" ? "Woche" : "Tag"}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => shift(-1)}
          className="border border-coal-600 p-1.5 text-coal-300 hover:border-volt-400"
        >
          <ChevronLeft className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setCursor(new Date())}
          className="border border-coal-600 px-2.5 py-1 font-mono text-[9.5px] font-bold tracking-widest text-coal-200 hover:border-volt-400"
        >
          HEUTE
        </button>
        <button
          type="button"
          onClick={() => shift(1)}
          className="border border-coal-600 p-1.5 text-coal-300 hover:border-volt-400"
        >
          <ChevronRight className="size-3.5" />
        </button>
        <span className="ml-1 font-display text-sm font-black text-paper-100 uppercase">
          {title}
        </span>
      </div>

      <div
        className={cn(
          "mt-3 grid gap-2",
          view === "month"
            ? "grid-cols-2 sm:grid-cols-4 lg:grid-cols-7"
            : view === "week"
              ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7"
              : "grid-cols-1"
        )}
      >
        {days.map((d) => {
          const key = dateKey(d);
          const isToday = key === dateKey(new Date());
          const dayPosts = posts
            .filter((p) => dateKey(new Date(p.scheduledAt)) === key)
            .sort((a, b) => +new Date(a.scheduledAt) - +new Date(b.scheduledAt));

          const wd = new Intl.DateTimeFormat("de-DE", {
            weekday: "short",
            timeZone: "Europe/Berlin",
          }).format(d);
          const dm = new Intl.DateTimeFormat("de-DE", {
            day: "2-digit",
            month: "2-digit",
            timeZone: "Europe/Berlin",
          }).format(d);

          return (
            <div
              key={key}
              className={cn(
                "flex min-h-[110px] flex-col gap-1.5 border p-2",
                isToday
                  ? "border-volt-400/60 bg-coal-850/90"
                  : "border-coal-700/70 bg-coal-850/40"
              )}
            >
              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    "font-mono text-[10px] font-bold uppercase",
                    isToday ? "text-volt-300" : "text-coal-300"
                  )}
                >
                  {wd} {dm}
                </span>
                {dayPosts.length > 0 && (
                  <span className="font-mono text-[8.5px] text-coal-400">{dayPosts.length}</span>
                )}
              </div>

              {dayPosts.map((p) => {
                const f = formatDateTime(p.scheduledAt);
                const sm = serviceMeta(p.service);
                const st = STATUS_DOTS[p.status] ?? STATUS_DOTS.Geplant;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => openDetail(p)}
                    className="w-full border border-coal-700 bg-coal-900 p-1.5 text-left transition-colors hover:border-volt-400"
                  >
                    <span className="flex items-center gap-1">
                      <span className="text-[11px] leading-none">{sm.icon}</span>
                      <span className="truncate font-mono text-[9px] font-bold text-coal-200">
                        {sm.label}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate font-display text-[10px] font-bold text-paper-100">
                      {p.title || p.text.slice(0, 40)}
                    </span>
                    <span className="mt-0.5 flex items-center justify-between gap-1">
                      <span className="font-mono text-[9px] text-volt-300">
                        {f.time.replace(" Uhr", "")}
                      </span>
                      <span className={cn("border px-1 font-mono text-[7.5px]", st.cls)}>
                        {st.dot} {p.status}
                      </span>
                    </span>
                  </button>
                );
              })}

              {dayPosts.length === 0 && (
                <span className="mt-auto font-mono text-[8.5px] text-coal-500">frei</span>
              )}
            </div>
          );
        })}
      </div>

      {/* ---------------- detail modal ---------------- */}
      {selected && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto bg-coal-950/90 p-3 sm:p-4"
          onClick={() => !busy && setSelected(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="card-bracket mx-auto my-4 w-full max-w-2xl animate-rise border border-coal-600 bg-coal-900 p-4 sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-coal-700/70 pb-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="border border-coal-600 bg-coal-850 px-2 py-0.5 font-mono text-[9px] text-coal-200">
                    {serviceMeta(selected.service).icon} {serviceMeta(selected.service).label}
                  </span>
                  <span
                    className={cn(
                      "border px-2 py-0.5 font-mono text-[9px] font-bold",
                      (STATUS_DOTS[selected.status] ?? STATUS_DOTS.Geplant).cls
                    )}
                  >
                    {(STATUS_DOTS[selected.status] ?? STATUS_DOTS.Geplant).dot} {selected.status}
                  </span>
                </div>
                <h4 className="mt-2 truncate font-display text-base font-black text-paper-100 uppercase">
                  {selected.title}
                </h4>
                <p className="font-mono text-[10px] text-volt-300">
                  {formatDateTime(selected.scheduledAt).full}
                  {selected.channelName ? ` · ${selected.channelName}` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="border border-coal-600 p-2 text-coal-300 hover:border-volt-400"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-[170px_1fr]">
              <div className="overflow-hidden border border-coal-700 bg-black">
                {selected.videoUrl ? (
                  <video
                    src={selected.videoUrl}
                    controls
                    playsInline
                    className="w-full"
                    style={{ aspectRatio: "9 / 16" }}
                  />
                ) : (
                  <div
                    className="grid place-items-center bg-coal-850 text-coal-500"
                    style={{ aspectRatio: "9 / 16" }}
                  >
                    <Film className="size-7" />
                  </div>
                )}
              </div>

              <div className="grid content-start gap-3">
                <div>
                  <label className="mono-label mb-1 block text-[9px] text-coal-400">
                    CAPTION BEARBEITEN
                  </label>
                  <textarea
                    rows={3}
                    value={editCaption}
                    onChange={(e) => setEditCaption(e.target.value)}
                    className="w-full border border-coal-700 bg-coal-850 px-3 py-2 font-mono text-[11px] leading-relaxed text-paper-100 focus:border-volt-400 focus:outline-none"
                  />
                </div>

                {(selected.hashtags?.length ?? 0) > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {selected.hashtags!.map((t, i) => (
                      <span
                        key={i}
                        className="border border-coal-700 bg-coal-850 px-1.5 py-0.5 font-mono text-[9px] text-volt-300"
                      >
                        {t.startsWith("#") ? t : `#${t}`}
                      </span>
                    ))}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mono-label mb-1 block text-[9px] text-coal-400">DATUM</label>
                    <input
                      type="date"
                      value={editDate}
                      onChange={(e) => setEditDate(e.target.value)}
                      className="w-full border border-coal-700 bg-coal-850 px-2.5 py-1.5 font-mono text-[11px] text-paper-100 focus:border-volt-400 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mono-label mb-1 block text-[9px] text-coal-400">ZEIT</label>
                    <input
                      type="time"
                      value={editTime}
                      onChange={(e) => setEditTime(e.target.value)}
                      className="w-full border border-coal-700 bg-coal-850 px-2.5 py-1.5 font-mono text-[11px] text-paper-100 focus:border-volt-400 focus:outline-none"
                    />
                  </div>
                </div>

                {selected.status === "Fehler" && selected.errorMessage && (
                  <div className="border border-rose-err/50 bg-rose-err/10 px-3 py-2">
                    <p className="font-mono text-[10px] leading-relaxed text-rose-err">
                      {selected.errorMessage}
                    </p>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-coal-700/70 pt-3">
                  <button
                    type="button"
                    onClick={() => handleDelete(selected)}
                    disabled={busy}
                    className="flex items-center gap-1.5 border border-rose-err/60 bg-rose-err/10 px-3 py-2 font-mono text-[10px] font-bold text-rose-err hover:bg-rose-err hover:text-coal-950 disabled:opacity-40"
                  >
                    <Trash2 className="size-3.5" /> Löschen
                  </button>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleSaveEdits}
                      disabled={busy}
                      className="flex items-center gap-1.5 border border-coal-600 px-3 py-2 font-mono text-[10px] font-bold text-coal-200 hover:border-volt-400 hover:text-volt-300 disabled:opacity-40"
                    >
                      <Save className="size-3.5" /> Speichern
                    </button>
                    <button
                      type="button"
                      onClick={() => handlePublishNow(selected)}
                      disabled={busy}
                      className="bg-heat flex items-center gap-1.5 border border-volt-400 px-3 py-2 font-display text-[11px] font-black text-coal-950 uppercase disabled:opacity-40"
                    >
                      {busy ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Rocket className="size-3.5" />
                      )}
                      {selected.status === "Fehler" ? "Erneut versuchen" : "Jetzt posten"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {posts.length === 0 && (
        <div className="mt-3 border border-dashed border-coal-700 bg-coal-850/40 p-4">
          <p className="flex items-center justify-center gap-2 text-center font-mono text-[10px] text-coal-400">
            <Clock className="size-3.5" /> Noch keine geplanten Posts — Video rendern und auf „Post"
            tippen.
          </p>
        </div>
      )}
    </section>
  );
}

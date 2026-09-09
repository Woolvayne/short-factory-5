import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  BarChart3,
  Eye,
  Heart,
  Link2,
  Loader2,
  MessageCircle,
  RefreshCw,
  Share2,
  TrendingUp,
  Users,
} from "lucide-react";
import { cn } from "../utils/cn";
import {
  compactNumber,
  fetchAnalytics,
  serviceMeta,
  type AnalyticsTotals,
  type BufferChannel,
  type BufferPost,
} from "../lib/buffer";

const RANGES: { id: number; label: string }[] = [
  { id: 1, label: "Heute" },
  { id: 7, label: "7 Tage" },
  { id: 30, label: "30 Tage" },
  { id: 90, label: "90 Tage" },
];

type SortKey = "views" | "likes" | "comments" | "shares" | "engagement";

const SORTS: { id: SortKey; label: string }[] = [
  { id: "views", label: "Views" },
  { id: "likes", label: "Likes" },
  { id: "comments", label: "Kommentare" },
  { id: "shares", label: "Shares" },
  { id: "engagement", label: "Engagement" },
];

/* ------------------------------------------------------------------ */
/*  Dashboard stat cards                                               */
/* ------------------------------------------------------------------ */

export function DashboardStats({
  posts,
  totals,
  onCreate,
}: {
  posts: BufferPost[];
  totals: AnalyticsTotals | null;
  onCreate: () => void;
}) {
  const stats = useMemo(() => {
    const todayKey = new Date().toDateString();
    let today = 0;
    let planned = 0;
    let published = 0;
    for (const p of posts) {
      const d = new Date(p.scheduledAt);
      if (d.toDateString() === todayKey) today++;
      if (p.status === "Geplant" || p.status === "Wird verarbeitet") planned++;
      if (p.status === "Veröffentlicht") published++;
    }
    return { today, planned, published };
  }, [posts]);

  const cards = [
    { label: "HEUTE", value: String(stats.today), sub: "Posts", tone: "text-paper-100" },
    { label: "GEPLANT", value: String(stats.planned), sub: "in Queue", tone: "text-amber-warn" },
    { label: "VERÖFFENTLICHT", value: String(stats.published), sub: "gesamt", tone: "text-mint-400" },
    {
      label: "VIEWS",
      value: compactNumber(totals?.views ?? 0),
      sub: "im Zeitraum",
      tone: "text-volt-300",
    },
    {
      label: "ENGAGEMENT",
      value: `${(totals?.engagementRate ?? 0).toFixed(1)}%`,
      sub: "Ø Rate",
      tone: "text-volt-300",
    },
  ];

  return (
    <div className="card-bracket border border-coal-600 bg-coal-900/90 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-black tracking-tight text-paper-100 uppercase">
            Short Factory Dashboard
          </h2>
          <p className="font-mono text-[10px] text-coal-300">
            Video-Produktion, Buffer-Planung und Performance auf einen Blick
          </p>
        </div>
        <button
          type="button"
          onClick={onCreate}
          className="bg-heat flex min-h-[40px] items-center gap-2 border border-volt-400 px-4 py-2 font-display text-xs font-black tracking-wider text-coal-950 uppercase transition-opacity hover:opacity-90"
        >
          🎬 Video erstellen
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map((c) => (
          <div key={c.label} className="border border-coal-700/80 bg-coal-850/80 p-3">
            <span className="mono-label block text-[8.5px] text-coal-400">{c.label}</span>
            <span className={cn("mt-1 block font-display text-xl font-black", c.tone)}>
              {c.value}
            </span>
            <span className="font-mono text-[9px] text-coal-400">{c.sub}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Social accounts                                                    */
/* ------------------------------------------------------------------ */

export function SocialAccounts({
  channels,
  posts,
  hasApiKey,
  loading,
  error,
  onRefresh,
}: {
  channels: BufferChannel[];
  posts: BufferPost[];
  hasApiKey: boolean;
  loading: boolean;
  error?: string | null;
  onRefresh: () => void;
}) {
  const plannedByChannel = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of posts) {
      if (p.status === "Geplant" || p.status === "Wird verarbeitet") {
        map[p.channelId] = (map[p.channelId] || 0) + 1;
      }
    }
    return map;
  }, [posts]);

  return (
    <section className="card-bracket border border-coal-600 bg-coal-900/90 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-coal-700/70 pb-3">
        <div className="flex items-center gap-2.5">
          <Users className="size-4 text-volt-400" />
          <h3 className="font-display text-sm font-black tracking-wide text-paper-100 uppercase">
            Social Accounts
          </h3>
          <span className="font-mono text-[9.5px] text-coal-400">
            {channels.length} Kanäle über Buffer
          </span>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="flex min-h-[32px] items-center gap-1.5 border border-coal-600 px-2.5 py-1 font-mono text-[10px] font-bold tracking-widest text-coal-300 hover:border-volt-400 hover:text-volt-300 disabled:opacity-40"
        >
          {loading ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
          SYNC
        </button>
      </div>

      {!hasApiKey && (
        <div className="mt-3 flex items-start gap-2 border border-amber-warn/40 bg-amber-warn/10 px-3 py-2.5">
          <Link2 className="mt-0.5 size-4 shrink-0 text-amber-warn" />
          <p className="font-mono text-[10px] leading-relaxed text-coal-200">
            <strong className="text-amber-warn">BUFFER_API_KEY fehlt.</strong> Key unter
            publish.buffer.com/settings/api erzeugen und als Umgebungsvariable in Vercel setzen.
            Bis dahin funktioniert alles lokal weiter.
          </p>
        </div>
      )}

      {error && hasApiKey && (
        <div className="mt-3 border border-rose-err/50 bg-rose-err/10 px-3 py-2.5">
          <p className="font-mono text-[10px] text-rose-err">{error}</p>
        </div>
      )}

      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {channels.map((c) => {
          const meta = serviceMeta(c.service);
          return (
            <div
              key={c.id}
              className="flex items-center gap-3 border border-coal-700/80 bg-coal-850 p-2.5"
            >
              {c.avatar ? (
                <img
                  src={c.avatar}
                  alt=""
                  className="size-9 shrink-0 rounded-full border border-coal-600 object-cover"
                />
              ) : (
                <span className="grid size-9 shrink-0 place-items-center rounded-full border border-coal-600 bg-coal-900 text-base">
                  {meta.icon}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-xs font-bold text-paper-100">{c.name}</p>
                <p className="font-mono text-[9px] text-coal-400">
                  {meta.label}
                  {c.username ? ` · @${c.username}` : ""}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <span
                  className={cn(
                    "block font-mono text-[8.5px] font-bold",
                    c.connected ? "text-mint-400" : "text-rose-err"
                  )}
                >
                  {c.connected ? "● VERBUNDEN" : "○ GETRENNT"}
                </span>
                <span className="font-mono text-[9px] text-coal-300">
                  {plannedByChannel[c.id] || 0} geplant
                </span>
              </div>
            </div>
          );
        })}

        {channels.length === 0 && (
          <div className="border border-dashed border-coal-700 bg-coal-850/40 p-4 sm:col-span-2 xl:col-span-3">
            <p className="text-center font-mono text-[10px] text-coal-400">
              Noch keine Kanäle geladen. Nach dem Setzen des Keys auf SYNC tippen — TikTok,
              Instagram, YouTube, Facebook, X, LinkedIn, Pinterest, Threads und Bluesky erscheinen
              dann automatisch.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Analytics                                                          */
/* ------------------------------------------------------------------ */

export function AnalyticsPanel({
  onTotals,
}: {
  onTotals: (t: AnalyticsTotals | null) => void;
}) {
  const [days, setDays] = useState(30);
  const [sort, setSort] = useState<SortKey>("views");
  const [loading, setLoading] = useState(false);
  const [totals, setTotals] = useState<AnalyticsTotals | null>(null);
  const [posts, setPosts] = useState<BufferPost[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchAnalytics(days)
      .then((res) => {
        if (cancelled) return;
        setTotals(res.totals);
        setPosts(res.posts);
        setError(res.error ?? null);
        onTotals(res.totals);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [days, onTotals]);

  const sorted = useMemo(() => {
    const key = sort;
    return [...posts]
      .sort((a, b) => (Number(b[key]) || 0) - (Number(a[key]) || 0))
      .slice(0, 8);
  }, [posts, sort]);

  const worst = useMemo(() => {
    return [...posts]
      .filter((p) => (p.views ?? 0) > 0 || (p.likes ?? 0) > 0)
      .sort((a, b) => (Number(a[sort]) || 0) - (Number(b[sort]) || 0))
      .slice(0, 3);
  }, [posts, sort]);

  const maxVal = Math.max(1, ...sorted.map((p) => Number(p[sort]) || 0));

  const metricCards = [
    { icon: Eye, label: "VIEWS", value: compactNumber(totals?.views ?? 0) },
    { icon: BarChart3, label: "IMPRESSIONS", value: compactNumber(totals?.impressions ?? 0) },
    { icon: Users, label: "REACH", value: compactNumber(totals?.reach ?? 0) },
    { icon: Heart, label: "LIKES", value: compactNumber(totals?.likes ?? 0) },
    { icon: MessageCircle, label: "KOMMENTARE", value: compactNumber(totals?.comments ?? 0) },
    { icon: Share2, label: "SHARES", value: compactNumber(totals?.shares ?? 0) },
    { icon: Activity, label: "POSTS", value: String(totals?.posts ?? 0) },
    {
      icon: TrendingUp,
      label: "ENGAGEMENT",
      value: `${(totals?.engagementRate ?? 0).toFixed(1)}%`,
    },
  ];

  return (
    <section className="card-bracket border border-coal-600 bg-coal-900/90 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-coal-700/70 pb-3">
        <div className="flex items-center gap-2.5">
          <BarChart3 className="size-4 text-volt-400" />
          <h3 className="font-display text-sm font-black tracking-wide text-paper-100 uppercase">
            Analytics
          </h3>
          {loading && <Loader2 className="size-3.5 animate-spin text-coal-400" />}
        </div>
        <div className="flex flex-wrap gap-1">
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setDays(r.id)}
              className={cn(
                "border px-2.5 py-1 font-mono text-[9.5px] font-bold tracking-widest transition-colors",
                days === r.id
                  ? "bg-heat border-volt-400 text-coal-950"
                  : "border-coal-700 bg-coal-850 text-coal-300 hover:border-coal-500"
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mt-3 border border-amber-warn/40 bg-amber-warn/10 px-3 py-2">
          <p className="font-mono text-[10px] text-amber-warn">
            Analytics aktuell nicht verfügbar: {error}
          </p>
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {metricCards.map(({ icon: Icon, label, value }) => (
          <div key={label} className="border border-coal-700/80 bg-coal-850/80 p-2.5">
            <span className="flex items-center gap-1.5">
              <Icon className="size-3 text-volt-400" />
              <span className="mono-label text-[8px] text-coal-400">{label}</span>
            </span>
            <span className="mt-1 block font-display text-lg font-black text-paper-100">
              {value}
            </span>
          </div>
        ))}
      </div>

      {/* Top posts chart */}
      <div className="mt-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="mono-label text-[9px] text-volt-300">TOP POSTS</span>
          <div className="flex flex-wrap gap-1">
            {SORTS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSort(s.id)}
                className={cn(
                  "border px-2 py-0.5 font-mono text-[8.5px] font-bold tracking-wider transition-colors",
                  sort === s.id
                    ? "border-volt-400 bg-volt-400/15 text-volt-300"
                    : "border-coal-700 bg-coal-850 text-coal-400 hover:border-coal-500"
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {sorted.length === 0 ? (
          <div className="border border-dashed border-coal-700 bg-coal-850/40 p-4">
            <p className="text-center font-mono text-[10px] leading-relaxed text-coal-400">
              Noch keine veröffentlichten Posts mit Metriken. Sobald Buffer Kennzahlen liefert,
              erscheinen hier deine besten Videos.
            </p>
          </div>
        ) : (
          <div className="grid gap-1.5">
            {sorted.map((p, i) => {
              const val = Number(p[sort]) || 0;
              const meta = serviceMeta(p.service);
              return (
                <div key={p.id} className="border border-coal-700/70 bg-coal-850/70 p-2">
                  <div className="flex items-center gap-2">
                    <span className="w-5 shrink-0 font-mono text-[10px] font-bold text-volt-300">
                      #{i + 1}
                    </span>
                    <span className="shrink-0 text-sm">{meta.icon}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-coal-100">
                      {p.title || p.text.slice(0, 60)}
                    </span>
                    <span className="shrink-0 font-display text-xs font-black text-paper-100">
                      {sort === "engagement" ? `${val.toFixed(1)}%` : compactNumber(val)}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden bg-coal-800">
                    <div
                      className="bg-heat h-full transition-[width] duration-500"
                      style={{ width: `${Math.max(3, (val / maxVal) * 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {worst.length > 0 && (
          <div className="mt-3">
            <span className="mono-label mb-1.5 block text-[9px] text-coal-400">
              SCHWÄCHSTE POSTS
            </span>
            <div className="grid gap-1">
              {worst.map((p) => (
                <div
                  key={`w-${p.id}`}
                  className="flex items-center gap-2 border border-coal-700/50 bg-coal-850/40 px-2 py-1.5"
                >
                  <span className="shrink-0 text-xs">{serviceMeta(p.service).icon}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[9.5px] text-coal-300">
                    {p.title || p.text.slice(0, 50)}
                  </span>
                  <span className="shrink-0 font-mono text-[9.5px] text-coal-400">
                    {sort === "engagement"
                      ? `${(Number(p[sort]) || 0).toFixed(1)}%`
                      : compactNumber(Number(p[sort]) || 0)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

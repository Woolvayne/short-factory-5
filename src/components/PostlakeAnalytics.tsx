import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  BarChart3,
  Eye,
  Heart,
  Loader2,
  MessageCircle,
  MousePointerClick,
  Share2,
  Users,
} from "lucide-react";
import { cn } from "../utils/cn";
import {
  compactNumber,
  fetchAnalytics,
  serviceMeta,
  topPostsFromAnalytics,
  type AnalyticsPeriod,
  type LakeAnalytics,
  type LakePost,
} from "../lib/postlake";

const RANGES: { id: AnalyticsPeriod; label: string }[] = [
  { id: "7d", label: "7 Tage" },
  { id: "30d", label: "30 Tage" },
  { id: "90d", label: "90 Tage" },
];

type SortKey = "views" | "likes" | "comments" | "shares";

const SORTS: { id: SortKey; label: string }[] = [
  { id: "views", label: "Views" },
  { id: "likes", label: "Likes" },
  { id: "comments", label: "Kommentare" },
  { id: "shares", label: "Shares" },
];

export default function PostlakeAnalytics({ posts }: { posts: LakePost[] }) {
  const [period, setPeriod] = useState<AnalyticsPeriod>("30d");
  const [sort, setSort] = useState<SortKey>("views");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<LakeAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchAnalytics(period)
      .then((res) => {
        if (cancelled) return;
        setData(res.analytics);
        setError(res.error ?? null);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [period]);

  const tops = useMemo(() => topPostsFromAnalytics(data, posts, sort), [data, posts, sort]);
  const maxVal = Math.max(1, ...tops.map((t) => t.value));

  const cards = [
    { icon: Eye, label: "IMPRESSIONS", value: compactNumber(data?.impressions ?? 0) },
    { icon: Users, label: "REICHWEITE", value: compactNumber(data?.reach ?? 0) },
    { icon: Heart, label: "LIKES", value: compactNumber(data?.likes ?? 0) },
    { icon: MessageCircle, label: "KOMMENTARE", value: compactNumber(data?.comments ?? 0) },
    { icon: Share2, label: "SHARES", value: compactNumber(data?.shares ?? 0) },
    { icon: MousePointerClick, label: "KLICKS", value: compactNumber(data?.clicks ?? 0) },
    { icon: Activity, label: "POSTS", value: String(data?.posts ?? 0) },
    { icon: Users, label: "FOLLOWER", value: compactNumber(data?.followers ?? 0) },
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
          <span className="font-mono text-[9px] text-coal-500">via Postlake · kostenlos</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setPeriod(r.id)}
              className={cn(
                "border px-2.5 py-1 font-mono text-[9.5px] font-bold tracking-widest transition-colors",
                period === r.id
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
        {cards.map(({ icon: Icon, label, value }) => (
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

        {tops.length === 0 ? (
          <div className="border border-dashed border-coal-700 bg-coal-850/40 p-4">
            <p className="text-center font-mono text-[10px] leading-relaxed text-coal-400">
              Noch keine Post-Kennzahlen. Sobald Posts live sind und die Netzwerke Insights
              liefern, erscheinen hier deine besten Videos.
            </p>
          </div>
        ) : (
          <div className="grid gap-1.5">
            {tops.map((t, i) => (
              <div key={t.id} className="border border-coal-700/70 bg-coal-850/70 p-2">
                <div className="flex items-center gap-2">
                  <span className="w-5 shrink-0 font-mono text-[10px] font-bold text-volt-300">
                    #{i + 1}
                  </span>
                  <span className="flex shrink-0 gap-0.5 text-xs">
                    {t.platforms.slice(0, 3).map((p, j) => (
                      <span key={j}>{serviceMeta(p).icon}</span>
                    ))}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-coal-100">
                    {t.title}
                  </span>
                  <span className="shrink-0 font-display text-xs font-black text-paper-100">
                    {compactNumber(t.value)}
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden bg-coal-800">
                  <div
                    className="bg-heat h-full transition-[width] duration-500"
                    style={{ width: `${Math.max(3, (t.value / maxVal) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

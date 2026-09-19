import { useMemo } from "react";
import { cn } from "../utils/cn";
import { countPostsLastHour, type SocialPost } from "../lib/posts";

/* ------------------------------------------------------------------ */
/*  Dashboard-Kopfzeile                                                 */
/* ------------------------------------------------------------------ */

export default function DashboardStats({
  posts,
  hourLimit,
  onCreate,
}: {
  posts: SocialPost[];
  hourLimit: number;
  onCreate: () => void;
}) {
  const stats = useMemo(() => {
    const todayKey = new Date().toDateString();
    let today = 0;
    let planned = 0;
    let published = 0;
    let failed = 0;
    for (const p of posts) {
      if (new Date(p.scheduledAt).toDateString() === todayKey) today++;
      if (p.status === "Geplant" || p.status === "Wird veröffentlicht" || p.status === "Entwurf") planned++;
      if (p.status === "Veröffentlicht" || p.status === "Teils veröffentlicht") published++;
      if (p.status === "Fehler") failed++;
    }
    return { today, planned, published, failed, hour: countPostsLastHour(posts) };
  }, [posts]);

  const cards = [
    { label: "HEUTE", value: String(stats.today), sub: "Posts", tone: "text-paper-100" },
    { label: "GEPLANT", value: String(stats.planned), sub: "in Queue", tone: "text-amber-warn" },
    { label: "VERÖFFENTLICHT", value: String(stats.published), sub: "gesamt", tone: "text-mint-400" },
    {
      label: "DIESE STUNDE",
      value: `${stats.hour}/${hourLimit}`,
      sub: "Auto-Limit",
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
            Video-Produktion, Planung und Versand über Buffer auf einen Blick
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

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
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

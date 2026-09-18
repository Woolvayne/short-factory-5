import { useMemo } from "react";
import {
  Check,
  ExternalLink,
  Link2,
  Loader2,
  RefreshCw,
  Rocket,
  Send,
  TriangleAlert,
  Users,
} from "lucide-react";
import { cn } from "../utils/cn";
import {
  BUFFER_API_SETTINGS,
  BUFFER_DASHBOARD,
  type BufferStatus,
} from "../lib/buffer";
import {
  serviceMeta,
  type LakeAccount,
  type LakePost,
  type PostlakePrefs,
  type SocialPlatform,
} from "../lib/postlake";

const PLATFORM_LABEL: Record<SocialPlatform, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
};

export default function BufferAccounts({
  status,
  posts,
  loading,
  prefs,
  onPrefs,
  onRefresh,
}: {
  status: BufferStatus;
  posts: LakePost[];
  loading: boolean;
  prefs: PostlakePrefs;
  onPrefs: (p: PostlakePrefs) => void;
  onRefresh: () => void;
}) {
  const plannedByAccount = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of posts) {
      if (p.provider !== "buffer") continue;
      if (p.status === "Geplant" || p.status === "Wird veröffentlicht") {
        for (const a of p.accounts) map[a] = (map[a] || 0) + 1;
      }
    }
    return map;
  }, [posts]);

  const togglePlatform = (p: SocialPlatform) => {
    const has = prefs.platforms.includes(p);
    const next = has ? prefs.platforms.filter((x) => x !== p) : [...prefs.platforms, p];
    if (next.length === 0) return;
    onPrefs({ ...prefs, platforms: next });
  };

  const accountsFor = (p: SocialPlatform) =>
    status.accounts.filter((a) => a.platform === p);

  return (
    <section className="card-bracket border border-coal-600 bg-coal-900/90 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-coal-700/70 pb-3">
        <div className="flex items-center gap-2.5">
          <Users className="size-4 text-volt-400" />
          <h3 className="font-display text-sm font-black tracking-wide text-paper-100 uppercase">
            📦 Buffer Kanäle
          </h3>
          <span className="font-mono text-[9.5px] text-coal-400">
            {status.accounts.length} verbunden
          </span>
        </div>
        <div className="flex items-center gap-2">
          {status.organizations.length > 0 && (
            <span
              className="hidden border border-coal-600 bg-coal-850 px-2.5 py-1 font-mono text-[10px] text-coal-200 sm:block"
              title="Buffer-Workspace"
            >
              {status.organizations[0].name}
            </span>
          )}
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
      </div>

      {!status.hasApiKey && (
        <div className="mt-3 flex items-start gap-2 border border-amber-warn/40 bg-amber-warn/10 px-3 py-2.5">
          <Link2 className="mt-0.5 size-4 shrink-0 text-amber-warn" />
          <p className="font-mono text-[10px] leading-relaxed text-coal-200">
            <strong className="text-amber-warn">BUFFER_API_KEY fehlt.</strong> Key unter{" "}
            <a
              href={BUFFER_API_SETTINGS}
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-amber-warn"
            >
              publish.buffer.com → Settings → API
            </a>{" "}
            erzeugen und als Umgebungsvariable in Vercel setzen. Bis dahin läuft alles lokal
            weiter.
          </p>
        </div>
      )}

      {status.hasApiKey && status.apiStatus === "invalid_key" && (
        <div className="mt-3 flex items-start gap-2 border border-rose-err/50 bg-rose-err/10 px-3 py-2.5">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-rose-err" />
          <p className="font-mono text-[10px] leading-relaxed text-rose-err">
            Buffer lehnt den Key ab: {status.keyError || "ungültig"}. Neuen Key erzeugen und
            als BUFFER_API_KEY setzen.
          </p>
        </div>
      )}

      {status.hasApiKey && status.apiStatus === "unreachable" && (
        <div className="mt-3 border border-amber-warn/40 bg-amber-warn/10 px-3 py-2">
          <p className="font-mono text-[10px] text-amber-warn">
            Buffer gerade nicht erreichbar — lokale Ansicht, Sync später erneut versuchen.
          </p>
        </div>
      )}

      {/* Kanäle */}
      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {status.accounts.map((c: LakeAccount) => {
          const meta = serviceMeta(c.platform);
          const connected = c.status !== "disconnected";
          return (
            <div
              key={c.id}
              className="flex items-center gap-3 border border-coal-700/80 bg-coal-850 p-2.5"
            >
              {c.avatarUrl ? (
                <img
                  src={c.avatarUrl}
                  alt=""
                  className="size-9 shrink-0 rounded-full border border-coal-600 object-cover"
                />
              ) : (
                <span className="grid size-9 shrink-0 place-items-center rounded-full border border-coal-600 bg-coal-900 text-base">
                  {meta.icon}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-xs font-bold text-paper-100">
                  {c.name || meta.label}
                </p>
                <p className="truncate font-mono text-[9px] text-coal-400">
                  {meta.label}
                  {c.handle ? ` · @${c.handle}` : ""}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <span
                  className={cn(
                    "block font-mono text-[8.5px] font-bold",
                    connected ? "text-mint-400" : "text-rose-err"
                  )}
                >
                  {connected ? "● VERBUNDEN" : "○ GETRENNT"}
                </span>
                <span className="font-mono text-[9px] text-coal-300">
                  {plannedByAccount[c.id] || 0} geplant
                </span>
              </div>
            </div>
          );
        })}

        {status.accounts.length === 0 && (
          <div className="border border-dashed border-coal-700 bg-coal-850/40 p-4 sm:col-span-2 xl:col-span-3">
            <p className="text-center font-mono text-[10px] leading-relaxed text-coal-400">
              Noch keine Kanäle verbunden. Kanäle werden in Buffer verbunden — danach hier auf
              SYNC tippen.{" "}
              <a
                href={BUFFER_DASHBOARD}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-volt-300 underline hover:text-volt-400"
              >
                Kanäle verbinden <ExternalLink className="size-3" />
              </a>
            </p>
            <p className="mt-2 text-center font-mono text-[9px] leading-relaxed text-coal-500">
              Hinweis: Free-Plan = 3 Kanäle, 10 geplante Posts pro Kanal. Videos brauchen
              öffentliches Hosting — die App nutzt dafür automatisch den Supabase-Bucket.
            </p>
          </div>
        )}
      </div>

      {/* Posting-Voreinstellungen (geteilt mit Postlake, nur Kanal-Mapping ist Buffer-eigen) */}
      <div className="mt-4 border-t border-coal-700/70 pt-4">
        <span className="mono-label mb-2 block text-[9px] text-coal-400">
          POST ALL · VOREINSTELLUNGEN (GETEILT MIT POSTLAKE)
        </span>

        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => onPrefs({ ...prefs, mode: "now" })}
            className={cn(
              "flex items-center gap-2 border px-3 py-2.5 text-left transition-colors",
              prefs.mode === "now"
                ? "border-volt-400 bg-volt-400/15"
                : "border-coal-700 bg-coal-850 hover:border-coal-500"
            )}
          >
            <Rocket
              className={cn("size-4 shrink-0", prefs.mode === "now" ? "text-volt-300" : "text-coal-400")}
            />
            <span>
              <span className="block font-display text-[11px] font-bold text-paper-100">
                Sofort posten
              </span>
              <span className="block font-mono text-[8.5px] text-coal-400">live nach Upload</span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => onPrefs({ ...prefs, mode: "scheduled" })}
            className={cn(
              "flex items-center gap-2 border px-3 py-2.5 text-left transition-colors",
              prefs.mode === "scheduled"
                ? "border-volt-400 bg-volt-400/15"
                : "border-coal-700 bg-coal-850 hover:border-coal-500"
            )}
          >
            <Send
              className={cn(
                "size-4 shrink-0",
                prefs.mode === "scheduled" ? "text-volt-300" : "text-coal-400"
              )}
            />
            <span>
              <span className="block font-display text-[11px] font-bold text-paper-100">
                Slots planen
              </span>
              <span className="block font-mono text-[8.5px] text-coal-400">
                {prefs.preferredTimes.join(" & ")} · Berlin
              </span>
            </span>
          </button>
        </div>

        <div className="mt-2 grid gap-2">
          {(Object.keys(PLATFORM_LABEL) as SocialPlatform[]).map((p) => {
            const active = prefs.platforms.includes(p);
            const list = accountsFor(p);
            return (
              <div
                key={p}
                className={cn(
                  "flex flex-wrap items-center gap-2 border px-2.5 py-2",
                  active ? "border-coal-600 bg-coal-850" : "border-coal-700/60 bg-coal-850/40"
                )}
              >
                <button
                  type="button"
                  onClick={() => togglePlatform(p)}
                  className="flex items-center gap-2"
                >
                  <span
                    className={cn(
                      "grid size-4 place-items-center rounded-full border",
                      active ? "border-volt-400 bg-volt-400 text-coal-950" : "border-coal-600"
                    )}
                  >
                    {active && <Check className="size-2.5" strokeWidth={3.5} />}
                  </span>
                  <span className="text-sm">{serviceMeta(p).icon}</span>
                  <span
                    className={cn(
                      "font-display text-[11px] font-bold",
                      active ? "text-paper-100" : "text-coal-500"
                    )}
                  >
                    {PLATFORM_LABEL[p]}
                  </span>
                </button>
                <select
                  value={prefs.bufferAccountIds[p] || ""}
                  onChange={(e) =>
                    onPrefs({
                      ...prefs,
                      bufferAccountIds: { ...prefs.bufferAccountIds, [p]: e.target.value },
                    })
                  }
                  disabled={!active}
                  className="ml-auto min-w-0 flex-1 border border-coal-700 bg-coal-900 px-2 py-1.5 font-mono text-[10px] text-paper-100 focus:border-volt-400 focus:outline-none disabled:opacity-40 sm:max-w-[220px]"
                >
                  <option value="" className="bg-coal-900">
                    {list.length > 0 ? `Auto (${list[0].handle || list[0].name || list[0].id})` : "— kein Kanal —"}
                  </option>
                  {list.map((a) => (
                    <option key={a.id} value={a.id} className="bg-coal-900">
                      @{a.handle || a.name || a.id}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>

        <div className="mt-2 grid gap-2">
          <div>
            <label className="mono-label mb-1 block text-[9px] text-coal-400">CAPTION (GETEILT)</label>
            <textarea
              rows={2}
              value={prefs.caption}
              onChange={(e) => onPrefs({ ...prefs, caption: e.target.value })}
              className="w-full border border-coal-700 bg-coal-850 px-3 py-2 font-mono text-[11px] leading-relaxed text-paper-100 focus:border-volt-400 focus:outline-none"
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className="mono-label mb-1 block text-[9px] text-coal-400">HASHTAGS (GETEILT)</label>
              <input
                type="text"
                value={prefs.hashtags}
                onChange={(e) => onPrefs({ ...prefs, hashtags: e.target.value })}
                className="w-full border border-coal-700 bg-coal-850 px-3 py-2 font-mono text-[11px] text-paper-100 focus:border-volt-400 focus:outline-none"
              />
            </div>
            <div>
              <label className="mono-label mb-1 block text-[9px] text-coal-400">
                PLAN-ZEITEN (BEI „SLOTS PLANEN")
              </label>
              <input
                type="text"
                value={prefs.preferredTimes.join(", ")}
                onChange={(e) =>
                  onPrefs({
                    ...prefs,
                    preferredTimes: e.target.value
                      .split(/[,;\s]+/)
                      .map((t) => t.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="06:00, 20:00"
                className="w-full border border-coal-700 bg-coal-850 px-3 py-2 font-mono text-[11px] text-paper-100 focus:border-volt-400 focus:outline-none"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

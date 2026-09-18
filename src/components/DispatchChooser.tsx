import { useEffect } from "react";
import { Package, Send, Waves, X } from "lucide-react";
import { cn } from "../utils/cn";
import { PROVIDER_META, type DispatchProvider } from "../lib/dispatch";

export interface ProviderReadiness {
  hasKey: boolean;
  connected: boolean;
  channels: number;
  detail: string;
}

export default function DispatchChooser({
  open,
  title,
  subtitle,
  postlake,
  buffer,
  defaultProvider,
  onPick,
  onClose,
}: {
  open: boolean;
  title: string;
  subtitle: string;
  postlake: ProviderReadiness;
  buffer: ProviderReadiness;
  defaultProvider: DispatchProvider;
  onPick: (p: DispatchProvider) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const cards: { id: DispatchProvider; ready: ProviderReadiness }[] = [
    { id: "postlake", ready: postlake },
    { id: "buffer", ready: buffer },
  ];

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-coal-950/90 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Versandweg wählen"
    >
      <div
        className="card-bracket my-8 w-full max-w-lg animate-rise border border-coal-600 bg-coal-900 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-coal-700/70 pb-3">
          <div>
            <h3 className="flex items-center gap-2 font-display text-base font-black tracking-wide text-paper-100 uppercase">
              <Send className="size-4 text-volt-400" /> {title}
            </h3>
            <p className="mt-1 font-mono text-[10px] text-coal-300">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="border border-coal-600 p-1.5 text-coal-300 hover:border-volt-400 hover:text-volt-300"
            aria-label="Schließen"
          >
            <X className="size-4" />
          </button>
        </div>

        <p className="mono-label mt-4 mb-2 text-[9px] text-coal-400">
          WORÜBER POSTEN? (1 KLICK)
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {cards.map(({ id, ready }) => {
            const meta = PROVIDER_META[id];
            const isDefault = defaultProvider === id;
            const Icon = id === "postlake" ? Waves : Package;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onPick(id)}
                className={cn(
                  "group relative border p-4 text-left transition-all",
                  isDefault
                    ? "border-volt-400 bg-volt-400/10 hover:bg-volt-400/15"
                    : "border-coal-600 bg-coal-850 hover:border-volt-400"
                )}
              >
                {isDefault && (
                  <span className="bg-heat absolute -top-2 right-3 px-1.5 py-px font-mono text-[8px] font-bold text-coal-950">
                    ZULETZT
                  </span>
                )}
                <Icon
                  className={cn(
                    "size-6",
                    isDefault ? "text-volt-300" : "text-coal-300 group-hover:text-volt-300"
                  )}
                />
                <span className="mt-2 block font-display text-lg font-black text-paper-100 uppercase">
                  {meta.icon} {meta.label}
                </span>
                <span
                  className={cn(
                    "mt-1 block font-mono text-[9.5px] font-bold",
                    ready.connected ? "text-mint-400" : ready.hasKey ? "text-amber-warn" : "text-coal-400"
                  )}
                >
                  {ready.connected
                    ? `● ${ready.channels} KANAL/KANÄLE BEREIT`
                    : ready.hasKey
                      ? "○ KEY OK · KEIN KANAL"
                      : "○ KEY FEHLT · LOKAL"}
                </span>
                <span className="mt-1 block font-mono text-[9px] leading-relaxed text-coal-400">
                  {ready.detail}
                </span>
              </button>
            );
          })}
        </div>

        <p className="mt-3 font-mono text-[9px] leading-relaxed text-coal-500">
          Ohne Key wird lokal zwischengespeichert (Kalender) — nichts geht verloren. Buffer lädt
          Videos vorab ins Supabase-Hosting hoch (öffentliche URL, Pflicht laut Buffer-Docs).
        </p>

        <div className="mt-4 flex justify-end border-t border-coal-700/70 pt-3">
          <button
            type="button"
            onClick={onClose}
            className="border border-coal-600 px-3.5 py-2 font-mono text-[10px] font-bold text-coal-200 hover:border-volt-400"
          >
            Abbrechen
          </button>
        </div>
      </div>
    </div>
  );
}

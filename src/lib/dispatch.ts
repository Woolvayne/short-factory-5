/**
 * Dispatch-Provider: Posten läuft wahlweise über Postlake ODER Buffer.
 *
 * Beim Klick auf POST / POST ALL öffnet sich eine Auswahl (DispatchChooser).
 * Die letzte Wahl wird gespeichert und beim nächsten Mal vorausgewählt.
 * Der Autopilot nutzt den in seiner Config gespeicherten Provider (kein
 * Nachfragen im Auto-Modus).
 */

export type DispatchProvider = "postlake" | "buffer";

const KEY = "shortsfactory.dispatch_provider.v1";

export const PROVIDER_META: Record<
  DispatchProvider,
  { label: string; short: string; icon: string; dashboard: string }
> = {
  postlake: {
    label: "Postlake",
    short: "POSTLAKE",
    icon: "🌊",
    dashboard: "https://app.postlake.dev/app",
  },
  buffer: {
    label: "Buffer",
    short: "BUFFER",
    icon: "📦",
    dashboard: "https://publish.buffer.com",
  },
};

export function loadDispatchProvider(): DispatchProvider {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === "buffer" ? "buffer" : "postlake";
  } catch {
    return "postlake";
  }
}

export function saveDispatchProvider(p: DispatchProvider): void {
  try {
    localStorage.setItem(KEY, p);
  } catch {
    /* private mode */
  }
}

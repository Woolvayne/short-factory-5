/**
 * Zugangsschutz (Gate) — Client-Seite.
 *
 * Das Passwort lebt ausschließlich auf dem Server (Vercel → Environment
 * Variables → APP_PASSWORD) und wird serverseitig geprüft — der Client
 * sieht es nie. Diese Bibliothek fragt nur den STATUS ab und entsperren:
 *
 *   GET    /api/gate → { enabled, unlocked }   (beim App-Start)
 *   POST   /api/gate → Passwort prüfen, setzt HttpOnly-Session-Cookie
 *   DELETE /api/gate → wieder sperren
 *
 * Wichtig: Ist die Variable NICHT gesetzt, liefert der Server
 * `enabled: false` — die App fragt dann bewusst NICHT nach einem Passwort
 * (die UI zeigt stattdessen nur einen Verweis auf die Variable). Gelingt
 * der Status-Call gar nicht (z. B. lokaler `npm run dev` ohne API-Route
 * oder offline), schalten wir ebenfalls offen — die App muss immer laufen.
 */

export interface GateInfo {
  /** APP_PASSWORD ist serverseitig gesetzt → Passwort wird verlangt. */
  enabled: boolean;
  /** Gültige Session vorhanden (nur relevant, wenn enabled). */
  unlocked: boolean;
  /** Session-Dauer in Stunden (Anzeige), falls gemeldet. */
  ttlHours: number | null;
  /** Der Gate-Endpoint war überhaupt erreichbar. */
  reachable: boolean;
}

const GENERIC_ERROR = "Gate nicht erreichbar — bitte erneut versuchen.";

export async function checkGate(): Promise<GateInfo> {
  try {
    const res = await fetch("/api/gate", { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as {
      enabled?: boolean;
      unlocked?: boolean;
      ttlHours?: number;
    };
    return {
      enabled: Boolean(data?.enabled),
      unlocked: data?.unlocked !== false,
      ttlHours: typeof data?.ttlHours === "number" ? data.ttlHours : null,
      reachable: true,
    };
  } catch {
    // Fail-open: ohne Endpoint (lokal/legacy-Deployment) läuft die App weiter.
    return { enabled: false, unlocked: true, ttlHours: null, reachable: false };
  }
}

export interface UnlockResult {
  ok: boolean;
  error?: string;
  ttlHours?: number | null;
}

export async function unlockGate(password: string): Promise<UnlockResult> {
  if (password.length === 0) return { ok: false, error: "Bitte Passwort eingeben." };
  try {
    const res = await fetch("/api/gate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const data = (await res.json().catch(() => null)) as
      | { ok?: boolean; enabled?: boolean; error?: string; ttlHours?: number }
      | null;
    if (res.ok && data?.ok) {
      // enabled=false → Server hat gar kein Passwort gesetzt: nichts zu tun.
      return { ok: true, ttlHours: typeof data?.ttlHours === "number" ? data.ttlHours : null };
    }
    return {
      ok: false,
      error:
        typeof data?.error === "string"
          ? data.error
          : `Entsperren fehlgeschlagen (HTTP ${res.status}).`,
    };
  } catch {
    return { ok: false, error: GENERIC_ERROR };
  }
}

/** Wieder sperren (löscht die Session serverseitig). */
export async function lockGate(): Promise<boolean> {
  try {
    const res = await fetch("/api/gate", { method: "DELETE" });
    return res.ok;
  } catch {
    return false;
  }
}

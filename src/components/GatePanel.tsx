import { useEffect, useRef, useState } from "react";
import { Factory, KeyRound, Lock, ShieldCheck, ShieldOff } from "lucide-react";
import { cn } from "../utils/cn";
import { checkGate, lockGate, unlockGate } from "../lib/gate";

/* ================================================================== */
/*  GateBoot — kleiner Splash, während der Gate-Status geprüft wird     */
/* ================================================================== */

export function GateBoot() {
  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden bg-coal-950">
      <div className="bg-blueprint pointer-events-none absolute inset-x-0 top-0 h-[420px]" />
      <div className="relative flex flex-col items-center gap-4">
        <div className="bg-heat grid size-12 place-items-center text-coal-950 shadow-[0_0_28px_-4px_var(--color-ember-500)]">
          <Factory className="size-6" strokeWidth={2.2} />
        </div>
        <div className="font-display text-lg font-black tracking-tight">
          SHORTS<span className="text-heat">FACTORY</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block size-1.5 animate-led rounded-full bg-volt-400 text-volt-400" />
          <span className="mono-label text-[9px] text-coal-400">PRÜFE ZUGANG …</span>
        </div>
        <div className="belt h-1.5 w-44 opacity-70" />
      </div>
    </div>
  );
}

/* ================================================================== */
/*  GatePanel — der Lock-Screen (nur wenn APP_PASSWORD gesetzt ist)     */
/* ================================================================== */

export default function GatePanel({ onUnlocked }: { onUnlocked: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failCount, setFailCount] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async () => {
    if (busy || password.length === 0) return;
    setBusy(true);
    setError(null);
    const res = await unlockGate(password);
    setBusy(false);
    if (res.ok) {
      setPassword("");
      onUnlocked();
      return;
    }
    setFailCount((n) => n + 1);
    setError(res.error ?? "Falsches Passwort.");
    setPassword("");
    inputRef.current?.focus();
  };

  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden bg-coal-950 px-4">
      <div className="bg-blueprint pointer-events-none absolute inset-x-0 top-0 h-[560px]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[620px] overflow-hidden">
        <div className="h-14 w-full animate-scan bg-gradient-to-b from-transparent via-ember-500/[0.10] to-transparent" />
      </div>
      <div className="animate-pulse-heat pointer-events-none absolute -top-40 left-1/2 h-[420px] w-[820px] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(239,47,36,0.18),transparent_68%)] blur-2xl" />

      <div className="animate-rise relative w-full max-w-[420px]">
        <div className="card-bracket border border-coal-700 px-7 py-8">
          {/* Kopf */}
          <div className="flex items-center gap-3.5">
            <div className="bg-heat grid size-11 shrink-0 place-items-center text-coal-950 shadow-[0_0_24px_-4px_var(--color-ember-500)]">
              <Lock className="size-5" strokeWidth={2.2} />
            </div>
            <div className="min-w-0 leading-none">
              <div className="truncate font-display text-[17px] font-black tracking-tight">
                SHORTS<span className="text-heat">FACTORY</span>
              </div>
              <div className="mono-label mt-1.5 flex items-center gap-1.5 text-[9px] text-ember-400">
                <span className="inline-block size-1.5 animate-led rounded-full bg-ember-500 text-ember-500" />
                ZUGANG GESPERRT
              </div>
            </div>
          </div>

          <p className="mt-5 text-[13px] leading-relaxed text-coal-300">
            Diese Factory ist passwortgeschützt. Bitte Zugangs-Passwort eingeben, um fortzufahren.
          </p>

          {/* Eingabe */}
          <div
            key={failCount} // remount → Shake-Animation bei jedem Fehlversuch
            className={cn(
              "mt-5 flex items-stretch border border-coal-700 bg-coal-900/80 transition-colors focus-within:border-volt-400",
              failCount > 0 && "animate-shake"
            )}
          >
            <div className="grid place-items-center border-r border-coal-700 px-3">
              <KeyRound className="size-3.5 text-coal-400" />
            </div>
            <input
              ref={inputRef}
              type="password"
              value={password}
              disabled={busy}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
              placeholder="PASSWORT"
              autoComplete="current-password"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent px-3 py-3 font-mono text-[13px] tracking-widest text-paper-100 placeholder:text-coal-500 focus:outline-none disabled:opacity-50"
            />
          </div>

          {error && (
            <p className="mono-label mt-2.5 text-[9.5px] leading-relaxed text-rose-err" role="alert">
              {error}
              {failCount > 1 && ` (${failCount} VERSUCHE)`}
            </p>
          )}

          {/* Entsperren */}
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || password.length === 0}
            className="bg-heat mt-5 flex w-full items-center justify-center gap-2 px-4 py-3 font-mono text-[11px] font-bold tracking-[0.2em] text-coal-950 transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <ShieldCheck className="size-4" strokeWidth={2.4} />
            {busy ? "PRÜFE …" : "ENTSPERREN"}
          </button>

          {/* Verweis: wo das Passwort hingehört */}
          <div className="mt-6 border-t border-coal-700/60 pt-4">
            <p className="mono-label text-[8.5px] leading-relaxed text-coal-500">
              PASSWORT STEHT NUR AUF DEM SERVER:
              <br />
              <span className="text-coal-400">
                VERCEL → PROJECT → SETTINGS → ENVIRONMENT VARIABLES →{" "}
                <span className="text-volt-400">APP_PASSWORD</span>
              </span>
            </p>
          </div>
        </div>

        <p className="mono-label mt-4 text-center text-[8.5px] text-coal-500">
          SESSION BLEIBT CA. 7 TAGE GÜLTIG · BEI PASSWORTWECHSEL WERDEN ALLE SESSIONS NEU GESTELLT
        </p>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  GateBanner — Status-Zeile unter dem Hero                            */
/*                                                                      */
/*  OHNE gesetzte Variable: dezenten Verweis zeigen (wo man das         */
/*  Passwort in Vercel hinterlegt) — gefragt wird dann NICHT.           */
/*  MIT gesetzter Variable: Status + „Sperren"-Knopf.                   */
/* ================================================================== */

export function GateBanner({
  enabled,
  checking,
  onLocked,
}: {
  enabled: boolean;
  checking: boolean;
  onLocked: () => void;
}) {
  const [locking, setLocking] = useState(false);

  if (checking) return null;

  if (!enabled) {
    return (
      <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2 border border-volt-400/35 bg-volt-500/[0.06] px-4 py-3">
        <KeyRound className="size-4 shrink-0 text-volt-400" />
        <p className="mono-label min-w-0 flex-1 text-[9px] leading-relaxed text-volt-300">
          PASSWORT-SCHUTZ AUS — DIESE APP IST DERZEIT FÜR JEDEN OFFEN. SETZE{" "}
          <span className="text-volt-400">APP_PASSWORD</span> IN VERCEL (PROJECT → SETTINGS →
          ENVIRONMENT VARIABLES) UND DEPLOYE NEU — DANN FRAGT DIE APP BEIM START NACH DEINEM
          PASSWORT.
        </p>
        <a
          href="https://vercel.com/docs/environment-variables"
          target="_blank"
          rel="noreferrer"
          className="shrink-0 border border-volt-400/50 px-2.5 py-1.5 font-mono text-[9px] font-bold tracking-widest text-volt-300 transition-colors hover:border-volt-400 hover:text-volt-400"
        >
          VERCEL-DOC ↗
        </a>
      </div>
    );
  }

  return (
    <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2 border border-ember-500/40 bg-ember-500/[0.06] px-4 py-3">
      <ShieldCheck className="size-4 shrink-0 text-ember-400" />
        <p className="mono-label min-w-0 flex-1 text-[9px] leading-relaxed text-ember-400">
          PASSWORT-SCHUTZ AKTIV — ENTSPERRT FÜR DIESE BROWSER-SESSION (CA. 7 TAGE). SPERREN PER
          KNOPF ODER AUTOMATISCH NACH ABLAUF.
        </p>
      <button
        type="button"
        disabled={locking}
        onClick={async () => {
          setLocking(true);
          const ok = await lockGate();
          setLocking(false);
          if (ok) onLocked();
        }}
        className="flex shrink-0 items-center gap-1.5 border border-coal-600 px-2.5 py-1.5 font-mono text-[9px] font-bold tracking-widest text-coal-300 transition-colors hover:border-ember-500 hover:text-ember-400 disabled:opacity-40"
      >
        <ShieldOff className="size-3.5" /> {locking ? "SPERRE …" : "SPERREN"}
      </button>
    </div>
  );
}

/* ================================================================== */
/*  useGate — Status beim Start laden + Umschalten                      */
/* ================================================================== */

export type GateStatus = "checking" | "locked" | "open";

export function useGate() {
  const [status, setStatus] = useState<GateStatus>("checking");
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let live = true;
    void checkGate().then((info) => {
      if (!live) return;
      setEnabled(info.enabled);
      setStatus(info.enabled && !info.unlocked ? "locked" : "open");
    });
    return () => {
      live = false;
    };
  }, []);

  return {
    status,
    enabled,
    checking: status === "checking",
    locked: status === "locked",
    open: status === "open",
    unlock: () => {
      setEnabled(true);
      setStatus("open");
    },
    lock: () => setStatus("locked"),
  };
}

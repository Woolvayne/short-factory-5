import type { ReactNode } from "react";
import { cn } from "../utils/cn";

export default function Section({
  index,
  title,
  hint,
  complete,
  active,
  children,
  aside,
}: {
  index: string;
  title: string;
  hint?: string;
  complete?: boolean;
  active?: boolean;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section
      className={cn(
        "card-bracket relative border bg-coal-900/80 transition-colors duration-300",
        active ? "border-volt-400/50" : complete ? "border-coal-600" : "border-coal-700/80"
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-coal-700/70 px-4 py-3 sm:px-5">
        <div className="flex items-baseline gap-3">
          <span
            className={cn(
              "font-mono text-[11px] font-bold tracking-widest",
              complete ? "text-volt-400" : "text-coal-400"
            )}
          >
            {index}
          </span>
          <h2 className="font-display text-sm font-black tracking-[0.08em] uppercase">
            {title}
          </h2>
          <span
            className={cn(
              "inline-block size-1.5 rounded-full",
              complete ? "bg-volt-400 animate-led text-volt-400" : "bg-coal-600"
            )}
          />
        </div>
        <div className="flex items-center gap-3">
          {hint && <span className="mono-label hidden text-[9px] text-coal-400 sm:block">{hint}</span>}
          {aside}
        </div>
      </header>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

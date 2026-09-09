import type { ReactNode } from "react";
import { cn } from "../utils/cn";

export function Field({
  label,
  value,
  children,
  hint,
}: {
  label: string;
  value?: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="mono-label text-[9px] text-coal-400">{label}</span>
        {value && (
          <span className="font-mono text-[10px] font-bold text-volt-300 tabular-nums">{value}</span>
        )}
      </div>
      {children}
      {hint && (
        <p className="mt-1 font-mono text-[8.5px] leading-relaxed tracking-wider text-coal-500">
          {hint}
        </p>
      )}
    </div>
  );
}

export function Slider({
  min,
  max,
  step,
  value,
  onChange,
  disabled,
}: {
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
      className="sf-range h-6 w-full cursor-pointer bg-transparent disabled:opacity-40"
      style={{ ["--pct" as string]: `${pct}%` }}
    />
  );
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  disabled,
  columns,
}: {
  options: { id: T; label: string; sub?: string }[];
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
  columns?: number;
}) {
  return (
    <div
      className="grid gap-1.5"
      style={{ gridTemplateColumns: `repeat(${columns ?? options.length}, minmax(0,1fr))` }}
    >
      {options.map((o) => (
        <button
          key={String(o.id)}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o.id)}
          className={cn(
            "min-h-[38px] border px-2 py-1.5 text-left transition-colors disabled:opacity-40",
            value === o.id
              ? "border-volt-400 bg-volt-400/10"
              : "border-coal-700/80 bg-coal-850 hover:border-coal-500"
          )}
        >
          <span
            className={cn(
              "block font-mono text-[10px] font-bold tracking-widest",
              value === o.id ? "text-volt-300" : "text-coal-200"
            )}
          >
            {o.label}
          </span>
          {o.sub && (
            <span className="mt-0.5 block font-mono text-[8px] leading-tight text-coal-400">
              {o.sub}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
  disabled,
  sub,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  sub?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex min-h-[44px] w-full items-center justify-between gap-3 border px-3 py-2 text-left transition-colors disabled:opacity-40",
        checked ? "border-volt-400/60 bg-volt-400/5" : "border-coal-700/80 bg-coal-850"
      )}
    >
      <span className="min-w-0">
        <span
          className={cn(
            "block font-mono text-[10px] font-bold tracking-widest",
            checked ? "text-volt-300" : "text-coal-300"
          )}
        >
          {label}
        </span>
        {sub && (
          <span className="mt-0.5 block font-mono text-[8.5px] leading-tight text-coal-500">
            {sub}
          </span>
        )}
      </span>
      <span
        className={cn(
          "relative h-5 w-9 shrink-0 border transition-colors",
          checked ? "border-volt-400 bg-volt-400/30" : "border-coal-600 bg-coal-800"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-3.5 transition-all",
            checked ? "left-[18px] bg-volt-400" : "left-0.5 bg-coal-500"
          )}
        />
      </span>
    </button>
  );
}

export function ColorSwatches({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const colors = ["#ffffff", "#d9ff3f", "#3fe8a4", "#ffb020", "#ff5470", "#7cc4ff"];
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {colors.map((c) => (
        <button
          key={c}
          type="button"
          disabled={disabled}
          onClick={() => onChange(c)}
          aria-label={`Caption colour ${c}`}
          className={cn(
            "size-8 border-2 transition-transform disabled:opacity-40",
            value.toLowerCase() === c ? "border-volt-400 scale-110" : "border-coal-600"
          )}
          style={{ backgroundColor: c }}
        />
      ))}
      <label className="relative size-8 cursor-pointer border-2 border-coal-600">
        <span
          className="absolute inset-0"
          style={{
            background:
              "conic-gradient(#ff5470,#ffb020,#d9ff3f,#3fe8a4,#7cc4ff,#b478ff,#ff5470)",
          }}
        />
        <input
          type="color"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0"
          style={{ display: "block" }}
        />
      </label>
    </div>
  );
}

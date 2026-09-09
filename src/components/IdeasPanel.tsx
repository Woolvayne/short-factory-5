import { Dices, Loader2, Sparkles, Type, Wand2 } from "lucide-react";
import Section from "./Section";
import { cn } from "../utils/cn";

export const SAMPLE_IDEAS = [
  "My roommate kept eating my labeled food, so I started meal-prepping ghost-pepper chili",
  "I found out my landlord has been living secretly in the attic for eight months",
  "My boss rejected my vacation request, then posted photos from my destination a week later",
  "AITA for uninviting my sister from my wedding after she announced her engagement at my rehearsal dinner",
  "I discovered my neighbor trains pigeons to deliver snacks to his window every afternoon",
  "My coworker microwaves fish daily, so the office started a passive-aggressive note war",
  "I accidentally liked my ex's post from 2019 and then made it a thousand times worse",
  "My gym buddy only trains one arm, and after two years I finally asked him why",
  "I fake-quit as a joke in a meeting and HR called my bluff within the hour",
  "My grandma has been speedrunning my favorite video game and just beat my 10-year record",
  "The barista writes increasingly elaborate prophecies on my cup and this week one came true",
  "I rent my parking spot to a guy who keeps parking stranger and stranger vehicles in it",
];

export default function IdeasPanel({
  ideas,
  onChange,
  onGenerateAll,
  onGenerateOne,
  generatingAll,
  generatingIndex,
  aiLabel,
  disabled,
}: {
  ideas: string[];
  onChange: (ideas: string[]) => void;
  onGenerateAll: () => void;
  onGenerateOne: (index: number) => void;
  generatingAll: boolean;
  generatingIndex: number | null;
  aiLabel: string;
  disabled?: boolean;
}) {
  const filled = ideas.filter((i) => i.trim().length > 2).length;
  const busy = generatingAll || generatingIndex !== null;

  const setAt = (idx: number, value: string) => {
    const next = [...ideas];
    next[idx] = value;
    onChange(next);
  };

  const randomizeAll = () => {
    const pool = [...SAMPLE_IDEAS].sort(() => Math.random() - 0.5);
    onChange(ideas.map((_, i) => pool[i % pool.length]));
  };

  const randomizeOne = (idx: number) => {
    const used = new Set(ideas);
    const pool = SAMPLE_IDEAS.filter((s) => !used.has(s));
    const pick = pool[Math.floor(Math.random() * pool.length)] ?? SAMPLE_IDEAS[idx];
    setAt(idx, pick);
  };

  return (
    <Section
      index="01"
      title="Story Titles"
      hint={`${filled}/10 LOADED`}
      complete={filled === 10}
      aside={
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={randomizeAll}
            disabled={disabled || busy}
            className="flex min-h-[32px] items-center gap-1.5 border border-coal-600 px-2.5 py-1 font-mono text-[10px] font-bold tracking-widest text-coal-300 transition-colors hover:border-volt-400 hover:text-volt-300 disabled:opacity-40"
          >
            <Dices className="size-3" /> SAMPLES
          </button>
          <button
            type="button"
            onClick={onGenerateAll}
            disabled={disabled || busy}
            className="bg-heat flex min-h-[32px] items-center gap-1.5 border border-volt-400 px-3 py-1 font-mono text-[10px] font-bold tracking-widest text-coal-950 transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {generatingAll ? (
              <>
                <Loader2 className="size-3 animate-spin" /> WRITING…
              </>
            ) : (
              <>
                <Wand2 className="size-3" strokeWidth={2.6} /> AI ×10
              </>
            )}
          </button>
        </div>
      }
    >
      <div className="grid gap-2.5 md:grid-cols-2">
        {ideas.map((idea, i) => {
          const ok = idea.trim().length > 2;
          const thinking = generatingIndex === i || generatingAll;
          return (
            <div
              key={i}
              className={cn(
                "group relative flex items-stretch border bg-coal-850 transition-colors duration-200",
                ok ? "border-coal-600" : "border-coal-700/80",
                "focus-within:border-volt-400/70"
              )}
            >
              <div
                className={cn(
                  "flex w-11 shrink-0 flex-col items-center justify-center gap-1 border-r font-mono text-[11px] font-bold tabular-nums transition-colors",
                  ok
                    ? "bg-heat border-coal-600 text-coal-950"
                    : "border-coal-700/80 bg-coal-800 text-coal-400"
                )}
              >
                {String(i + 1).padStart(2, "0")}
              </div>
              <div className="relative flex-1">
                <input
                  type="text"
                  value={idea}
                  disabled={disabled || thinking}
                  maxLength={240}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="sentences"
                  enterKeyHint="done"
                  onChange={(e) => setAt(i, e.target.value)}
                  placeholder={
                    thinking ? "AI is writing a premise…" : `Story title ${i + 1} — a premise…`
                  }
                  className="w-full bg-transparent px-3 py-3 pr-16 text-base leading-snug text-paper-100 placeholder:text-coal-500 focus:outline-none disabled:opacity-60 sm:py-2.5 sm:text-[13px]"
                  style={{ borderRadius: 0 }}
                />
                <div className="absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center gap-0.5">
                  {thinking ? (
                    <Loader2 className="size-3.5 animate-spin text-volt-400" />
                  ) : (
                    <>
                      <button
                        type="button"
                        title="Random sample title"
                        onClick={() => randomizeOne(i)}
                        disabled={disabled || busy}
                        className="grid size-7 place-items-center text-coal-500 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 max-md:opacity-100 hover:text-coal-200 disabled:opacity-0"
                      >
                        <Dices className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        title="Generate this title with AI"
                        onClick={() => onGenerateOne(i)}
                        disabled={disabled || busy}
                        className="grid size-7 place-items-center text-volt-400 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 max-md:opacity-100 hover:text-volt-300 disabled:opacity-0"
                      >
                        <Sparkles className="size-3.5" strokeWidth={2.4} />
                      </button>
                    </>
                  )}
                </div>
              </div>
              {ok && <div className="absolute -top-px -right-px size-2 bg-ember-500" aria-hidden />}
            </div>
          );
        })}
      </div>
      <p className="mt-4 flex items-start gap-2 font-mono text-[10px] leading-relaxed tracking-wider text-coal-400">
        <Sparkles className="mt-0.5 size-3.5 shrink-0 text-volt-400" />
        {aiLabel}
        <Type className="mt-0.5 ml-1 size-3.5 shrink-0 text-coal-500" />
        ENGLISH ONLY
      </p>
    </Section>
  );
}

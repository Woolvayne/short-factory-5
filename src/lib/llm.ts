/**
 * Story engine — browser-direct calls to Qwen (DashScope compatible-mode)
 * and Mistral. If no keys are stored, or both endpoints fail (e.g. CORS),
 * it falls back to a fully offline template writer so the line never stops.
 */

export interface StoryResult {
  text: string;
  provider: "qwen" | "mistral" | "offline";
}

const QWEN_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const MISTRAL_URL = "https://api.mistral.ai/v1/chat/completions";

export interface StoryConfig {
  qwenKey: string;
  mistralKey: string;
  words: number;
  temperature: number;
  styleInstruction: string;
}

const buildSystem = (cfg: StoryConfig) =>
  [
    "You write viral first-person Reddit stories.",
    cfg.styleInstruction,
    `Rules: about ${Math.max(80, Math.round(cfg.words))} words (±20). First person. English only.`,
    "Start mid-action with a punchy hook sentence. Escalate fast, land a satisfying twist or kicker.",
    "Plain spoken language — it will be read aloud by a text-to-speech voice.",
    "Return ONLY the story text. No title, no wrapping quotation marks, no 'EDIT:', no hashtags, no emojis.",
  ].join(" ");

async function callChat(
  provider: "qwen" | "mistral",
  url: string,
  model: string,
  apiKey: string,
  idea: string,
  cfg: StoryConfig
): Promise<string> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: cfg.temperature,
        max_tokens: Math.min(1200, Math.round(cfg.words * 3.2) + 200),
        messages: [
          { role: "system", content: buildSystem(cfg) },
          {
            role: "user",
            content: `Story premise: ${idea}\n\nWrite the story now (~${Math.round(cfg.words)} words, first person).`,
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`${provider} HTTP ${res.status}`);
    const data = await res.json();
    const text: string | undefined = data?.choices?.[0]?.message?.content;
    if (!text) throw new Error(`${provider} returned an empty story`);
    return text.trim().replace(/^["'“”]+|["'“”]+$/g, "").trim();
  } finally {
    window.clearTimeout(timer);
  }
}

export async function generateStory(
  idea: string,
  preferQwen: boolean,
  cfg: StoryConfig
): Promise<StoryResult> {
  const order = [
    { provider: "qwen" as const, url: QWEN_URL, model: "qwen-turbo", key: cfg.qwenKey.trim() },
    { provider: "mistral" as const, url: MISTRAL_URL, model: "mistral-small-latest", key: cfg.mistralKey.trim() },
  ];
  if (!preferQwen) order.reverse();

  for (const p of order) {
    if (!p.key) continue;
    try {
      return {
        text: await callChat(p.provider, p.url, p.model, p.key, idea, cfg),
        provider: p.provider,
      };
    } catch (e) {
      console.warn(`${p.provider} unreachable from browser, trying next`, e);
    }
  }
  return { text: offlineStory(idea, cfg.words), provider: "offline" };
}

/* ------------------------------------------------------------------ */
/*  IDEA ENGINE — generate the story titles/premises themselves         */
/* ------------------------------------------------------------------ */

export interface IdeaResult {
  ideas: string[];
  provider: "qwen" | "mistral" | "offline";
}

const IDEA_SYSTEM = [
  "You invent premises for short viral first-person Reddit stories.",
  "Each premise is ONE sentence, 8–18 words, English, present or past tense, written as a hook.",
  "They must be wildly different from each other — different settings, people and conflicts.",
  "No numbering, no quotes, no hashtags, no emojis, no explanations.",
].join(" ");

/** Pull a clean list of premises out of whatever the model returned. */
function parseIdeaList(raw: string, count: number): string[] {
  const cleaned = raw
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  let out: string[] = [];
  try {
    const start = cleaned.indexOf("[");
    const end = cleaned.lastIndexOf("]");
    if (start !== -1 && end > start) {
      const parsed = JSON.parse(cleaned.slice(start, end + 1));
      if (Array.isArray(parsed)) {
        out = parsed
          .map((v) => (typeof v === "string" ? v : typeof v?.idea === "string" ? v.idea : ""))
          .filter(Boolean);
      }
    }
  } catch {
    /* fall through to line parsing */
  }

  if (out.length === 0) {
    out = cleaned
      .split(/\r?\n/)
      .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
      .filter((l) => l.length > 12);
  }

  return out
    .map((l) => l.replace(/^["'“”]+|["'“”,]+$/g, "").trim())
    .filter((l, i, arr) => l.length > 12 && arr.indexOf(l) === i)
    .slice(0, count);
}

export async function generateIdeas(
  count: number,
  cfg: StoryConfig
): Promise<IdeaResult> {
  const order = [
    { provider: "qwen" as const, url: QWEN_URL, model: "qwen-turbo", key: cfg.qwenKey.trim() },
    { provider: "mistral" as const, url: MISTRAL_URL, model: "mistral-small-latest", key: cfg.mistralKey.trim() },
  ];
  if (Math.random() < 0.5) order.reverse();

  const prompt =
    `${cfg.styleInstruction}\n\n` +
    `Write ${count} completely different story premises in that sub-genre. ` +
    `Return ONLY a JSON array of ${count} strings, nothing else.`;

  for (const p of order) {
    if (!p.key) continue;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 40_000);
    try {
      const res = await fetch(p.url, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${p.key}` },
        body: JSON.stringify({
          model: p.model,
          temperature: Math.min(1.3, cfg.temperature + 0.1),
          max_tokens: 120 * count + 200,
          messages: [
            { role: "system", content: IDEA_SYSTEM },
            { role: "user", content: prompt },
          ],
        }),
      });
      if (!res.ok) throw new Error(`${p.provider} HTTP ${res.status}`);
      const data = await res.json();
      const text: string = data?.choices?.[0]?.message?.content ?? "";
      const ideas = parseIdeaList(text, count);
      if (ideas.length >= Math.min(count, 3)) {
        /* top up if the model was lazy */
        while (ideas.length < count) ideas.push(offlineIdea(ideas));
        return { ideas, provider: p.provider };
      }
      throw new Error(`${p.provider} returned an unusable list`);
    } catch (e) {
      console.warn(`${p.provider} idea generation failed, trying next`, e);
    } finally {
      window.clearTimeout(timer);
    }
  }

  const ideas: string[] = [];
  while (ideas.length < count) ideas.push(offlineIdea(ideas));
  return { ideas, provider: "offline" };
}

/* offline premise builder — combinatorial, always unique-ish */
const WHO = [
  "my roommate", "my landlord", "my boss", "my sister", "my neighbour",
  "my coworker", "my gym buddy", "my barista", "my father-in-law", "my best friend",
  "the guy in 4B", "my group project partner", "my dog walker", "my ex",
];
const WHAT = [
  "kept stealing my labelled food",
  "secretly moved into the building's storage room",
  "took credit for a project I built alone",
  "announced huge news at my celebration",
  "trained the local birds to visit only their window",
  "started a passive-aggressive sticky-note war",
  "parked stranger and stranger vehicles in my spot",
  "rewrote the shared calendar to erase my shifts",
  "borrowed my car and returned it detailed and full of glitter",
  "kept scheduling meetings during my lunch on purpose",
  "adopted my old hobby and got weirdly competitive about it",
  "left cryptic notes that turned out to be predictions",
];
const TWIST = [
  "so I fought back in the pettiest way possible",
  "and the security footage told a very different story",
  "until the whole building got involved",
  "and HR called my bluff within an hour",
  "so I documented everything for three months",
  "and then the truth came out at the worst moment",
  "and I have zero regrets about what happened next",
  "until one small detail unravelled everything",
];

function offlineIdea(existing: string[]): string {
  for (let attempt = 0; attempt < 40; attempt++) {
    const idea = `${pick(WHO)} ${pick(WHAT)}, ${pick(TWIST)}`;
    const sentence = idea.charAt(0).toUpperCase() + idea.slice(1);
    if (!existing.includes(sentence)) return sentence;
  }
  return `${pick(WHO)} ${pick(WHAT)}, ${pick(TWIST)} (${existing.length + 1})`;
}

/* ------------------------------------------------------------------ */
/*  offline template writer (150–220 words, zero network)               */
/* ------------------------------------------------------------------ */

const HOOKS = [
  "This actually happened and I still cannot fully believe it.",
  "I need to get this off my chest before I explode.",
  "People keep telling me I should post this story, so here goes.",
  "I never thought I would be the person writing one of these.",
  "Grab a snack, because this one is absolutely unhinged.",
  "Three days ago my life was completely normal. Then this happened.",
];

const ESCALATIONS = [
  "At first I tried to be the reasonable one and just let it slide, but every single day it got a little bit worse.",
  "I gave them so many chances to stop, and every time they just smiled and kept going like nothing was wrong.",
  "Everyone around me said I was overreacting, which honestly made me even angrier about the whole situation.",
  "I started documenting everything in a notes app, because I knew nobody would believe me otherwise.",
  "The petty part of me took over at this point, and I decided that two could play this exact game.",
  "Word started spreading, and suddenly other people began telling me I was not the only victim here.",
  "I lost sleep over it, rehearsing arguments in the shower, which is embarrassing to admit out loud.",
  "The situation escalated way past anything I had planned, and frankly I stopped feeling guilty about it.",
];

const TWISTS = [
  "And then came the twist I never saw coming in a million years.",
  "But here is the part that made my jaw hit the actual floor.",
  "That is when everything flipped upside down in the best possible way.",
  "And just when I thought it could not get any stranger, it absolutely did.",
];

const KICKERS = [
  "So tell me, internet, was I out of line here, or was this completely justified?",
  "Anyway, that is where we stand now. Petty? Maybe. Worth it? Absolutely.",
  "I am not saying I am proud of everything, but I would honestly do it again tomorrow.",
  "So yes, I won. And no, I do not regret a single minute of it.",
  "That is the whole story. Judge me if you want, I have zero regrets.",
];

const FILLERS = [
  "Looking back, the warning signs were all there from the very beginning, I just refused to see them because I wanted to believe people are basically decent.",
  "My friends are completely split on this one, half of them think I am a hero and the other half think I took it way too far.",
  "I keep replaying the whole thing in my head, and every single time I land in the exact same place: I did what I had to do.",
  "The most satisfying part is that they still have no idea how it all connects back to that one moment where everything started.",
  "If nothing else, I learned that documenting everything with timestamps and screenshots is the single best habit you can build.",
];

const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

function offlineStory(idea: string, targetWords = 185): string {
  const setup =
    `For some context: ${idea.replace(/\.$/, "")}. ` +
    "I know how that sounds written out, but I promise the reality was ten times worse.";
  const parts = [
    pick(HOOKS),
    setup,
    pick(ESCALATIONS),
    pick(ESCALATIONS),
    pick(ESCALATIONS),
    "I finally confronted the whole thing head on, heart pounding, with every receipt I had collected lined up like a prosecutor.",
    pick(TWISTS),
    "The look on their face when they realized I had seen everything is something I will treasure for the rest of my life.",
    pick(KICKERS),
  ];
  let text = parts.join(" ");
  const floor = Math.max(80, Math.round(targetWords * 0.85));
  let i = 0;
  while (text.split(/\s+/).length < floor && i < FILLERS.length * 2) {
    const filler = FILLERS[i % FILLERS.length];
    if (!text.includes(filler)) text += " " + filler;
    i++;
  }
  return text;
}

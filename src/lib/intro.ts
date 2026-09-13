/**
 * Reddit-style intro card — the first ~1.5 s of EVERY rendered short.
 *
 * The look is deliberately modelled on a Reddit post screenshot, because that
 * is the format this pipeline feeds (AITA / revenge / confession stories):
 * dark card, orange accent, avatar + subreddit line, the video's own title as
 * the post title, and the hook sentence underneath. Everything is drawn on the
 * same canvas the captions use, so the card is captured by MediaRecorder
 * exactly like the rest of the frame — no extra asset, no video file to ship,
 * no CORS, works offline, and it scales cleanly from 540p to 1080p.
 *
 * `progress` (0…1) drives a small reveal: the card slides up + fades in, the
 * progress bar fills across the intro, and in the last 16 % the whole thing
 * dissolves into the live clip instead of hard-cutting.
 */

export interface IntroCardStyle {
  /** the story's own title — taken from the idea line of that unit */
  title: string;
  subreddit: string;
  hook: string;
  /** position inside the intro, 0…1 */
  progress: number;
  /** stable pseudo-random seed so up- and comment counts never jitter */
  seed?: number;
}

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

const REDDIT_ORANGE = "#ff4500";
const CARD_BG = "#1a1b1e";
const CARD_BORDER = "#33353a";
const TEXT_HI = "#f7f7f8";
const TEXT_MID = "#d7d9db";
const TEXT_LO = "#9a9da3";
const UI_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const HEAD_FONT = '"Arial Black", "Helvetica Neue", Arial, sans-serif';

/** FNV-1a — cheap and stable, so a re-render of the same story keeps its counts. */
export function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h >>> 0);
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fill();
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Greedy word wrap with a hard line cap and a real ellipsis on overflow. */
function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const all: string[] = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (cur && ctx.measureText(test).width > maxWidth) {
      all.push(cur);
      cur = w;
    } else {
      cur = test;
    }
  }
  if (cur) all.push(cur);
  if (all.length <= maxLines) return all;

  const kept = all.slice(0, Math.max(1, maxLines));
  let last = kept[kept.length - 1];
  while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) {
    last = last.slice(0, -1);
  }
  kept[kept.length - 1] = `${last.replace(/[\s.,:;!?-]+$/, "")}…`;
  return kept;
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

/** Simplified Snoo — vector, so it stays crisp at every render resolution. */
function drawAvatar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number
): void {
  ctx.save();
  ctx.fillStyle = REDDIT_ORANGE;
  circle(ctx, cx, cy, r);
  ctx.fillStyle = "#ffffff";
  circle(ctx, cx, cy + r * 0.12, r * 0.74);
  ctx.strokeStyle = REDDIT_ORANGE;
  ctx.lineCap = "round";
  ctx.lineWidth = r * 0.1;
  ctx.beginPath();
  ctx.moveTo(cx, cy - r * 0.62);
  ctx.lineTo(cx, cy - r * 1.06);
  ctx.stroke();
  ctx.fillStyle = REDDIT_ORANGE;
  circle(ctx, cx, cy - r * 1.14, r * 0.13);
  circle(ctx, cx - r * 0.28, cy + r * 0.06, r * 0.13);
  circle(ctx, cx + r * 0.28, cy + r * 0.06, r * 0.13);
  ctx.beginPath();
  ctx.arc(cx, cy + r * 0.14, r * 0.4, Math.PI * 0.16, Math.PI * 0.84);
  ctx.stroke();
  ctx.restore();
}

function drawCommentIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number
): void {
  ctx.save();
  ctx.strokeStyle = TEXT_LO;
  ctx.lineWidth = Math.max(1, size * 0.13);
  ctx.lineJoin = "round";
  roundRectPath(ctx, x, y - size * 0.42, size, size * 0.72, size * 0.2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + size * 0.26, y + size * 0.3);
  ctx.lineTo(x + size * 0.26, y + size * 0.56);
  ctx.lineTo(x + size * 0.56, y + size * 0.3);
  ctx.stroke();
  ctx.restore();
}

function drawShareIcon(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  ctx.save();
  ctx.strokeStyle = TEXT_LO;
  ctx.lineWidth = Math.max(1, size * 0.13);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  /* arrow out of a tray */
  ctx.beginPath();
  ctx.moveTo(x + size * 0.1, y - size * 0.18);
  ctx.lineTo(x + size * 0.1, y + size * 0.36);
  ctx.lineTo(x + size * 0.94, y + size * 0.36);
  ctx.lineTo(x + size * 0.94, y - size * 0.14);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + size * 0.44, y - size * 0.32);
  ctx.lineTo(x + size * 0.66, y - size * 0.56);
  ctx.lineTo(x + size * 0.88, y - size * 0.32);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + size * 0.66, y - size * 0.52);
  ctx.lineTo(x + size * 0.66, y + size * 0.08);
  ctx.stroke();
  ctx.restore();
}

/**
 * Paints the full-screen intro frame. Safe to call on any canvas size — all
 * metrics are relative. Callers that want the clip visible behind the card get
 * it automatically: the whole frame dissolves out during the last 16 %.
 */
export function drawRedditIntroCard(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  o: IntroCardStyle
): void {
  const p = clamp01(o.progress);
  const inT = easeOut(clamp01(p / 0.24));
  const outT = p > 0.84 ? clamp01((1 - p) / 0.16) : 1;

  /* unit: the width for a portrait frame, the "would-be" width for landscape,
     so a 16:9 render never gets 1920px-tall text */
  const u = Math.min(W, (H * 9) / 16);
  const seed = Number.isFinite(o.seed) ? Math.trunc(o.seed ?? 0) : hashSeed(o.title);
  const upvotes = 1200 + (seed % 61) * 411;
  const comments = 34 + (seed % 17) * 61;
  const shares = 3 + (seed % 9) * 7;

  ctx.save();

  /* ---- backdrop (fades out at the end so the card dissolves into the clip) */
  ctx.globalAlpha = outT;
  ctx.fillStyle = "#0b0c0e";
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.5, H * 0.16, u * 0.05, W * 0.5, H * 0.16, H * 0.7);
  glow.addColorStop(0, "rgba(255,69,0,0.22)");
  glow.addColorStop(1, "rgba(255,69,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 1;

  /* ---- measure the content first so the card can be auto-fitted */
  const cardW = Math.min(W * 0.94, u * 1.24);
  const pad = u * 0.062;
  const innerW = cardW - pad * 2;
  const fSub = u * 0.05;
  const fMeta = u * 0.0355;
  const fTitle = u * 0.074;
  const fHook = u * 0.0425;
  const fFoot = u * 0.038;

  ctx.font = `800 ${fTitle}px ${HEAD_FONT}`;
  const titleLines = wrapLines(ctx, o.title.trim() || "Reddit Story", innerW, 6);
  ctx.font = `500 ${fHook}px ${UI_FONT}`;
  const hookLines = wrapLines(ctx, (o.hook || "").trim(), innerW, 2);

  const avatar = u * 0.058;
  const headerH = avatar * 2.4;
  const titleH = titleLines.length * fTitle * 1.14;
  const hookH = hookLines.length * fHook * 1.3;
  const footerH = fFoot * 2.1;
  const gap = u * 0.032;
  const contentH =
    headerH + gap + titleH + (hookLines.length ? gap * 0.9 + hookH : 0) + gap + footerH;
  const cardH = Math.max(contentH + pad * 2.35, u * 0.5);
  const cardX = (W - cardW) / 2;
  const cardY = (H - cardH) / 2 + (1 - inT) * H * 0.028;

  /* never let a long title push the card off-frame */
  const fit = Math.min(1, (H * 0.9) / cardH);
  ctx.translate(W / 2, H / 2);
  ctx.scale(fit, fit);
  ctx.translate(-W / 2, -H / 2);

  ctx.globalAlpha = inT * outT;

  /* ---- card body */
  ctx.fillStyle = CARD_BG;
  roundRectPath(ctx, cardX, cardY, cardW, cardH, u * 0.038);
  ctx.fill();
  ctx.strokeStyle = CARD_BORDER;
  ctx.lineWidth = Math.max(1, u * 0.004);
  ctx.stroke();

  let y = cardY + pad * 1.2 + avatar;

  /* ---- header: avatar + subreddit + post meta */
  drawAvatar(ctx, cardX + pad + avatar, y, avatar);
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.font = `700 ${fSub}px ${UI_FONT}`;
  ctx.fillStyle = TEXT_HI;
  ctx.fillText(o.subreddit.trim() || "r/Stories", cardX + pad + avatar * 2 + u * 0.032, y - fSub * 0.34);
  ctx.font = `500 ${fMeta}px ${UI_FONT}`;
  ctx.fillStyle = TEXT_LO;
  ctx.fillText("Posted just now", cardX + pad + avatar * 2 + u * 0.032, y + fMeta * 0.75);

  /* ---- title (the video's own title) */
  let cursorY = cardY + pad * 1.2 + headerH + gap;
  ctx.font = `800 ${fTitle}px ${HEAD_FONT}`;
  ctx.fillStyle = TEXT_HI;
  titleLines.forEach((ln, i) => {
    ctx.globalAlpha = inT * outT * clamp01((p - 0.05 - i * 0.035) / 0.16);
    ctx.fillText(ln, cardX + pad, cursorY + (fTitle * 1.14) / 2 + i * fTitle * 1.14);
  });
  ctx.globalAlpha = inT * outT;
  cursorY += titleH;

  /* ---- hook line */
  if (hookLines.length) {
    cursorY += gap * 0.9;
    ctx.font = `500 ${fHook}px ${UI_FONT}`;
    ctx.fillStyle = TEXT_MID;
    hookLines.forEach((ln, i) => {
      ctx.fillText(ln, cardX + pad, cursorY + fHook / 2 + i * fHook * 1.3);
    });
    cursorY += hookH;
  }

  /* ---- divider + engagement row */
  cursorY += gap;
  ctx.strokeStyle = CARD_BORDER;
  ctx.lineWidth = Math.max(1, u * 0.0035);
  ctx.beginPath();
  ctx.moveTo(cardX + pad, cursorY);
  ctx.lineTo(cardX + cardW - pad, cursorY);
  ctx.stroke();

  const rowY = cursorY + footerH / 2;
  const icon = fFoot * 1.15;
  ctx.font = `700 ${fFoot}px ${UI_FONT}`;
  ctx.textAlign = "left";

  /* upvote */
  ctx.fillStyle = REDDIT_ORANGE;
  ctx.beginPath();
  ctx.moveTo(cardX + pad + icon * 0.5, rowY - icon * 0.42);
  ctx.lineTo(cardX + pad + icon, rowY + icon * 0.34);
  ctx.lineTo(cardX + pad, rowY + icon * 0.34);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = REDDIT_ORANGE;
  ctx.fillText(formatCount(upvotes), cardX + pad + icon * 1.32, rowY);

  /* comments */
  let cx = cardX + pad + icon * 1.32 + ctx.measureText(formatCount(upvotes)).width + icon * 1.1;
  drawCommentIcon(ctx, cx, rowY, icon);
  cx += icon * 1.35;
  ctx.fillStyle = TEXT_LO;
  ctx.fillText(formatCount(comments), cx, rowY);

  /* shares */
  cx += icon * 1.15 + ctx.measureText(formatCount(comments)).width;
  drawShareIcon(ctx, cx, rowY, icon);
  cx += icon * 1.72;
  ctx.fillStyle = TEXT_LO;
  ctx.fillText(formatCount(shares), cx, rowY);

  /* ---- intro progress bar, bottom edge of the card */
  const barH = Math.max(2, u * 0.011);
  const barY = cardY + cardH - barH - u * 0.03;
  ctx.fillStyle = "#2b2d31";
  roundRectPath(ctx, cardX + pad, barY, innerW, barH, barH / 2);
  ctx.fill();
  ctx.fillStyle = REDDIT_ORANGE;
  roundRectPath(ctx, cardX + pad, barY, Math.max(barH, innerW * p), barH, barH / 2);
  ctx.fill();

  ctx.restore();
}

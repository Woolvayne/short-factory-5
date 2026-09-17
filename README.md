# ShortsFactory — Clip Mill Edition

**One clip in. Ten shorts out.** A video assembly line that runs **100 % in your
browser**: no server, no cloud render farm, no ffmpeg. Feed it one long
background video, get ten different moments — each with its own AI story,
neural voice and word-synced captions — then press **Render**.

Optimised for desktop **and** iPhone / iPad (iOS 17+ recommended).

## The three-button flow

1. **① Prepare 10 scripts + voices** — fast step, writes every story and
   synthesises every voice track. No video is rendered yet.
2. **② Render** — the explicit render button. Renders every staged unit, or use
   the **RENDER** button on each individual card in the Output Bay.
   Done units get **RE-RENDER**, failed ones get **RETRY**. A **STOP** button
   in the status bar aborts a running batch.
3. **Bundle → ZIP** — packs all finished blobs locally and fires a real
   `<a href="blob:" download>` link (Safari-safe).

## Clip Mill — one source → ten clips

Step 02 has two modes:

| Mode | What it does |
| --- | --- |
| **1 SOURCE → 10** | Pick *one* long video (or paste a direct link). It's sliced into 10 different clip windows — one per story. Every window shows its timecode and can be re-rolled individually; **RE-SLICE** redeals all ten. |
| **10 FILES** | The classic path: pick ten separate 9:16 clips, one per story. |

Slicing is controlled under **Settings → CLIPS**: distribution
(*evenly spread / random / sequential*), clip length (*match voice / fixed*),
plus **skip intro** and **skip outro** so title cards and end screens never
make it into a short. When clip length is set to *match voice*, the ten
windows are re-cut after preparation using the real voice durations.

### About YouTube links

Paste a YouTube (or TikTok / Instagram / X / Vimeo) link and the app tells you
honestly what's going on instead of pretending: **browsers cannot download
those streams** — they're signed and send no CORS headers, and working around
that would breach the platform's terms and, for material you don't own,
copyright. The panel shows the legal one-step alternative:

* Your own video → download the original in **YouTube Studio → Content → ⋮ → Download**, then pick that file.
* Licensed / Creative-Commons footage → get the file from the rights holder or stock site.
* Or paste a **direct video URL** (`…/clip.mp4`) that allows cross-origin requests — your own hosting, S3/R2, Pexels, Coverr, Mixkit. Those are streamed into a local blob with a progress bar and sliced exactly the same way.

## Settings (5 tabs)

| Tab | Controls |
| --- | --- |
| **AI** | Qwen + Mistral keys (localStorage only), story genre (AITA · petty revenge · confession · unsettling · wholesome · workplace · custom instruction), story length ~110–280 words, creativity/temperature |
| **VOICE** | 12 Edge neural voices, speaking rate ±40 %, pitch ±20 Hz, voice volume, music-bed volume, music fade-out, tail padding |
| **CAPTIONS** | On/off, 4 style presets, 1–5 words per cue, colour swatches + custom picker, text size, vertical position, outline weight, uppercase, drop shadow — with a **live preview** |
| **VIDEO** | Resolution (auto / 540 / 720 / 1080), frame rate 24·30·60, bitrate, vignette, slow Ken-Burns zoom |
| **CLIPS** | Distribution mode, clip length mode + fixed length, skip intro, skip outro |

No API keys? The built-in **offline story writer** takes over — full-length
first-person stories with zero network.

## One-Page Dashboard (Postlake)

Alles liegt auf **einer** Seite. Auf Desktop/iPad läuft ein Split-Screen:

```
┌─ Dashboard: Heute · Geplant · Veröffentlicht · Stunde · Credits ───┐
├──────────────────────────┬────────────────────────────────────────┤
│ LINKS · Video Factory    │ RECHTS · Autopilot + Social            │
│ Settings · Titel         │ Autopilot (Auto-Modus 1–100/h)         │
│ Clip Mill · Musik        │ Postlake Kanäle + Credits              │
│ Assembly · Output Bay    │ Content Kalender (Monat/Woche/Tag)      │
│                          │ Analytics (7/30/90 Tage)                │
└──────────────────────────┴────────────────────────────────────────┘
```

Beide Spalten scrollen unabhängig. Auf dem Smartphone stapelt sich alles
automatisch untereinander, mit einer horizontal scrollbaren Sektions-Navigation
(🎬 Create · 📤 Post · 📅 Calendar · 📊 Analytics · ⚙ Settings). Der Header ist
sticky, die Sprungziele scrollen sanft.

### Postlake-Integration (einziger Post- & Analyseweg)

**Alle Videos laufen ausschließlich über [Postlake](https://app.postlake.dev/app)** —
fürs Posten/Planen *und* für Analytics. Ältere Buffer-/Zernio-Anbindungen wurden
restlos entfernt.

`api/postlake.js` ist eine Node-Serverless-Function und spricht die Postlake-REST-API
unter `https://api.postlake.dev/v1`. Der **`POSTLAKE_API_KEY` bleibt ausschließlich
serverseitig** — er taucht nirgends im Client-Bundle auf.

```bash
# Vercel → Project Settings → Environment Variables
POSTLAKE_API_KEY=sk_live_...      # app.postlake.dev → API Keys (zeigt sich nur einmal!)
```

Setup in 3 Schritten:

1. Konto unter [app.postlake.dev](https://app.postlake.dev/app) anlegen, E-Mail
   verifizieren (schaltet Gratis-Credits frei).
2. Unter **Channels** Kanäle verbinden (TikTok/YouTube sofort; Instagram/Facebook
   sind bei Postlake teils noch im Partner-Review) und **API Keys → Create API key**.
3. Key als `POSTLAKE_API_KEY` in Vercel setzen, neu deployen, in der App auf **SYNC** tippen.

Ablauf pro Video (exakt nach [docs.postlake.dev](https://docs.postlake.dev)):

1. **Media:** `POST /v1/media/batch` (JSON) liefert eine signierte PUT-URL —
   der Browser lädt die Render-Bytes direkt hoch, der Key bleibt geheim. Ergebnis:
   eine `med_…`-ID. Binär-Bodies gehen roh durch die Server-Route (kein
   JSON-Serialize → kein HTTP 413 mehr), signierte PUTs senden exakt die
   vorgegebenen Header (Content-Type nur ergänzen, wenn nicht schon gesetzt).
   **Fallback-Kette** (serverseitig, schadet nie): Supabase-Hosting →
   ① `{url}`-Ingest → ② Bytes laden + serverseitig auf signierte PUT-URL →
   ③ roher `POST /v1/media` (nur ≤ 8 MB). Fehlermeldungen nennen MB + Diagnose
   pro Schritt.
2. **Validate:** `POST /v1/posts/validate` (kostenlos) prüft Caption-, Media- und
   Options-Regeln vorab.
3. **Create:** `POST /v1/posts` mit `accounts`, `media`, optional `scheduledAt` +
   `timezone` — **ein Call fächert auf alle Kanäle auf** (`targets[]` pro Kanal
   mit eigenem Status und Live-URL). `Idempotency-Key` verhindert Doppel-Posts
   bei Retries.
4. **Status:** `GET /v1/posts/{id}` pollen bis `published`/`partial`/`failed`
   (`processing` ist normal bei TikTok/Reels/YouTube).

Plattform-Details, die der Server automatisch setzt:

* **TikTok:** `platformOptions.tiktok.privacyLevel` ist Pflicht (aus der
  Publish-Info des Kanals gelesen, sonst `PUBLIC_TO_EVERYONE`), `mode: direct`.
* **YouTube:** `platformOptions.youtube.title` (≤100) + `privacyStatus: public`.
* **Planen:** naive Wandzeit + `timezone: Europe/Berlin` (06:00 & 20:00 Default);
  belegte Slots werden übersprungen, nie doppelt belegt.

**Credits:** 1 Credit pro veröffentlichtem Kanal-Post (nur Erfolge zählen).
Free: 20/Monat. Das Guthaben steht im Dashboard, in der Kanal-Leiste und im
Autopilot-Panel — bitte vor großen Läufen prüfen.

**Post all:** Der Button in der Output-Bay (und **POST** auf jeder Karte) postet
**ohne Nachfrage** mit den gespeicherten Voreinstellungen (Kanäle, Modus
Sofort/Slots, Caption, Hashtags). Der **SOFORT/PLANEN-Schalter** sitzt als
kompakte Segment-Steuerung direkt davor (aktiv = volt): SOFORT schickt sofort
raus, PLANEN belegt automatisch die nächsten freien Slots. Fortschritt läuft
auf Button & Karten, Fehler landen rot im Kalender.

**Kalender:** Postliste von Postlake (Quelle der Wahrheit) + lokale Spiegel.
Geplante Posts lassen sich umplanen (PATCH) und stornieren (DELETE);
**STATUS** pollt offene Posts, **SYNC** lädt die Liste neu.

**Analytics:** `GET /v1/analytics?period=7d|30d|90d` (kostenlos) + Top-Posts —
einheitliche Kennzahlen (Impressions, Reach, Likes, Kommentare, Shares …)
über alle Netzwerke.

### Autopilot (Auto-Modus)

Ein Klick auf **Autopilot starten** — danach läuft alles **ohne Nachfrage und
ohne Klick**: Titel sichern (fehlende schreibt die KI), Scripts + Voices,
Rendern, jedes fertige Video im Stunden-Limit an Postlake schicken, nächste
Runde mit frischen Ideen und neu geslicten Clips. Stopp nur per **STOP**.

* **Limit (voreingestellt): 10 Videos/Stunde, frei 1–100** — drosselt den
  Postlake-Versand (gleichmäßiger Abstand + hartes 60-Min-Fenster); gerendert
  wird durchgehend, der Rest wartet in der Queue (Rückstau-Schutz bei 30).
* **Modi:** Sofort posten oder Slots planen (06:00 & 20:00 Berlin).
* **Robustheit:** 3 Versuche pro Video, Protokoll im Panel, Live-Status-Polling,
  Credit-Warnung, Wake-Lock gegen Display-Schlaf.
* **Voraussetzungen:** Footage geladen (Titel optional), **Tab muss offen bleiben**
  (Echtzeit-Canvas-Rendering), Kanäle + Key für Live-Versand (ohne beides wird
  lokal zwischengespeichert, nichts geht verloren).

### Erweiterte Musik- & Video-Optionen

Alle neuen Regler sind **additiv** — die Defaults entsprechen exakt dem
bisherigen Verhalten:

* **Musik:** An/Aus, Gesamt-Lautstärke, Original-Audio des Clips, Ducking
  (Stärke + Geschwindigkeit), Startpunkt (Anfang / nach Intro / zufällig /
  benutzerdefiniert), Ende (mit Video / Fade-Out mit Länge)
* **Video:** Format 9:16 · 16:9 · 1:1, Untertitel-Stil (Standard / Bold /
  Minimal / Highlight), Größe (klein/mittel/groß), Position (oben/mitte/unten)

## Lokaler Asset-Speicher

Hintergrund-Clips und Musik landen in **IndexedDB** (`src/lib/storage.ts`) und
überleben Reload, Tab-Neustart und Offline-Nutzung — nichts wird hochgeladen.
Löschen, Leeren und die Soundtrack-Auswahl werden mitgespeichert; der Hero
zeigt unter `ASSET VAULT` an, was gerade lokal liegt.

## Quick start

```bash
npm install
npm run dev        # open the printed URL (narration relay included, same origin)
npm run build      # static bundle in dist/
```

Deploying to Vercel works with zero configuration: `api/tts.js` is picked up
as a Serverless Function automatically, and the `ws` dependency is installed
during build. No environment variables are needed for narration.

### Why the TTS relay exists

Microsoft's Edge Read-Aloud endpoint is WebSocket-only, and every **browser**
WebSocket handshake automatically carries an `Origin` header — which that
endpoint rejects. Supabase's Edge Function runtime proved unreliable for
outbound third-party WebSockets (invocations terminate after ~10ms CPU with
"EarlyDrop" before any audio arrives). The proven `edge-tts` protocol
implementation (TrustedClientToken + `Sec-MS-GEC` BigInt token,
`speech.config`, SSML, WordBoundary parsing) therefore lives in
`api/tts.js` — a Vercel Serverless Function pinned to the **Node.js runtime**
(`export const config = { runtime: 'nodejs' }`), where raw `ws` connections
work without restriction. The frontend POSTs to this same-origin endpoint:

```
POST /api/tts
{ "text": "...", "voice": "en-US-AndrewNeural", "rate": 2, "pitch": 0 }

200 { "ok": true, "format": "audio/mpeg", "audioBase64": "…", "words": [ … ] }
```

Same origin → no CORS, no apikey, no Supabase anon key, no configuration.
`src/lib/tts.ts` keeps the same `TtsResult` / `WordTs` / `Cue` / `buildCues` /
`cueAt` exports — the renderer is untouched.

## How it works

| Piece | Where |
| --- | --- |
| Stories | Browser → Qwen/Mistral directly (optional), else offline writer |
| Voice | Browser → same-origin Vercel Serverless Function `/api/tts` (Node runtime + `ws`) ⇄ Microsoft Edge Read-Aloud WebSocket — free, no API key, the public `edge-tts` protocol with the `Sec-MS-GEC` token computed in BigInt |
| Captions | WordBoundary timestamps grouped into N-word cues, drawn on canvas |
| Rendering | Canvas 2D + WebAudio graph + MediaRecorder, real-time capture, MP4/H.264 on Safari with automatic WebM fallback |
| ZIP | JSZip (STORE) → blob anchor, fully local |
| Posting | Browser → same-origin `/api/postlake` (Node) ⇄ Postlake REST (`/v1/media`, `/v1/posts`, `/v1/analytics`) — key stays server-side, uploads via signed PUT URLs |
| Autopilot | In-browser loop: ideas → prepare → render → throttled dispatch (1–100/h) → next round, zero clicks |
| Your files | Never uploaded — read straight from device memory (except the videos you post) |

Rendering is real-time: a 40-second voice takes ~40 seconds per unit, and the
tab must stay in the foreground (that's how MediaRecorder captures frames).

## Project layout

```
src/
├─ App.tsx                     orchestrator: prepare → render → zip → postlake · autopilot loops
├─ components/
│  ├─ Header.tsx               LEDs, clock, marquee
│  ├─ SettingsPanel.tsx        5-tab settings console
│  ├─ Controls.tsx             sliders, toggles, segmented, colour swatches
│  ├─ IdeasPanel.tsx           the 10 numbered inputs
│  ├─ ClipMill.tsx             1-source slicing + link intake + 10-file mode
│  ├─ Uploaders.tsx            soundtrack deck
│  ├─ MissionControl.tsx       prepare/render buttons · unit cards · ZIP bay · post all
│  ├─ AutopilotPanel.tsx       auto-mode console: limit 1–100/h, stats, event log
│  ├─ PostlakeAccounts.tsx     channels + credits + post-all prefs (+ dashboard stats)
│  ├─ PostlakeCalendar.tsx     month/week/day calendar · reschedule · cancel · poll
│  └─ PostlakeAnalytics.tsx    roll-up metrics + top-posts chart
└─ lib/
   ├─ settings.ts   llm.ts   tts.ts   renderer.ts   clips.ts   media.ts   types.ts
   ├─ postlake.ts   postlake client: prefs, slots, posts, analytics (via /api/postlake)
   ├─ autopilot.ts  auto-mode config, hourly throttle, dispatch log, stats
   └─ upload.ts     signed-PUT uploads to Postlake (+ supabase fallback)

api/        ← tts relay + postlake route (Vercel Serverless Functions, Node.js runtime)
supabase/   ← inert legacy v1 (hosted Edge Functions + Shotstack), unused
            (nur der „renders"-Bucket dient noch als Upload-Fallback)
```

— No ffmpeg. No mercy.

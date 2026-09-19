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

## Passwortschutz (optional — APP_PASSWORD)

Die App lässt sich optional mit einem Zugangs-Passwort absichern. Das Passwort
lebt **ausschließlich serverseitig** als Umgebungsvariable — es taucht nie im
Client-Bundle auf und wird serverseitig (timing-sicher) geprüft:

```bash
# Vercel → Project Settings → Environment Variables
APP_PASSWORD=dein_sicheres_passwort
GATE_TTL_HOURS=168   # optional: Session-Dauer in Stunden (Default = 7 Tage)
```

| Zustand | Verhalten |
| --- | --- |
| **Variable gesetzt** | Beim App-Start erscheint ein Lock-Screen. Erst nach dem Passwort werden die Factory (**UI und alle `/api`-Routen**: tts, buffer, gate) freigeschaltet. Die signierte HttpOnly-Session-Cookie hält standardmäßig **7 Tage** — kein Neu-Fragen bei jedem Reload. Passwort ändern in Vercel → alle Sessions sofort ungültig. |
| **Variable leer / fehlt** | Es wird **nicht** nach einem Passwort gefragt — die App läuft unverändert offen. Statt dem Prompt zeigt sie nur einen dezenten **Verweis** auf die Variable: Banner unter dem Hero (mit Link zur Vercel-Doku), `ACCESS GATE`-Zeile im Hero-Panel und `GATE OFF` im Footer. |

Technik: `api/gate.js` (`GET` Status · `POST` entsperren · `DELETE` sperren)
vergleicht das Passwort serverseitig über SHA-256-Digests mit
`timingSafeEqual` und bremst Fehlversuche pro IP ab. Bei Erfolg setzt es ein
HMAC-signiertes Cookie (Secret = aus dem Passwort abgeleitet) — dieselbe
Session schaltet dann auch `/api/tts` und `/api/buffer` frei
(`server/gate-core.js`). Client-Seite: `src/lib/gate.ts` +
`src/components/GatePanel.tsx`. Lokal ist das Gate in den `npm run dev`-Server
eingebaut — einfach `APP_PASSWORD` in eine `.env` schreiben.

## One-Page Dashboard (Buffer)

Alles liegt auf **einer** Seite. Auf Desktop/iPad läuft ein Split-Screen:

```
┌─ Dashboard: Heute · Geplant · Veröffentlicht · Stunde ─────────────┐
├──────────────────────────┬────────────────────────────────────────┤
│ LINKS · Video Factory    │ RECHTS · Autopilot + Social            │
│ Settings · Titel         │ Autopilot (Auto-Modus 1–100/h)         │
│ Clip Mill · Musik        │ Buffer Kanäle                          │
│ Assembly · Output Bay    │ Content Kalender (Monat/Woche/Tag)      │
└──────────────────────────┴────────────────────────────────────────┘
```

Beide Spalten scrollen unabhängig. Auf dem Smartphone stapelt sich alles
automatisch untereinander, mit einer horizontal scrollbaren Sektions-Navigation
(🎬 Create · 📤 Post · 📅 Calendar · ⚙ Settings). Der Header ist
sticky, die Sprungziele scrollen sanft.

### Versandweg: Buffer

**Jeder POST-Button schickt direkt über [Buffer](https://publish.buffer.com).**
Der Autopilot nutzt denselben Weg. Kalender & Dashboard zeigen alle Posts aus
dem lokalen Spiegel (📦 BUFFER-Badge pro Post; Einträge aus der Zeit vor der
Buffer-only-Umstellung bleiben als 🗂 BESTAND sichtbar und lassen sich nur noch
lokal umplanen oder entfernen).

**Post all:** Der Button in der Output-Bay (und **POST** auf jeder Karte) postet
sofort mit den gespeicherten Voreinstellungen (Kanäle, Modus Sofort/Slots,
Caption, Hashtags). Der **SOFORT/PLANEN-Schalter** sitzt als kompakte
Segment-Steuerung direkt davor (aktiv = volt): SOFORT schickt sofort raus,
PLANEN belegt automatisch die nächsten freien Slots (06:00 & 20:00 Berlin;
belegte Slots werden übersprungen, nie doppelt belegt). Fortschritt läuft auf
Button & Karten, Fehler landen rot im Kalender.

**Kalender:** Buffer-Postliste (Quelle der Wahrheit) + lokaler Spiegel in einem
gemeinsamen Cache. Geplante Posts lassen sich umplanen und stornieren;
**STATUS** pollt offene Posts, **SYNC** lädt die Liste neu. Performance-Zahlen
misst du im Buffer-Dashboard.

### Buffer-Integration

`api/buffer.js` ist eine Node-Serverless-Function und spricht die
Buffer-GraphQL-API (`POST https://api.buffer.com`, exakt nach
[developers.buffer.com](https://developers.buffer.com)). Der
**`BUFFER_API_KEY` bleibt ausschließlich serverseitig** — er taucht nirgends
im Client-Bundle auf.

```bash
# Vercel → Project Settings → Environment Variables
BUFFER_API_KEY=dein_key_hier        # publish.buffer.com → Settings → API (zeigt sich nur einmal!)
```

Setup in 3 Schritten:

1. Konto unter [publish.buffer.com](https://publish.buffer.com) anlegen
   (Free reicht: 3 Kanäle, 10 geplante Posts/Kanal).
2. Unter **Channels** Kanäle verbinden (TikTok/Instagram/YouTube u. a.),
   dann **Settings → API → Generate API key**.
3. Key als `BUFFER_API_KEY` in Vercel setzen, neu deployen, in der App auf
   **SYNC** tippen (📦 Buffer-Kanäle-Panel).

Ablauf pro Video:

1. **Hosting:** Buffer hat *keinen* Upload-Endpoint — Videos müssen unter
   einer öffentlichen, stabilen HTTPS-URL liegen (Doku: „Hosting Media").
   Die App lädt Render-Bytes daher vorab in den Supabase-`renders`-Bucket
   (`buffer/…`-Pfad) und übergibt die Public-URL. Dateien dort nicht
   löschen, solange Posts geplant sind!
2. **Create:** `createPost` pro Kanal (Buffer erlaubt nur *eine* channelId
   pro Mutation — der Server fächert 1 Video × N Kanäle automatisch auf):
   `schedulingType: automatic`, `mode: shareNow` (Sofort) bzw.
   `customScheduled + dueAt` (Slots, ISO UTC, Zukunft), dazu
   `assets: [{ video: { url } }]` mit `thumbnailOffset` für IG/TikTok.
3. **Pflicht-Metadaten** setzt der Server automatisch: YouTube
   `title` (≤100) + `categoryId: 22` + `privacy: public`, Instagram
   `type: reel` + `shouldShareToFeed: true`.
4. **Status:** `posts`-Query pollen (scheduled → sent/error); Teilfehler
   einzelner Kanäle werden pro Ziel gemeldet, nie als Erfolg maskiert.

**Voreinstellungen:** Plattformen, Kanal-Mapping je Plattform
(`bufferAccountIds`), Modus, Caption, Hashtags und Plan-Zeiten gelten für
POST und POST ALL; der Autopilot hat eigene Einstellungen in seinem Panel.
Ohne Key wird lokal zwischengespeichert statt zu scheitern.

### Autopilot (Auto-Modus)

Ein Klick auf **Autopilot starten** — danach läuft alles **ohne Nachfrage und
ohne Klick**: Titel sichern (fehlende schreibt die KI), Scripts + Voices,
Rendern, jedes fertige Video im Stunden-Limit an Buffer schicken, nächste
Runde mit frischen Ideen und neu geslicten Clips. Stopp nur per **STOP**.

* **Limit (voreingestellt): 10 Videos/Stunde, frei 1–100** — drosselt den
  Buffer-Versand (gleichmäßiger Abstand + hartes 60-Min-Fenster); gerendert
  wird durchgehend, der Rest wartet in der Queue (Rückstau-Schutz bei 30).
* **Modi:** Sofort posten oder Slots planen (06:00 & 20:00 Berlin).
* **Robustheit:** 3 Versuche pro Video, Protokoll im Panel, Live-Status-Polling,
  Wake-Lock gegen Display-Schlaf.
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
| Posting | Browser → same-origin `/api/buffer` (Node) ⇄ Buffer GraphQL (`createPost`, `posts`) — key stays server-side, videos hosted in the public Supabase `renders` bucket |
| Autopilot | In-browser loop: ideas → prepare → render → throttled dispatch (1–100/h) → next round, zero clicks |
| Your files | Never uploaded — read straight from device memory (except the videos you post) |

Rendering is real-time: a 40-second voice takes ~40 seconds per unit, and the
tab must stay in the foreground (that's how MediaRecorder captures frames).

## Project layout

```
src/
├─ App.tsx                     orchestrator: prepare → render → zip → buffer · autopilot loops
├─ components/
│  ├─ Header.tsx               LEDs, clock, marquee
│  ├─ SettingsPanel.tsx        5-tab settings console
│  ├─ Controls.tsx             sliders, toggles, segmented, colour swatches
│  ├─ IdeasPanel.tsx           the 10 numbered inputs
│  ├─ ClipMill.tsx             1-source slicing + link intake + 10-file mode
│  ├─ Uploaders.tsx            soundtrack deck
│  ├─ MissionControl.tsx       prepare/render buttons · unit cards · ZIP bay · post all
│  ├─ AutopilotPanel.tsx       auto-mode console: limit 1–100/h, stats, event log
│  ├─ DashboardStats.tsx       dashboard header: today · planned · published · hourly limit
│  ├─ BufferAccounts.tsx       buffer channels + org + post-all prefs (channel mapping)
│  └─ PostsCalendar.tsx        month/week/day calendar · reschedule · cancel
└─ lib/
   ├─ settings.ts   llm.ts   tts.ts   renderer.ts   clips.ts   media.ts   types.ts
   ├─ posts.ts      provider-neutral core: post types, local cache, prefs, slots, display helpers
   ├─ buffer.ts     buffer client: channels, posts via /api/buffer (cache+slots)
   ├─ autopilot.ts  auto-mode config, hourly throttle, dispatch log, stats
   └─ upload.ts     supabase hosting for Buffer (public video URLs)

api/        ← tts relay + buffer route + gate (Vercel Serverless, Node.js runtime)
server/     ← gate-core.js: geteilte Gate-Logik (Password-Check, HMAC-Session, 401-Guard)
supabase/   ← inert legacy v1 (hosted Edge Functions + Shotstack), unused
            (nur der „renders"-Bucket lebt: Buffer-Pflicht-Hosting)
```

— No ffmpeg. No mercy.

# ShortsFactory — Clip Mill Edition

**One clip in. Ten shorts out.** A video assembly line that runs **100 % in your
browser**: no server, no cloud render farm — just a local ffmpeg.wasm pass for
the final constant-frame-rate encode. Feed it one long
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
| **VIDEO** | Resolution (auto / 540 / 720 / 1080), **frame rate fixed at 60 FPS**, bitrate, vignette, slow Ken-Burns zoom, **Auto-Qualität bei <60-FPS-Quellen**, Intro-Karte, fixe Videobeschreibung |
| **CLIPS** | Distribution mode, clip length mode + fixed length, skip intro, skip outro |

## Delivery rules (nicht verhandelbar)

Drei Dinge gelten für **jeden** Clip, egal was in den Settings steht:

### 1 · Exakt 60 FPS

`src/lib/settings.ts` → `TARGET_FPS = 60`. Der Regler 24/30 ist weg; gespeicherte
Alt-Einstellungen werden beim Laden auf 60 normalisiert. Der Weg dorthin:

* Canvas-Capture mit `captureStream(60)`
* After-Pass in `src/lib/cfr.ts`: `ffmpeg -r 60 -vsync cfr` → **echt konstante**
  Frame-Abstände (kein VFR, wie es Browser bei Rucklern/GC-Pausen sonst produzieren)
* `libx264 -preset ultrafast -crf 20`, `yuv420p`, `+faststart` → TikTok-/Reels-tauglich

### 2 · Quelle zu langsam? Qualität automatisch hoch

`src/lib/media.ts → measureVideoFps()` misst die Bildrate des Uploads real
(`requestVideoFrameCallback` über ~0,85 s Wiedergabe, Fallback
`getVideoPlaybackQuality`, Fallback „unbekannt“ = kein Boost). Liegt die Quelle
unter `LOW_FPS_CEILING` (57), hebt `src/lib/quality.ts → planRenderQuality()` pro
Einheit an:

| Quelle | Auflösung | Bitrate | Encoder |
| --- | --- | --- | --- |
| ≥ 57 FPS | wie eingestellt | wie eingestellt | CRF 20 |
| < 57 FPS (24/25/30) | einen Schritt rauf (Desktop → 1080p, Handy → 720p) | eine Stufe rauf | **CRF 17 + Unsharp** |

Der Boost ist sichtbar: Clip-Mill zeigt die gemessene FPS der Quelle, fertige
Einheiten bekommen ein `60 FPS`- und ein `BOOST`-Badge. Abschaltbar unter
Settings → VIDEO → „AUTO-QUALITÄT BEI WENIGER QUELLEN-FPS".

### 3 · Jedes Video startet mit der Reddit-Intro-Karte

`src/lib/intro.ts` malt eine Vollbild-Karte im Reddit-Look auf dieselbe Canvas —
Avatar + `r/Stories`-Zeile, **der Titel der jeweiligen Story**, die Hook-Zeile
und eine Up-/Comment-/Share-Zeile mit stabilen (aus dem Titel abgeleiteten)
Zahlen. Standardmäßig **1,5 s**, dann weicht die Karte zum Clip.

* Stimme, Untertitel **und** Clip-Fenster starten um die Intro-Dauer versetzt —
  der Hintergrund-Clip läuft also nicht 1,5 s „leer" mit, sondern setzt exakt mit
  dem ersten Wort ein
* einstellbar: An/Aus, Dauer 0,3–3,0 s, Subreddit-Zeile, Hook-Text (Live-Loop-Vorschau in den Settings)

### 4 · Einheitliche Videobeschreibung

`FIXED_VIDEO_DESCRIPTION` in `src/lib/settings.ts` wird **jedes** Video beim
Posten über Buffer **und** Zernio mit exakt diesem Text (inkl. Leerzeilen und
beider Hashtag-Blöcke) veröffentlichen; die Felder in den Post-Editoren zeigen
ihn nur noch, ändern kann man ihn nicht mehr.

No API keys? The built-in **offline story writer** takes over — full-length
first-person stories with zero network.

## One-Page Dashboard (Buffer)

Alles liegt auf **einer** Seite. Auf Desktop/iPad läuft ein Split-Screen:

```
┌─ Dashboard: Heute · Geplant · Veröffentlicht · Views · Engagement ─┐
├──────────────────────────┬────────────────────────────────────────┤
│ LINKS · Video Factory    │ RECHTS · Social                        │
│ Settings · Titel         │ Social Accounts (aus Buffer)           │
│ Clip Mill · Musik        │ Content Kalender (Monat/Woche/Tag)      │
│ Assembly · Output Bay    │ Analytics (Heute/7/30/90 Tage)          │
└──────────────────────────┴────────────────────────────────────────┘
```

Beide Spalten scrollen unabhängig. Auf dem Smartphone stapelt sich alles
automatisch untereinander, mit einer horizontal scrollbaren Sektions-Navigation
(🎬 Create · 📤 Post · 📅 Calendar · 📊 Analytics · ⚙ Settings). Der Header ist
sticky, die Sprungziele scrollen sanft.

### Buffer-Integration

`api/buffer.js` ist eine Node-Serverless-Function und spricht Buffers GraphQL-API
unter `https://api.buffer.com`. Der **`BUFFER_API_KEY` bleibt ausschließlich
serverseitig** — er taucht nirgends im Client-Bundle auf.

```bash
# Vercel → Project Settings → Environment Variables
BUFFER_API_KEY=dein_key            # publish.buffer.com/settings/api
BUFFER_ORGANIZATION_ID=optional
```

Unterstützte Aktionen: `channels`, `posts`, `create`, `createBatch`, `delete`,
`status`, `analytics`.

| Modus im Post-Editor | Buffer |
| --- | --- |
| Jetzt posten | `mode: shareNow` |
| Buffer Queue | `mode: addToQueue` |
| Benutzerdefiniert | `mode: customScheduled` + `dueAt` (ISO, Zeitzone wählbar) |
| Automatisch planen | freie Slots → `customScheduled` |

**Multi-Plattform:** Pro ausgewähltem Kanal wird ein eigener Buffer-Post
erzeugt (Buffer erlaubt nur eine `channelId` pro Mutation). YouTube bekommt ein
eigenes Titelfeld. Teilfehler werden pro Kanal einzeln gemeldet — nie als
Erfolg maskiert; fehlgeschlagene Posts sind im Kalender rot und lassen sich dort
erneut versuchen.

**Automatischer Planer:** Posts/Tag, beliebig viele Wunschzeiten, Anzahl Tage
und Zeitzone (Standard `Europe/Berlin`). Belegte Slots werden übersprungen,
nie doppelt belegt.

### Erweiterte Musik- & Video-Optionen

Alle neuen Regler sind **additiv** — die Defaults entsprechen exakt dem
bisherigen Verhalten:

* **Musik:** An/Aus, Gesamt-Lautstärke, Original-Audio des Clips, Ducking
  (Stärke + Geschwindigkeit), Startpunkt (Anfang / nach Intro / zufällig /
  benutzerdefiniert), Ende (mit Video / Fade-Out mit Länge)
* **Video:** Format 9:16 · 16:9 · 1:1, Untertitel-Stil (Standard / Bold /
  Minimal / Highlight), Größe (klein/mittel/groß), Position (oben/mitte/unten)

## Social Dispatch — posten & planen (Zernio, bisheriges System)

Die frühere Zernio-Planung bleibt vollständig erhalten und ist am Seitenende
unter „ZERNIO-PLANUNG (BISHERIGES SYSTEM)" einklappbar erreichbar.


Alles liegt auf **einer Seite**: Produktion oben, Dashboard + Kalender direkt
darunter (`📅 Kalender` im Header springt hin).

Der **Post**-Button sitzt auf jeder fertigen Video-Karte und in der Output-Bay.
Im Modal wählst du den Modus:

| Modus | Verhalten |
| --- | --- |
| **Jetzt posten** | Sofortige Veröffentlichung (`publishNow`), leicht gestaffelt gegen Rate-Limits |
| **Auto-Plan** | 06:00 & 20:00 Uhr über die nächsten freien Tage — belegte Slots werden übersprungen |
| **Frei planen** | Eigene Uhrzeiten (`09:15, 13:00, 18:45`), Startdatum, Rhythmus (täglich … wöchentlich) |

Anzahl der Posts ist frei wählbar (1–40). Alle Zeiten laufen in
**Europe/Berlin**, kein Slot wird je doppelt belegt.

Der `ZERNIO_API_KEY` lebt ausschließlich serverseitig in `api/zernio.js`
(Vercel Env-Variable) und erreicht den Browser nie. Ohne Key läuft alles im
lokalen Simulations-Modus weiter.

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
| Your files | Never uploaded — read straight from device memory |

Rendering is real-time: a 40-second voice takes ~40 seconds per unit, and the
tab must stay in the foreground (that's how MediaRecorder captures frames).

## Project layout

```
src/
├─ App.tsx                     orchestrator: prepare → render → zip
├─ components/
│  ├─ Header.tsx               LEDs, clock, marquee
│  ├─ SettingsPanel.tsx        5-tab settings console
│  ├─ Controls.tsx             sliders, toggles, segmented, colour swatches
│  ├─ IdeasPanel.tsx           the 10 numbered inputs
│  ├─ ClipMill.tsx             1-source slicing + link intake + 10-file mode
│  ├─ Uploaders.tsx            soundtrack deck
│  └─ MissionControl.tsx       prepare/render buttons · unit cards · ZIP bay
└─ lib/
   ├─ settings.ts   llm.ts   tts.ts   renderer.ts   clips.ts   media.ts   types.ts

api/        ← tts relay (Vercel Serverless Function, Node.js runtime + ws)
supabase/   ← inert legacy v1 (hosted Edge Functions + Shotstack), unused
```

— No server. No render farm. No mercy. (The only ffmpeg in here is the wasm one
that makes your file a real 60 FPS.)

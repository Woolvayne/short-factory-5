import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import {
  ArrowDown,
  Captions,
  Clapperboard,
  Cpu,
  FileArchive,
  Film,
  HardDrive,
  Mic,
  Radio,
  ShieldCheck,
  Wifi,
} from "lucide-react";
import Header from "./components/Header";
import CalendarView from "./components/CalendarView";
import PostScheduleModal from "./components/PostScheduleModal";
import BufferPostEditor from "./components/BufferPostEditor";
import BufferCalendar from "./components/BufferCalendar";
import { AnalyticsPanel, DashboardStats, SocialAccounts } from "./components/SocialHub";
import type { NavSection } from "./components/Header";
import IdeasPanel from "./components/IdeasPanel";
import SettingsPanel from "./components/SettingsPanel";
import ClipMill, { type FetchState, type SourceMode } from "./components/ClipMill";
import { MusicPanel } from "./components/Uploaders";
import {
  AssemblyPanel,
  OutputPanel,
  videoFileName,
  type ZipState,
} from "./components/MissionControl";
import type { BgFile, LocalRenderItem, MusicFile, Phase, VoiceTake } from "./lib/types";
import {
  formatClock,
  isPortrait916,
  probeAudio,
  probeVideo,
  shuffle,
  sleep,
  uid,
} from "./lib/media";
import {
  TARGET_FPS,
  hasAnyLLMKey,
  introDuration,
  loadSettings,
  saveSettings,
  styleInstruction,
  type Settings,
} from "./lib/settings";
import { planRenderQuality } from "./lib/quality";
import { generateIdeas, generateStory } from "./lib/llm";
import {
  assetToFile,
  clearKind,
  deleteAsset,
  getAssetsByKind,
  patchAssetMeta,
  putAsset,
} from "./lib/storage";
import {
  fetchScheduledPosts,
  loadLocalPosts,
  type ScheduledPost,
} from "./lib/scheduler";
import {
  fetchChannels,
  fetchPosts as fetchBufferPosts,
  loadCachedPosts,
  type AnalyticsTotals,
  type BufferChannel,
  type BufferPost,
} from "./lib/buffer";
import { synthesizeSpeech } from "./lib/tts";
import { recorderSupported, renderLocal } from "./lib/renderer";
import {
  detectPlatform,
  fetchRemoteVideo,
  planClips,
  probeUrl,
  rerollClip,
  type ClipPlan,
  type ClipSource,
} from "./lib/clips";

const INITIAL_IDEAS = Array.from({ length: 10 }, () => "");
const IDLE_ZIP: ZipState = {
  active: false,
  done: 0,
  total: 0,
  url: null,
  name: null,
  size: 0,
  error: null,
};
const IDLE_FETCH: FetchState = {
  active: false,
  received: 0,
  total: 0,
  error: null,
  platform: null,
};

type AnyAudioContext = typeof AudioContext;

export default function App() {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [ideas, setIdeas] = useState<string[]>(INITIAL_IDEAS);

  /* clip mill */
  const [mode, setMode] = useState<SourceMode>("single");
  const [source, setSource] = useState<ClipSource | null>(null);
  const [clips, setClips] = useState<ClipPlan[]>([]);
  const [link, setLink] = useState("");
  const [fetchState, setFetchState] = useState<FetchState>(IDLE_FETCH);
  const [bgs, setBgs] = useState<BgFile[]>([]);

  const [tracks, setTracks] = useState<MusicFile[]>([]);

  const [phase, setPhase] = useState<Phase>("idle");
  const [items, setItems] = useState<LocalRenderItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [zip, setZip] = useState<ZipState>(IDLE_ZIP);
  const [elapsed, setElapsed] = useState(0);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [activeProgress, setActiveProgress] = useState(0);
  const [ideaGenAll, setIdeaGenAll] = useState(false);
  const [ideaGenIndex, setIdeaGenIndex] = useState<number | null>(null);

  /* social scheduling */
  const [scheduledPosts, setScheduledPosts] = useState<ScheduledPost[]>(() => loadLocalPosts());
  const [hasZernioKey, setHasZernioKey] = useState(false);
  const [postModalItems, setPostModalItems] = useState<LocalRenderItem[] | null>(null);
  const [vaultReady, setVaultReady] = useState(false);

  /* buffer social layer */
  const [bufferPosts, setBufferPosts] = useState<BufferPost[]>(() => loadCachedPosts());
  const [channels, setChannels] = useState<BufferChannel[]>([]);
  const [bufferKey, setBufferKey] = useState(false);
  const [bufferLoading, setBufferLoading] = useState(false);
  const [bufferError, setBufferError] = useState<string | null>(null);
  const [analyticsTotals, setAnalyticsTotals] = useState<AnalyticsTotals | null>(null);
  const [editorItems, setEditorItems] = useState<LocalRenderItem[] | null>(null);

  const factoryRef = useRef<HTMLDivElement>(null);
  const calendarRef = useRef<HTMLDivElement>(null);
  const postRef = useRef<HTMLDivElement>(null);
  const analyticsRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);

  const bgsRef = useRef(bgs);
  bgsRef.current = bgs;
  const itemsRef = useRef<LocalRenderItem[]>([]);
  itemsRef.current = items;
  const voicesRef = useRef<Map<number, VoiceTake>>(new Map());
  const clipsRef = useRef<ClipPlan[]>([]);
  clipsRef.current = clips;
  const sourceRef = useRef<ClipSource | null>(null);
  sourceRef.current = source;
  const zipUrlRef = useRef<string | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const cancelRef = useRef<{ cancelled: boolean }>({ cancelled: false });

  useEffect(() => saveSettings(settings), [settings]);

  /* ---- hydrate background clips + music from the local asset vault ---- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [bgAssets, musicAssets] = await Promise.all([
          getAssetsByKind("background"),
          getAssetsByKind("music"),
        ]);
        if (cancelled) return;

        if (bgAssets.length > 0) {
          setBgs(
            bgAssets.map((a) => ({
              id: a.id,
              file: assetToFile(a),
              width: a.meta?.width ?? 0,
              height: a.meta?.height ?? 0,
              duration: a.meta?.duration ?? 0,
              fps: typeof a.meta?.fps === "number" ? a.meta.fps : null,
              status: "ready" as const,
            }))
          );
        }

        if (musicAssets.length > 0) {
          const anySelected = musicAssets.some((a) => a.meta?.selected);
          setTracks(
            musicAssets.map((a, i) => ({
              id: a.id,
              file: assetToFile(a),
              duration: a.meta?.duration ?? 0,
              selected: anySelected ? Boolean(a.meta?.selected) : i === 0,
            }))
          );
        }
      } catch (e) {
        console.warn("asset vault hydration failed", e);
      } finally {
        if (!cancelled) setVaultReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* ---- load scheduled posts + Zernio key status ---- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { posts, hasApiKey } = await fetchScheduledPosts();
      if (cancelled) return;
      setScheduledPosts(posts);
      setHasZernioKey(hasApiKey);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* ---- Buffer: load channels + posts (Buffer is the source of truth) ---- */
  const syncBuffer = useCallback(async () => {
    setBufferLoading(true);
    try {
      const [ch, po] = await Promise.all([fetchChannels(), fetchBufferPosts()]);
      setChannels(ch.channels.length ? ch.channels : po.channels);
      setBufferKey(ch.hasApiKey || po.hasApiKey);
      setBufferPosts(po.posts);
      setBufferError(ch.error ?? po.error ?? null);
    } catch (e) {
      setBufferError(e instanceof Error ? e.message : String(e));
    } finally {
      setBufferLoading(false);
    }
  }, []);

  useEffect(() => {
    void syncBuffer();
  }, [syncBuffer]);

  const jumpTo = useCallback((section: NavSection) => {
    const map: Record<NavSection, React.RefObject<HTMLDivElement | null>> = {
      create: factoryRef,
      post: postRef,
      calendar: calendarRef,
      analytics: analyticsRef,
      settings: settingsRef,
    };
    map[section]?.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const busy = phase === "preparing" || phase === "rendering";

  useEffect(() => {
    if (!busy) return;
    const t = window.setInterval(() => {
      if (startedAtRef.current) setElapsed((Date.now() - startedAtRef.current) / 1000);
    }, 1000);
    return () => window.clearInterval(t);
  }, [busy]);

  const ensureAudioCtx = useCallback(async () => {
    if (!audioCtxRef.current) {
      const AC: AnyAudioContext =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: AnyAudioContext }).webkitAudioContext;
      audioCtxRef.current = new AC();
    }
    try {
      await audioCtxRef.current.resume();
    } catch {
      /* best effort */
    }
    return audioCtxRef.current;
  }, []);

  /* ------------------------------------------------------------ */
  /*  clip mill — one source → 10 windows                          */
  /* ------------------------------------------------------------ */

  const adoptSource = useCallback(
    async (file: File, origin: "file" | "url", displayName?: string) => {
      const url = URL.createObjectURL(file);
      try {
        /* one probe per source — includes a measured frame rate, which decides
           whether the automatic quality boost has to kick in */
        const meta = await probeVideo(file, { measureFps: true });
        const src: ClipSource = {
          id: uid(),
          name: displayName ?? file.name,
          origin,
          file,
          url,
          duration: meta.duration,
          width: meta.width,
          height: meta.height,
          size: file.size,
          portrait: isPortrait916(meta.width, meta.height),
          fps: meta.fps,
        };
        setSource((prev) => {
          if (prev?.url) URL.revokeObjectURL(prev.url);
          return src;
        });
        setClips(planClips(src, settings));
        setFetchState(IDLE_FETCH);
      } catch (e) {
        URL.revokeObjectURL(url);
        setFetchState({
          ...IDLE_FETCH,
          error: e instanceof Error ? e.message : "Could not read that video",
        });
      }
    },
    [settings]
  );

  const loadLink = useCallback(async () => {
    const url = link.trim();
    if (!url) return;

    const platform = detectPlatform(url);
    if (platform) {
      setFetchState({ ...IDLE_FETCH, platform });
      return;
    }

    setFetchState({ active: true, received: 0, total: 0, error: null, platform: null });
    try {
      await probeUrl(url); // fail fast on CORS / wrong content
      const { blob, name } = await fetchRemoteVideo(url, (received, total) =>
        setFetchState((s) => ({ ...s, received, total }))
      );
      const file = new File([blob], name, { type: blob.type || "video/mp4" });
      await adoptSource(file, "url", name);
      setLink("");
    } catch (e) {
      setFetchState({
        ...IDLE_FETCH,
        error:
          (e instanceof Error ? e.message : "Download failed") +
          " — the host must allow cross-origin requests. Download the file and pick it on the left instead.",
      });
    }
  }, [link, adoptSource]);

  const clearSource = useCallback(() => {
    setSource((prev) => {
      if (prev?.url) URL.revokeObjectURL(prev.url);
      return null;
    });
    setClips([]);
    setFetchState(IDLE_FETCH);
  }, []);

  const reslice = useCallback(() => {
    if (source) setClips(planClips(source, settings));
  }, [source, settings]);

  const reroll = useCallback(
    (id: string) => {
      if (!source) return;
      setClips((prev) => prev.map((c) => (c.id === id ? rerollClip(c, source, settings) : c)));
    },
    [source, settings]
  );

  /* ------------------------------------------------------------ */
  /*  multi-file intake                                            */
  /* ------------------------------------------------------------ */

  const patchBg = useCallback((id: string, patch: Partial<BgFile>) => {
    setBgs((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }, []);

  const addBackgrounds = useCallback(
    async (files: File[]) => {
      const remaining = 10 - bgsRef.current.length;
      const picked = files
        .filter((f) => f.type.startsWith("video/") || /\.(mp4|mov|m4v)$/i.test(f.name))
        .slice(0, Math.max(0, remaining));
      for (const file of picked) {
        const entry: BgFile = {
          id: uid(),
          file,
          width: 0,
          height: 0,
          duration: 0,
          fps: null,
          status: "validating",
        };
        setBgs((prev) => (prev.length < 10 ? [...prev, entry] : prev));
        try {
          const meta = await probeVideo(file, { measureFps: true });
          if (!isPortrait916(meta.width, meta.height)) {
            patchBg(entry.id, {
              ...meta,
              status: "error",
              reason: `NOT 9:16 — ${meta.width}×${meta.height}`,
            });
            continue;
          }
          patchBg(entry.id, { ...meta, status: "ready" });
          void putAsset({
            id: entry.id,
            kind: "background",
            name: file.name,
            type: file.type || "video/mp4",
            size: file.size,
            blob: file,
            meta: {
              width: meta.width,
              height: meta.height,
              duration: meta.duration,
              fps: meta.fps,
            },
            createdAt: Date.now(),
          });
        } catch (e) {
          patchBg(entry.id, {
            status: "error",
            reason: e instanceof Error ? e.message.slice(0, 60).toUpperCase() : "UNREADABLE",
          });
        }
      }
    },
    [patchBg]
  );

  const addTracks = useCallback(async (files: File[]) => {
    const audios = files.filter(
      (f) => f.type.startsWith("audio/") || /\.(mp3|m4a|aac|wav)$/i.test(f.name)
    );
    for (const file of audios) {
      const duration = await probeAudio(file);
      const id = uid();
      let isFirst = false;
      setTracks((prev) => {
        isFirst = prev.length === 0;
        return [...prev, { id, file, duration, selected: isFirst }];
      });
      void putAsset({
        id,
        kind: "music",
        name: file.name,
        type: file.type || "audio/mpeg",
        size: file.size,
        blob: file,
        meta: { duration, selected: isFirst },
        createdAt: Date.now(),
      });
    }
  }, []);

  /* ------------------------------------------------------------ */
  /*  idea engine — AI-written story titles                        */
  /* ------------------------------------------------------------ */

  const storyCfg = useCallback(
    () => ({
      qwenKey: settings.qwenKey,
      mistralKey: settings.mistralKey,
      words: settings.storyWords,
      temperature: settings.temperature,
      styleInstruction: styleInstruction(settings),
    }),
    [settings]
  );

  const generateAllIdeas = useCallback(async () => {
    if (ideaGenAll || ideaGenIndex !== null) return;
    setIdeaGenAll(true);
    setError(null);
    try {
      const { ideas: fresh } = await generateIdeas(10, storyCfg());
      setIdeas((prev) => prev.map((old, i) => fresh[i] ?? old));
    } catch (e) {
      setError(
        `Could not write titles: ${e instanceof Error ? e.message : e}. Try the SAMPLES button.`
      );
    } finally {
      setIdeaGenAll(false);
    }
  }, [ideaGenAll, ideaGenIndex, storyCfg]);

  const generateOneIdea = useCallback(
    async (index: number) => {
      if (ideaGenAll || ideaGenIndex !== null) return;
      setIdeaGenIndex(index);
      setError(null);
      try {
        const { ideas: fresh } = await generateIdeas(3, storyCfg());
        const taken = new Set(ideas.filter((_, i) => i !== index));
        const pick = fresh.find((f) => !taken.has(f)) ?? fresh[0];
        if (pick) setIdeas((prev) => prev.map((old, i) => (i === index ? pick : old)));
      } catch (e) {
        setError(`Could not write that title: ${e instanceof Error ? e.message : e}`);
      } finally {
        setIdeaGenIndex(null);
      }
    },
    [ideaGenAll, ideaGenIndex, ideas, storyCfg]
  );

  /* ------------------------------------------------------------ */
  /*  readiness                                                    */
  /* ------------------------------------------------------------ */

  const readyBgs = useMemo(() => bgs.filter((b) => b.status === "ready"), [bgs]);
  const musicFile = useMemo(() => tracks.find((t) => t.selected)?.file ?? null, [tracks]);
  const ideasReady = ideas.every((i) => i.trim().length > 2);
  const footageReady = mode === "single" ? !!source && clips.length === 10 : readyBgs.length === 10;

  const blockers = useMemo(() => {
    const out: string[] = [];
    if (!ideasReady) out.push("FILL ALL 10 IDEAS");
    if (!footageReady)
      out.push(mode === "single" ? "LOAD A SOURCE VIDEO" : `${readyBgs.length}/10 CLIPS LOADED`);
    if (!recorderSupported()) out.push("BROWSER CANNOT RECORD VIDEO");
    return out;
  }, [ideasReady, footageReady, mode, readyBgs.length]);

  const canPrepare = blockers.length === 0;

  const patchItem = useCallback((index: number, patch: Partial<LocalRenderItem>) => {
    setItems((prev) => prev.map((r) => (r.index === index ? { ...r, ...patch } : r)));
  }, []);

  /* ------------------------------------------------------------ */
  /*  STEP ① prepare — scripts + voices only                       */
  /* ------------------------------------------------------------ */

  const prepare = useCallback(async () => {
    if (!canPrepare || busy) return;
    setError(null);
    setZip(IDLE_ZIP);
    for (const it of itemsRef.current) if (it.blobUrl) URL.revokeObjectURL(it.blobUrl);
    if (zipUrlRef.current) {
      URL.revokeObjectURL(zipUrlRef.current);
      zipUrlRef.current = null;
    }
    voicesRef.current.clear();
    cancelRef.current = { cancelled: false };
    startedAtRef.current = Date.now();
    setElapsed(0);
    setPhase("preparing");

    const seeded: LocalRenderItem[] = ideas.map((idea, index) => ({
      index,
      idea: idea.trim(),
      status: "script",
    }));
    setItems(seeded);
    await ensureAudioCtx();

    const cfg = {
      qwenKey: settings.qwenKey,
      mistralKey: settings.mistralKey,
      words: settings.storyWords,
      temperature: settings.temperature,
      styleInstruction: styleInstruction(settings),
    };

    const queue = seeded.map((_, i) => i);
    const worker = async (lane: number) => {
      if (lane) await sleep(600);
      while (queue.length > 0) {
        if (cancelRef.current.cancelled) return;
        const index = queue.shift()!;
        try {
          patchItem(index, { status: "script" });
          const story = await generateStory(seeded[index].idea, index % 2 === 0, cfg);
          patchItem(index, { story: story.text, provider: story.provider, status: "voice" });

          const take = await synthesizeSpeech(
            story.text,
            settings.voice,
            settings.rate,
            settings.pitch
          );
          if (!take.audio.byteLength) throw new Error("voice engine returned no audio");
          voicesRef.current.set(index, take);
          patchItem(index, { status: "staged", voiceDuration: take.duration });
        } catch (e) {
          patchItem(index, {
            status: "error",
            error: String(e instanceof Error ? e.message : e).slice(0, 220),
          });
        }
      }
    };
    await Promise.all([worker(0), worker(1)]);

    /* re-slice with the real voice lengths so clips match the stories */
    const src = sourceRef.current;
    if (src && settings.clipLengthMode === "auto") {
      const lengths = itemsRef.current.map((it) => it.voiceDuration ?? 35);
      setClips(planClips(src, settings, 10, lengths));
    }

    const staged = itemsRef.current.filter((i) => i.status === "staged").length;
    setPhase(staged > 0 ? "staged" : "failed");
    if (staged === 0)
      setError("Nothing could be prepared — voice synthesis needs an internet connection.");
  }, [canPrepare, busy, ideas, settings, patchItem, ensureAudioCtx]);

  /* ------------------------------------------------------------ */
  /*  STEP ② render — explicit, per unit or all                    */
  /* ------------------------------------------------------------ */

  /** the intro card always shows this unit's own title */
  const seededTitleFor = useCallback(
    (index: number) =>
      itemsRef.current.find((i) => i.index === index)?.idea?.trim() ||
      ideas[index]?.trim() ||
      "",
    [ideas]
  );

  const renderIndexes = useCallback(
    async (indexes: number[]) => {
      if (indexes.length === 0 || busy) return;
      setError(null);
      cancelRef.current = { cancelled: false };
      if (!startedAtRef.current) startedAtRef.current = Date.now();
      setPhase("rendering");

      const ac = await ensureAudioCtx();
      /* files mode keeps the whole BgFile so each unit can be planned against
         the frame rate of the exact clip it ended up on */
      const dealt = mode === "files" ? shuffle([...readyBgs]) : [];

      for (const index of indexes) {
        if (cancelRef.current.cancelled) break;
        const take = voicesRef.current.get(index);
        if (!take) continue;

        const clip = clipsRef.current.find((c) => c.index === index);
        const src = sourceRef.current;
        const bgUrl = mode === "single" ? src?.url : undefined;
        const bgForIndex = mode === "files" ? dealt[index] : undefined;
        const fileForIndex = bgForIndex?.file;
        let tempUrl: string | null = null;
        if (!bgUrl && fileForIndex) tempUrl = URL.createObjectURL(fileForIndex);

        const useUrl = bgUrl ?? tempUrl;
        if (!useUrl) continue;

        /* exactly 60 FPS out, always; when the source carries fewer frames the
           plan lifts resolution + bitrate automatically (quality.ts) */
        const sourceFps = mode === "single" ? (src?.fps ?? null) : (bgForIndex?.fps ?? null);
        const plan = planRenderQuality(settings, sourceFps);
        const { width, height } = plan;

        setActiveIndex(index);
        setActiveProgress(0);
        patchItem(index, { status: "rendering", error: undefined });

        try {
          const result = await renderLocal({
            bgUrl: useUrl,
            clipStart: mode === "single" ? (clip?.start ?? 0) : Math.random() * 3,
            voiceMp3: take.audio,
            words: take.words,
            musicFile,
            width,
            height,
            audioCtx: ac,
            settings: plan.settings,
            introTitle: seededTitleFor(index),
            sourceFps,
            qualityBoost: plan.boost,
            signal: cancelRef.current,
            onProgress: setActiveProgress,
          });
          const prevUrl = itemsRef.current.find((i) => i.index === index)?.blobUrl;
          if (prevUrl) URL.revokeObjectURL(prevUrl);
          patchItem(index, {
            status: "done",
            blob: result.blob,
            blobUrl: URL.createObjectURL(result.blob),
            mime: result.mimeType,
            size: result.blob.size,
            duration: result.duration,
            clipStart: clip?.start,
            fps: result.fps,
            introSeconds: result.introSeconds,
            fpsBoosted: result.qualityBoost,
            sourceFps,
          });
        } catch (e) {
          patchItem(index, {
            status: "error",
            error: String(e instanceof Error ? e.message : e).slice(0, 220),
          });
        } finally {
          if (tempUrl) URL.revokeObjectURL(tempUrl);
        }
      }

      setActiveIndex(null);
      setActiveProgress(0);

      const snapshot = itemsRef.current;
      const done = snapshot.filter((i) => i.status === "done").length;
      const stagedLeft = snapshot.filter((i) => i.status === "staged").length;
      setPhase(
        done === 10
          ? "ready"
          : stagedLeft > 0
            ? "staged"
            : done > 0
              ? "partial"
              : "failed"
      );
    },
    [busy, ensureAudioCtx, settings, mode, readyBgs, musicFile, patchItem]
  );

  const renderAll = useCallback(() => {
    const targets = itemsRef.current
      .filter((i) => i.status === "staged")
      .map((i) => i.index);
    void renderIndexes(targets);
  }, [renderIndexes]);

  const renderOne = useCallback(
    (index: number) => {
      void renderIndexes([index]);
    },
    [renderIndexes]
  );

  const cancel = useCallback(() => {
    cancelRef.current.cancelled = true;
  }, []);

  /* ------------------------------------------------------------ */
  /*  zip dispatch                                                 */
  /* ------------------------------------------------------------ */

  const buildZip = useCallback(async () => {
    const dones = itemsRef.current.filter((r) => r.status === "done" && r.blob);
    if (dones.length === 0 || zip.active) return;
    if (zipUrlRef.current) {
      URL.revokeObjectURL(zipUrlRef.current);
      zipUrlRef.current = null;
    }
    setZip({ ...IDLE_ZIP, active: true, total: dones.length });

    try {
      const zipFile = new JSZip();
      for (let i = 0; i < dones.length; i++) {
        zipFile.file(videoFileName(dones[i]), dones[i].blob!);
        setZip((z) => ({ ...z, done: i + 1 }));
        await sleep(0);
      }
      const blob = await zipFile.generateAsync({ type: "blob", compression: "STORE" });
      const url = URL.createObjectURL(blob);
      zipUrlRef.current = url;
      const stamp = new Date().toISOString().slice(11, 16).replace(":", "");
      const name = `shortsfactory_${stamp}.zip`;
      setZip({
        active: false,
        done: dones.length,
        total: dones.length,
        url,
        name,
        size: blob.size,
        error: null,
      });

      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      setZip((z) => ({
        ...z,
        active: false,
        error: String(e instanceof Error ? e.message : e),
      }));
    }
  }, [zip.active]);

  const doneCount = items.filter((r) => r.status === "done").length;
  const errorCount = items.filter((r) => r.status === "error").length;
  const stagedCount = items.filter((r) => r.status === "staged").length;
  const keyed = hasAnyLLMKey(settings);
  const renderProgress = (doneCount + errorCount + activeProgress) / 10;

  /* ------------------------------------------------------------ */

  return (
    <div className="grain relative min-h-dvh bg-coal-950">
      <div className="bg-blueprint pointer-events-none absolute inset-x-0 top-0 h-[560px]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[620px] overflow-hidden">
        <div className="h-14 w-full animate-scan bg-gradient-to-b from-transparent via-ember-500/[0.10] to-transparent" />
      </div>
      <div className="animate-pulse-heat pointer-events-none absolute -top-40 left-1/2 h-[420px] w-[820px] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(255,138,31,0.16),transparent_68%)] blur-2xl" />

      <Header
        phase={phase}
        keyed={keyed}
        scheduledCount={scheduledPosts.length}
        onJump={jumpTo}
      />

      <main
        className="relative z-10 mx-auto max-w-[1500px] px-4 pb-16 sm:px-6"
        style={{ paddingBottom: busy ? "calc(6rem + env(safe-area-inset-bottom))" : undefined }}
      >
        {/* hero */}
        <div className="grid gap-6 pt-8 pb-6 sm:pt-10 sm:pb-8 lg:grid-cols-[1.5fr_1fr] lg:items-end">
          <div className="animate-rise">
            <p className="mono-label mb-4 flex items-center gap-2 text-[10px] text-volt-400">
              <span className="inline-block size-1.5 animate-led rounded-full bg-volt-400 text-volt-400" />
              LINE STATUS: {busy ? "RUNNING" : phase === "staged" ? "LOADED — PRESS RENDER" : "ARMED"}
            </p>
            <h1 className="font-display text-[13vw] leading-[0.86] font-black tracking-[-0.03em] uppercase sm:text-7xl lg:text-[92px]">
              One clip in.
              <br />
              <span className="text-outline">Ten shorts</span>
              <span className="text-heat"> out.</span>
            </h1>
            <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-coal-300">
              Feed it one long background video — it gets sliced into ten different moments, each
              paired with its own AI story, neural voice and word-synced captions. Then you press
              render. Everything happens inside this browser.
            </p>
          </div>

          <div
            className="animate-rise space-y-px border border-coal-700 bg-coal-900/80"
            style={{ animationDelay: "120ms" }}
          >
            {[
              { icon: Cpu, k: "SCRIPT LINES", v: keyed ? "QWEN / MISTRAL · DIRECT" : "OFFLINE WRITER" },
              { icon: Mic, k: "VOICE BENCH", v: "EDGE READ-ALOUD · WEBSOCKET" },
              { icon: Captions, k: "CAPTION JIG", v: "WORD-BOUNDARY TIMINGS" },
              {
                icon: Clapperboard,
                k: "RENDER MILL",
                v: `CANVAS + MEDIARECORDER · ${TARGET_FPS} FPS CFR`,
              },
              {
                icon: Film,
                k: "INTRO JIG",
                v:
                  introDuration(settings) > 0
                    ? `REDDIT CARD · ${introDuration(settings).toFixed(1)} S MIT TITEL`
                    : "DEAKTIVIERT",
              },
              { icon: FileArchive, k: "DISPATCH", v: "JSZIP → BLOB ANCHOR" },
              {
                icon: HardDrive,
                k: "ASSET VAULT",
                v: vaultReady
                  ? `${readyBgs.length} CLIPS · ${tracks.length} TRACKS GESPEICHERT`
                  : "LADE LOKALEN SPEICHER…",
              },
            ].map(({ icon: Icon, k, v }) => (
              <div
                key={k}
                className="flex items-center justify-between gap-3 border-b border-coal-700/60 px-4 py-2.5 last:border-0"
              >
                <div className="flex items-center gap-2.5">
                  <Icon className="size-3.5 shrink-0 text-volt-400" />
                  <span className="mono-label text-[9px] text-coal-400">{k}</span>
                </div>
                <span className="text-right font-mono text-[9.5px] font-medium tracking-wider text-coal-200">
                  {v}
                </span>
              </div>
            ))}
            <div className="belt h-2 w-full opacity-60" />
          </div>
        </div>

        <div className="mb-6 flex items-start gap-2 text-coal-500">
          <ArrowDown className="mt-0.5 size-3.5 shrink-0" />
          <span className="mono-label text-[9px] leading-relaxed">
            TUNE 00 · IDEAS 01 · FOOTAGE 02 · MUSIC 03 — THEN PREPARE AND PRESS RENDER
          </span>
        </div>

        {/* ---------------- Dashboard header stats ---------------- */}
        <div className="mb-5">
          <DashboardStats
            posts={bufferPosts}
            totals={analyticsTotals}
            onCreate={() => jumpTo("create")}
          />
        </div>

        {/* ================= SPLIT SCREEN: Factory | Social ================= */}
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:items-start">
          {/* ---------------- LEFT: video factory ---------------- */}
          <div
            ref={factoryRef}
            className="grid content-start gap-5 scroll-mt-28 xl:max-h-[calc(100vh-7rem)] xl:overflow-y-auto xl:pr-2"
          >
            <div ref={settingsRef} className="scroll-mt-28">
              <SettingsPanel settings={settings} onChange={setSettings} disabled={busy} />
            </div>
            <IdeasPanel
              ideas={ideas}
              onChange={setIdeas}
              onGenerateAll={() => void generateAllIdeas()}
              onGenerateOne={(i) => void generateOneIdea(i)}
              generatingAll={ideaGenAll}
              generatingIndex={ideaGenIndex}
              aiLabel={
                keyed
                  ? "TAP AI ×10 TO LET QWEN / MISTRAL INVENT ALL TEN TITLES — OR ✨ ON A SINGLE ROW."
                  : "NO API KEY YET — AI ×10 USES THE BUILT-IN OFFLINE TITLE BUILDER. ADD A KEY UNDER 00 FOR REAL AI."
              }
              disabled={busy}
            />
            <ClipMill
              mode={mode}
              onModeChange={setMode}
              source={source}
              clips={clips}
              fetchState={fetchState}
              linkValue={link}
              onLinkChange={setLink}
              onLoadLink={loadLink}
              onPickSource={(f) => void adoptSource(f, "file")}
              onClearSource={clearSource}
              onReslice={reslice}
              onRerollClip={reroll}
              bgs={bgs}
              onAddFiles={addBackgrounds}
              onRemoveFile={(id) => {
                setBgs((prev) => prev.filter((b) => b.id !== id));
                void deleteAsset(id);
              }}
              onClearFiles={() => {
                setBgs([]);
                void clearKind("background");
              }}
              disabled={busy}
            />
            <MusicPanel
              tracks={tracks}
              onAdd={addTracks}
              onSelect={(id) => {
                setTracks((prev) => {
                  const next = prev.map((t) => ({ ...t, selected: t.id === id }));
                  for (const t of next) void patchAssetMeta(t.id, { selected: t.selected });
                  return next;
                });
              }}
              onRemove={(id) => {
                setTracks((prev) => prev.filter((t) => t.id !== id));
                void deleteAsset(id);
              }}
              disabled={busy}
            />
            <AssemblyPanel
              phase={phase}
              canPrepare={canPrepare}
              blockers={blockers}
              stagedCount={stagedCount}
              doneCount={doneCount}
              errorCount={errorCount}
              renderProgress={renderProgress}
              error={error}
              onPrepare={prepare}
              onRenderAll={renderAll}
              onCancel={cancel}
            />

            <OutputPanel
              phase={phase}
              items={items}
              placeholderCount={10}
              zip={zip}
              elapsed={elapsed}
              activeIndex={activeIndex}
              activeProgress={activeProgress}
              onBuildZip={buildZip}
              onRenderOne={renderOne}
              onPostItems={(targets) => setEditorItems(targets)}
            />
          </div>

          {/* ---------------- RIGHT: social, calendar, analytics ---------------- */}
          <div className="grid content-start gap-5 xl:max-h-[calc(100vh-7rem)] xl:overflow-y-auto xl:pr-2">
            <div ref={postRef} className="scroll-mt-28">
              <SocialAccounts
                channels={channels}
                posts={bufferPosts}
                hasApiKey={bufferKey}
                loading={bufferLoading}
                error={bufferError}
                onRefresh={() => void syncBuffer()}
              />
            </div>

            <div ref={calendarRef} className="scroll-mt-28">
              <BufferCalendar
                posts={bufferPosts}
                loading={bufferLoading}
                onPostsChange={setBufferPosts}
                onRefresh={() => void syncBuffer()}
              />
            </div>

            <div ref={analyticsRef} className="scroll-mt-28">
              <AnalyticsPanel onTotals={setAnalyticsTotals} />
            </div>
          </div>
        </div>

        {/* ---------------- Legacy: bisheriges Zernio-Planungssystem ---------------- */}
        <details className="mt-8 border border-coal-700/70 bg-coal-900/60">
          <summary className="cursor-pointer px-4 py-3 font-mono text-[10px] font-bold tracking-widest text-coal-300 hover:text-volt-300">
            ▸ ZERNIO-PLANUNG (BISHERIGES SYSTEM) — {scheduledPosts.length} EINTRÄGE
          </summary>
          <div className="border-t border-coal-700/70 p-4">
            <CalendarView
              posts={scheduledPosts}
              hasApiKey={hasZernioKey}
              onPostsChange={setScheduledPosts}
            />
          </div>
        </details>

        <footer className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-coal-700/70 pt-5 pb-[env(safe-area-inset-bottom)]">
          <div className="flex flex-wrap items-center gap-4">
            <span className="flex items-center gap-1.5 font-mono text-[9.5px] tracking-wider text-coal-400">
              <HardDrive className="size-3.5 text-coal-500" /> FILES STAY ON-DEVICE
            </span>
            <span className="flex items-center gap-1.5 font-mono text-[9.5px] tracking-wider text-coal-400">
              <Radio className="size-3.5 text-coal-500" /> NATIVE TTS WEBSOCKET
            </span>
            <span className="flex items-center gap-1.5 font-mono text-[9.5px] tracking-wider text-coal-400">
              <Wifi className="size-3.5 text-coal-500" /> NETWORK ONLY FOR VOICE + AI
            </span>
            <span className="hidden items-center gap-1.5 font-mono text-[9.5px] tracking-wider text-coal-400 sm:flex">
              <ShieldCheck className="size-3.5 text-coal-500" /> KEYS IN LOCALSTORAGE ONLY
            </span>
          </div>
          <p className="font-mono text-[9.5px] tracking-wider text-coal-500">
            SHORTSFACTORY v3 · CLIP MILL — NO SERVER · NO FFMPEG · NO MERCY
          </p>
        </footer>
      </main>

      {editorItems && (
        <BufferPostEditor
          targetItems={editorItems}
          channels={channels}
          existingPosts={bufferPosts}
          hasApiKey={bufferKey}
          onClose={() => setEditorItems(null)}
          onCreated={(posts) => setBufferPosts(posts)}
          onOpenCalendar={() => jumpTo("calendar")}
        />
      )}

      {postModalItems && (
        <PostScheduleModal
          targetItems={postModalItems}
          existingPosts={scheduledPosts}
          onClose={() => setPostModalItems(null)}
          onScheduled={(allPosts) => setScheduledPosts(allPosts)}
          onOpenCalendar={() => jumpTo("calendar")}
        />
      )}

      {busy && (
        <div
          className="fixed inset-x-0 bottom-0 z-40 border-t border-ember-500/50 bg-coal-950/95"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          role="status"
          aria-live="polite"
        >
          <div
            className="h-1 bg-ember-500 transition-[width] duration-500 ease-out"
            style={{
              width:
                phase === "rendering"
                  ? `${Math.min(100, renderProgress * 100)}%`
                  : `${((doneCount + errorCount + stagedCount) / 10) * 100}%`,
            }}
          />
          <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="inline-block size-1.5 animate-led rounded-full bg-ember-500 text-ember-500" />
              <span className="truncate font-mono text-[10px] font-bold tracking-[0.18em] text-ember-400">
                {phase === "preparing"
                  ? `PREPARING ${stagedCount + errorCount}/10`
                  : `RENDERING ${doneCount + errorCount}/10${
                      activeIndex !== null ? ` · UNIT ${String(activeIndex + 1).padStart(2, "0")}` : ""
                    }`}
              </span>
            </div>
            <div className="flex items-center gap-3">
              {phase === "rendering" && (
                <button
                  type="button"
                  onClick={cancel}
                  className="border border-coal-600 px-2.5 py-1 font-mono text-[9px] font-bold tracking-widest text-coal-300 hover:border-rose-err hover:text-rose-err"
                >
                  STOP
                </button>
              )}
              <span className="font-mono text-[10px] text-coal-300 tabular-nums">
                {formatClock(elapsed)}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

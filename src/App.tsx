import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import {
  ArrowDown,
  Captions,
  Clapperboard,
  Cpu,
  FileArchive,
  HardDrive,
  Mic,
  Radio,
  ShieldCheck,
  Wifi,
} from "lucide-react";
import Header from "./components/Header";
import PostlakeAccounts, { DashboardStats } from "./components/PostlakeAccounts";
import PostlakeCalendar from "./components/PostlakeCalendar";
import PostlakeAnalytics from "./components/PostlakeAnalytics";
import AutopilotPanel from "./components/AutopilotPanel";
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
  hasAnyLLMKey,
  loadSettings,
  resolveDimensions,
  saveSettings,
  styleInstruction,
  type Settings,
} from "./lib/settings";
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
  createPosts,
  fetchStatus,
  hashtagsToList,
  loadCachedPosts,
  loadPrefs,
  makeLocalPost,
  planFreeSlots,
  refreshOpenPosts,
  resolveAccountIds,
  saveCachedPosts,
  savePrefs,
  syncPostsFromLake,
  type CreateJob,
  type LakePost,
  type PostlakePrefs,
  type PostlakeStatus,
} from "./lib/postlake";
import {
  loadAutopilotConfig,
  loadAutopilotStats,
  msUntilNextDispatch,
  recordDispatch,
  saveAutopilotConfig,
  saveAutopilotStats,
  type AutopilotConfig,
  type AutopilotLogEntry,
  type AutopilotStats,
} from "./lib/autopilot";
import { uploadClipForPostlake } from "./lib/upload";
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

interface DispatchJob {
  key: string;
  blob: Blob;
  mime: string;
  index: number;
  round: number;
  text: string;
  title: string;
  hashtags: string[];
  attempts: number;
  previewUrl: string;
}

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

  /* postlake social layer (einziger Post- & Analyseweg) */
  const [lakePosts, setLakePosts] = useState<LakePost[]>(() => loadCachedPosts());
  const [lakeStatus, setLakeStatus] = useState<PostlakeStatus>({
    hasApiKey: false,
    apiStatus: "missing_key",
    me: null,
    credits: null,
    billing: null,
    accounts: [],
  });
  const [lakeLoading, setLakeLoading] = useState(false);
  const [prefs, setPrefsState] = useState<PostlakePrefs>(() => loadPrefs());
  const [vaultReady, setVaultReady] = useState(false);

  /* autopilot */
  const [apConfig, setApConfigState] = useState<AutopilotConfig>(() => loadAutopilotConfig());
  const [apRunning, setApRunning] = useState(false);
  const [apStats, setApStats] = useState<AutopilotStats>(() => loadAutopilotStats());
  const [apLog, setApLog] = useState<AutopilotLogEntry[]>([]);
  const [apQueueDepth, setApQueueDepth] = useState(0);
  const [apPosting, setApPosting] = useState(false);

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

  /* frische Spiegel für den Autopilot-Loop (keine stale closures) */
  const ideasRef = useRef(ideas);
  ideasRef.current = ideas;
  const settingsStateRef = useRef(settings);
  settingsStateRef.current = settings;
  const phaseRef = useRef<Phase>("idle");
  phaseRef.current = phase;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const lakeStatusRef = useRef(lakeStatus);
  lakeStatusRef.current = lakeStatus;
  const lakePostsRef = useRef(lakePosts);
  lakePostsRef.current = lakePosts;
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const apConfigRef = useRef(apConfig);
  apConfigRef.current = apConfig;

  /* autopilot-laufzeit */
  const apRunningRef = useRef(false);
  const apRunIdRef = useRef(0);
  const apRoundRef = useRef(0);
  const apQueueRef = useRef<DispatchJob[]>([]);
  const apQueuedKeys = useRef<Set<string>>(new Set());
  const apPostingRef = useRef(false);
  const apAccountRef = useRef<string[]>([]);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);
  const prepareRef = useRef<(ideasOverride?: string[]) => Promise<number>>(async () => 0);
  const renderRef = useRef<(indexes: number[], viaAutopilot?: boolean) => Promise<void>>(
    async () => {}
  );
  const resliceRef = useRef<(() => void) | null>(null);

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

  /* ---- Postlake: Status + Posts laden (Postlake ist die Quelle der Wahrheit) ---- */
  const syncLake = useCallback(async () => {
    setLakeLoading(true);
    try {
      const st = await fetchStatus();
      setLakeStatus(st);
      if (st.hasApiKey && st.apiStatus === "connected") {
        const { posts } = await syncPostsFromLake({ limit: 100 });
        setLakePosts(posts);
      }
    } catch (e) {
      console.warn("postlake sync failed", e);
    } finally {
      setLakeLoading(false);
    }
  }, []);

  useEffect(() => {
    void syncLake();
  }, [syncLake]);

  /* Autopilot-Worker beim Unmount garantiert beenden */
  useEffect(() => {
    return () => {
      apRunIdRef.current++;
      apRunningRef.current = false;
    };
  }, []);

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
        const meta = await probeVideo(file);
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
          status: "validating",
        };
        setBgs((prev) => (prev.length < 10 ? [...prev, entry] : prev));
        try {
          const meta = await probeVideo(file);
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
            meta: { width: meta.width, height: meta.height, duration: meta.duration },
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

  /* Autopilot braucht nur Footage + Recorder — Titel schreibt er selbst */
  const autopilotBlockers = useMemo(() => {
    const out: string[] = [];
    if (!footageReady)
      out.push(mode === "single" ? "LOAD A SOURCE VIDEO" : `${readyBgs.length}/10 CLIPS LOADED`);
    if (!recorderSupported()) out.push("BROWSER CANNOT RECORD VIDEO");
    if (busy) out.push("MANUAL RUN IN PROGRESS");
    return out;
  }, [footageReady, mode, readyBgs.length, busy]);
  const canAutostart = autopilotBlockers.length === 0 && !apRunning;

  const patchItem = useCallback((index: number, patch: Partial<LocalRenderItem>) => {
    setItems((prev) => prev.map((r) => (r.index === index ? { ...r, ...patch } : r)));
  }, []);

  /* ------------------------------------------------------------ */
  /*  STEP ① prepare — scripts + voices only                       */
  /* ------------------------------------------------------------ */

  const prepare = useCallback(async (ideasOverride?: string[]): Promise<number> => {
    /* Guards über Ref (stale-closure-sicher für den Autopilot-Loop) */
    if (apRunningRef.current && ideasOverride === undefined) return 0;
    if (phaseRef.current === "preparing" || phaseRef.current === "rendering") return 0;
    const ideaList = ideasOverride ?? ideas;
    const listReady = ideaList.length === 10 && ideaList.every((i) => i.trim().length > 2);
    const readyCount = bgsRef.current.filter((b) => b.status === "ready").length;
    const footageOk =
      modeRef.current === "single"
        ? !!sourceRef.current && clipsRef.current.length === 10
        : readyCount === 10;
    if (!listReady || !footageOk || !recorderSupported()) return 0;

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
    phaseRef.current = "preparing";
    setPhase("preparing");

    const seeded: LocalRenderItem[] = ideaList.map((idea, index) => ({
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
    const endPhase: Phase = staged > 0 ? "staged" : "failed";
    phaseRef.current = endPhase;
    setPhase(endPhase);
    if (staged === 0)
      setError("Nothing could be prepared — voice synthesis needs an internet connection.");
    return staged;
  }, [ideas, settings, patchItem, ensureAudioCtx]);

  /* ------------------------------------------------------------ */
  /*  STEP ② render — explicit, per unit or all                    */
  /* ------------------------------------------------------------ */

  const renderIndexes = useCallback(
    async (indexes: number[], viaAutopilot = false) => {
      if (indexes.length === 0) return;
      if (apRunningRef.current && !viaAutopilot) return;
      if (phaseRef.current === "preparing" || phaseRef.current === "rendering") return;
      setError(null);
      cancelRef.current = { cancelled: false };
      if (!startedAtRef.current) startedAtRef.current = Date.now();
      phaseRef.current = "rendering";
      setPhase("rendering");

      const ac = await ensureAudioCtx();
      const { width, height } = resolveDimensions(settings.quality, settings.aspectRatio);
      const dealt = mode === "files" ? shuffle([...readyBgs]).map((b) => b.file) : [];

      for (const index of indexes) {
        if (cancelRef.current.cancelled) break;
        const take = voicesRef.current.get(index);
        if (!take) continue;

        const clip = clipsRef.current.find((c) => c.index === index);
        const src = sourceRef.current;
        const bgUrl = mode === "single" ? src?.url : undefined;
        const fileForIndex = mode === "files" ? dealt[index] : undefined;
        let tempUrl: string | null = null;
        if (!bgUrl && fileForIndex) tempUrl = URL.createObjectURL(fileForIndex);

        const useUrl = bgUrl ?? tempUrl;
        if (!useUrl) continue;

        setActiveIndex(index);
        setActiveProgress(0);
        patchItem(index, { status: "rendering", error: undefined });

        const introTitle = itemsRef.current.find((i) => i.index === index)?.idea || "";

        try {
          const result = await renderLocal({
            bgUrl: useUrl,
            clipStart: mode === "single" ? (clip?.start ?? 0) : Math.random() * 3,
            introTitle,
            voiceMp3: take.audio,
            words: take.words,
            musicFile,
            width,
            height,
            audioCtx: ac,
            settings,
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

  /* Stabile Funktions-Spiegel für die Autopilot-Worker (Long-Running-Loops) */
  useEffect(() => {
    prepareRef.current = prepare;
    renderRef.current = renderIndexes;
    resliceRef.current = reslice;
  });

  /* ------------------------------------------------------------ */
  /*  posting prefs + autopilot state helpers                       */
  /* ------------------------------------------------------------ */

  const setPrefs = useCallback((p: PostlakePrefs) => {
    setPrefsState(p);
    savePrefs(p);
  }, []);

  const setApConfig = useCallback((c: AutopilotConfig) => {
    setApConfigState(c);
    saveAutopilotConfig(c);
  }, []);

  const apLogIt = useCallback((kind: AutopilotLogEntry["kind"], text: string) => {
    setApLog((prev) => [...prev.slice(-199), { at: Date.now(), kind, text }]);
  }, []);

  const bumpStats = useCallback((updater: (prev: AutopilotStats) => Partial<AutopilotStats>) => {
    setApStats((prev) => {
      const next = { ...prev, ...updater(prev), lastActivityAt: Date.now() };
      saveAutopilotStats(next);
      return next;
    });
  }, []);

  /* ------------------------------------------------------------ */
  /*  POST ALL — direkt über Postlake, ohne Nachfrage               */
  /* ------------------------------------------------------------ */

  const postItems = useCallback(
    async (targets: LocalRenderItem[]) => {
      const videos = targets.filter((t) => t.status === "done" && t.blob && !t.posting);
      if (videos.length === 0 || apRunningRef.current) return;

      const p = prefsRef.current;
      const { ids, missing } = resolveAccountIds(
        p.platforms,
        lakeStatusRef.current.accounts,
        p.accountIds
      );
      if (ids.length === 0) {
        setError(
          missing.length > 0
            ? `Keine Kanäle für ${missing.join(", ")} verbunden — bitte erst in Postlake (app.postlake.dev → Channels) verbinden und SYNC drücken.`
            : "Keine Postlake-Kanäle verbunden — bitte erst verbinden und SYNC drücken."
        );
        return;
      }
      if (missing.length > 0) {
        setError(
          `Hinweis: keine Kanäle für ${missing.join(", ")} — poste auf ${ids.length} Kanal/Kanäle.`
        );
      } else {
        setError(null);
      }

      for (const v of videos) patchItem(v.index, { posting: true, postError: null });

      try {
        const order: number[] = [];
        const jobs: CreateJob[] = [];
        const slots =
          p.mode === "scheduled"
            ? planFreeSlots(lakePostsRef.current, {
                count: videos.length,
                preferredTimes: p.preferredTimes,
                timezone: p.timezone,
              })
            : [];

        for (let k = 0; k < videos.length; k++) {
          const v = videos[k];
          let mediaId = "";
          try {
            mediaId = await uploadClipForPostlake(v.blob!, `manual-${v.index}`, v.mime);
          } catch (uploadErr) {
            // Ohne Key: kein Upload möglich → lokal zwischenspeichern statt scheitern
            if (lakeStatusRef.current.hasApiKey) throw uploadErr;
          }
          const tagList = hashtagsToList(p.hashtags);
          const caption = (p.caption || v.idea || "").trim();
          const stamp = Date.now();
          const rand = Math.random().toString(36).slice(2, 7);
          const localId = `lake_${stamp}_${v.index}_${rand}`;
          const slot = slots[k];
          order.push(v.index);
          jobs.push({
            localId,
            text: [caption, tagList.join(" ")].filter(Boolean).join("\n\n"),
            title: (v.idea || `Short ${v.index + 1}`).slice(0, 90),
            hashtags: tagList,
            accounts: ids,
            media: mediaId ? [mediaId] : [],
            previewUrl: v.blobUrl,
            ...(slot ? { scheduledAt: slot.naive, timezone: p.timezone } : {}),
            idempotencyKey: `${localId}_key`,
          });
        }

        const res = await createPosts(jobs);
        setLakePosts(res.posts);

        for (let k = 0; k < order.length; k++) {
          const idx = order[k];
          const post = res.posts.find((x) => x.id === jobs[k].localId);
          if (post && post.status !== "Fehler") {
            patchItem(idx, {
              posting: false,
              posted: true,
              postlakePostId: post.postlakeId,
              postError: null,
            });
          } else {
            patchItem(idx, {
              posting: false,
              postError:
                post?.errorMessage ||
                res.error ||
                "Versand fehlgeschlagen — Details im Kalender.",
            });
          }
        }

        if (!res.hasApiKey) {
          setError(
            "POSTLAKE_API_KEY fehlt: Posts wurden lokal zwischengespeichert (Kalender) und gehen live, sobald der Key gesetzt ist."
          );
        } else if (res.failed > 0) {
          setError(
            `${res.failed} von ${jobs.length} Posts meldeten Fehler — Details im Kalender, dort ggf. erneut posten.`
          );
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        for (const v of videos) patchItem(v.index, { posting: false, postError: msg });
        setError(`Posten abgebrochen: ${msg}`);
      }
    },
    [patchItem]
  );

  /* ------------------------------------------------------------ */
  /*  AUTOPILOT — rendern + posten ohne Klick                       */
  /* ------------------------------------------------------------ */

  const stopAutopilot = useCallback(
    (auto = false) => {
      apRunIdRef.current++;
      apRunningRef.current = false;
      setApRunning(false);
      setApPosting(false);
      apPostingRef.current = false;
      cancelRef.current.cancelled = true;
      try {
        void wakeLockRef.current?.release();
      } catch {
        /* ignore */
      }
      wakeLockRef.current = null;
      if (auto) {
        apLogIt("ok", "Autopilot fertig: Runde abgeschlossen, Sende-Queue leer.");
      } else {
        apLogIt(
          "warn",
          `Autopilot gestoppt — ${apQueueRef.current.length} Video(s) bleiben in der Queue für den Neustart.`
        );
      }
    },
    [apLogIt]
  );

  /** Produktions-Loop: Ideen → Prepare → Render → Queue → (nächste Runde). */
  const runAutopilotLoop = useCallback(async () => {
    const runId = apRunIdRef.current;
    const alive = () => apRunningRef.current && apRunIdRef.current === runId;

    // Kanäle frisch auflösen
    try {
      const st = await fetchStatus();
      if (!alive()) return;
      setLakeStatus(st);
      const wanted = apConfigRef.current;
      const { ids, missing } = resolveAccountIds(wanted.platforms, st.accounts, wanted.accountIds);
      apAccountRef.current = ids;
      if (missing.length > 0) {
        apLogIt("warn", `Keine Kanäle für: ${missing.join(", ")} — poste auf ${ids.length} Kanal/Kanäle.`);
      }
      if (ids.length === 0) {
        apLogIt(
          "warn",
          st.hasApiKey
            ? "Keine Kanäle verbunden — Videos werden nur lokal zwischengespeichert."
            : "Kein POSTLAKE_API_KEY — Videos werden nur lokal zwischengespeichert."
        );
      }
      const credits = st.credits?.total;
      if (typeof credits === "number") {
        apLogIt(
          credits <= 10 ? "warn" : "info",
          `Postlake-Guthaben: ${credits} Credits (1 Credit pro Kanal-Post).`
        );
      }
    } catch (e) {
      apLogIt("warn", `Kanal-Sync fehlgeschlagen: ${e instanceof Error ? e.message : e}`);
    }

    while (alive()) {
      apRoundRef.current++;
      const round = apRoundRef.current;
      bumpStats(() => ({ rounds: round }));

      // Rückstau-Schutz: Bytes leben im Speicher — max. 30 wartende Videos
      while (alive() && apQueueRef.current.length >= 30) {
        apLogIt("info", "Sende-Queue voll (30) — warte auf Versand, bevor es weitergeht …");
        await sleep(15000);
      }
      if (!alive()) break;

      try {
        // 1) Ideen sichern (sonst frische schreiben lassen)
        let ideaList = ideasRef.current;
        if (!(ideaList.length === 10 && ideaList.every((i) => i.trim().length > 2))) {
          apLogIt("info", `Runde ${round}: schreibe 10 neue Titel …`);
          const s = settingsStateRef.current;
          const { ideas: fresh } = await generateIdeas(10, {
            qwenKey: s.qwenKey,
            mistralKey: s.mistralKey,
            words: s.storyWords,
            temperature: s.temperature,
            styleInstruction: styleInstruction(s),
          });
          if (!alive()) break;
          ideaList = (fresh.length >= 10 ? fresh.slice(0, 10) : [...fresh, ...ideaList]).slice(0, 10);
          setIdeas(ideaList);
        }

        // Ab Runde 2: neue Clip-Fenster für Abwechslung
        if (round > 1 && modeRef.current === "single" && sourceRef.current) {
          resliceRef.current?.();
        }

        // 2) Scripts + Voices
        apLogIt("info", `Runde ${round}: Scripts + Voices …`);
        const staged = await prepareRef.current(ideaList);
        if (!alive()) break;
        if (!staged || staged <= 0) {
          apLogIt("error", "Prepare brachte nichts — warte 30 s, dann erneut.");
          await sleep(30000);
          continue;
        }

        // 3) Rendern
        const targets = itemsRef.current
          .filter((i) => i.status === "staged")
          .map((i) => i.index);
        apLogIt("info", `Runde ${round}: rendere ${targets.length} Videos …`);
        await renderRef.current(targets, true);
        if (!alive()) break;

        // 4) Fertige in die Sende-Queue
        const dones = itemsRef.current.filter((i) => i.status === "done" && i.blob);
        bumpStats((prev) => ({ totalRendered: prev.totalRendered + dones.length }));
        const cfg2 = apConfigRef.current;
        const tagList = hashtagsToList(cfg2.hashtags);
        let queued = 0;
        for (const d of dones) {
          if (d.posted) continue;
          const key = `${round}:${d.index}`;
          if (apQueuedKeys.current.has(key)) continue;
          apQueuedKeys.current.add(key);
          const caption = (cfg2.caption || d.idea || "").trim();
          apQueueRef.current.push({
            key,
            round,
            index: d.index,
            blob: d.blob!,
            mime: d.mime || "video/mp4",
            title: (d.idea || `Short ${d.index + 1}`).slice(0, 90),
            text: [caption, tagList.join(" ")].filter(Boolean).join("\n\n"),
            hashtags: tagList,
            previewUrl: d.blobUrl || "",
            attempts: 0,
          });
          queued++;
        }
        setApQueueDepth(apQueueRef.current.length);
        apLogIt(
          "ok",
          `Runde ${round}: ${dones.length} Videos fertig, ${queued} eingereiht (Queue: ${apQueueRef.current.length}).`
        );

        if (!cfg2.loopRounds) {
          apLogIt("info", "Endlos-Modus aus — warte bis die Queue leer ist …");
          while (alive() && (apQueueRef.current.length > 0 || apPostingRef.current)) {
            await sleep(1000);
          }
          break;
        }
        await sleep(2000);
      } catch (e) {
        apLogIt("error", `Runde ${round} abgebrochen: ${e instanceof Error ? e.message : String(e)}`);
        await sleep(10000);
      }
    }

    if (apRunningRef.current && apRunIdRef.current === runId) {
      stopAutopilot(true);
    }
  }, [apLogIt, bumpStats, stopAutopilot]);

  /** Versand-Worker: ein Video nach dem anderen, im Stunden-Limit. */
  const runDispatchWorker = useCallback(async () => {
    const runId = apRunIdRef.current;
    const alive = () => apRunningRef.current && apRunIdRef.current === runId;

    while (alive()) {
      const job = apQueueRef.current[0];
      if (!job) {
        await sleep(1000);
        continue;
      }

      // Stunden-Limit einhalten (in 1-s-Scheiben, damit STOP sofort greift)
      let wait = msUntilNextDispatch(apConfigRef.current.videosPerHour);
      while (alive() && wait > 0) {
        const slice = Math.min(wait, 1000);
        await sleep(slice);
        wait -= slice;
      }
      if (!alive()) break;
      const head = apQueueRef.current[0];
      if (!head || head.key !== job.key) continue;

      setApPosting(true);
      apPostingRef.current = true;
      const sameRound = () => apRoundRef.current === job.round;
      if (sameRound()) patchItem(job.index, { posting: true, postError: null });

      try {
        const cfg = apConfigRef.current;
        const accounts =
          apAccountRef.current.length > 0
            ? apAccountRef.current
            : resolveAccountIds(cfg.platforms, lakeStatusRef.current.accounts, cfg.accountIds).ids;
        // Kanäle können mid-run dazukommen (Poller aktualisiert den Status)
        if (accounts.length > 0) apAccountRef.current = accounts;

        let scheduledAt: string | undefined;
        const timezone = "Europe/Berlin";
        if (cfg.mode === "scheduled") {
          const slot = planFreeSlots(lakePostsRef.current, {
            count: 1,
            preferredTimes: ["06:00", "20:00"],
            timezone,
          })[0];
          if (slot) scheduledAt = slot.naive;
        }

        // Keine Kanäle (kein Key / nichts verbunden): lokal cachen, nichts verlieren
        if (accounts.length === 0) {
          // Stabile ID pro Job: Retries teilen sich Key + Idempotency (kein Doppel-Post)
          const localId = `lake_auto_${job.key.replace(":", "_")}`;
          const local = makeLocalPost({
            localId,
            text: job.text,
            title: job.title,
            hashtags: job.hashtags,
            accounts: [],
            media: [],
            previewUrl: job.previewUrl,
            ...(scheduledAt ? { scheduledAt, timezone } : {}),
            idempotencyKey: `${localId}_key`,
          });
          const merged = [local, ...lakePostsRef.current].slice(0, 500);
          saveCachedPosts(merged);
          setLakePosts(merged);
          recordDispatch();
          apQueueRef.current.shift();
          setApQueueDepth(apQueueRef.current.length);
          bumpStats((prev) => ({ totalPosted: prev.totalPosted + 1 }));
          if (sameRound()) {
            patchItem(job.index, { posting: false, posted: true, postlakePostId: null, postError: null });
          }
          apLogIt("warn", `Video #${job.index + 1} (R${job.round}) lokal zwischengespeichert (keine Kanäle).`);
          continue;
        }

        apLogIt("info", `Lade Video #${job.index + 1} (R${job.round}) hoch …`);
        const mediaId = await uploadClipForPostlake(job.blob, `auto-r${job.round}-${job.index}`, job.mime);
        if (!alive()) {
          if (sameRound()) patchItem(job.index, { posting: false });
          break;
        }

        const localId = `lake_auto_${job.key.replace(":", "_")}`;
        const res = await createPosts([
          {
            localId,
            text: job.text,
            title: job.title,
            hashtags: job.hashtags,
            accounts,
            media: [mediaId],
            previewUrl: job.previewUrl,
            ...(scheduledAt ? { scheduledAt, timezone } : {}),
            idempotencyKey: `${localId}_key`,
          },
        ]);
        setLakePosts(res.posts);
        recordDispatch();
        apQueueRef.current.shift();
        setApQueueDepth(apQueueRef.current.length);

        const created = res.posts.find((x) => x.id === localId);
        if (created && created.status !== "Fehler") {
          bumpStats((prev) => ({ totalPosted: prev.totalPosted + 1 }));
          if (sameRound()) {
            patchItem(job.index, {
              posting: false,
              posted: true,
              postlakePostId: created.postlakeId,
              postError: null,
            });
          }
          apLogIt(
            "ok",
            res.hasApiKey
              ? `Video #${job.index + 1} (R${job.round}) → Postlake (${created.status}).`
              : `Video #${job.index + 1} (R${job.round}) lokal zwischengespeichert (kein Key).`
          );
        } else {
          throw new Error(created?.errorMessage || res.error || "Versand fehlgeschlagen.");
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        job.attempts++;
        if (job.attempts >= 3) {
          apQueueRef.current.shift();
          bumpStats((prev) => ({ totalFailed: prev.totalFailed + 1 }));
          if (sameRound()) patchItem(job.index, { posting: false, postError: msg });
          apLogIt("error", `Video #${job.index + 1} (R${job.round}) aufgegeben: ${msg}`);
        } else {
          apQueueRef.current.push(apQueueRef.current.shift()!);
          apLogIt("warn", `Versuch ${job.attempts}/3 für Video #${job.index + 1} (R${job.round}) fehlgeschlagen: ${msg}`);
          await sleep(5000);
        }
        setApQueueDepth(apQueueRef.current.length);
      } finally {
        setApPosting(false);
        apPostingRef.current = false;
      }
    }
  }, [apLogIt, bumpStats, patchItem]);

  /** Status-Poller: offene Posts + Credits aktuell halten. */
  const runStatusPoller = useCallback(async () => {
    const runId = apRunIdRef.current;
    const alive = () => apRunningRef.current && apRunIdRef.current === runId;
    while (alive()) {
      await sleep(60000);
      if (!alive()) break;
      if (!apConfigRef.current.pollStatus) continue;
      try {
        const { posts, refreshed } = await refreshOpenPosts();
        if (refreshed > 0) {
          setLakePosts(posts);
          apLogIt("info", `${refreshed} Post-Status bei Postlake aktualisiert.`);
        }
        const st = await fetchStatus();
        if (alive()) setLakeStatus(st);
      } catch {
        /* still, still — nächster Tick */
      }
    }
  }, [apLogIt]);

  const startAutopilot = useCallback(() => {
    if (apRunningRef.current) return;
    const readyCount = bgsRef.current.filter((b) => b.status === "ready").length;
    const footageOk =
      modeRef.current === "single"
        ? !!sourceRef.current && clipsRef.current.length === 10
        : readyCount === 10;
    if (!footageOk || !recorderSupported()) return;
    if (phaseRef.current === "preparing" || phaseRef.current === "rendering") return;

    apRunIdRef.current++;
    apRunningRef.current = true;
    apRoundRef.current = 0;
    setApRunning(true);
    bumpStats(() => ({ startedAt: Date.now(), rounds: 0 }));
    const cfg = apConfigRef.current;
    apLogIt(
      "info",
      `Autopilot gestartet — Limit ${cfg.videosPerHour}/h, Modus ${cfg.mode === "now" ? "Sofort posten" : "Slots planen"}, Kanäle: ${cfg.platforms.join(", ")}.`
    );
    try {
      const nav = navigator as Navigator & {
        wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> };
      };
      nav.wakeLock
        ?.request("screen")
        .then((lock) => {
          wakeLockRef.current = lock;
        })
        .catch(() => {});
    } catch {
      /* optional */
    }
    void runAutopilotLoop();
    void runDispatchWorker();
    void runStatusPoller();
  }, [apLogIt, bumpStats, runAutopilotLoop, runDispatchWorker, runStatusPoller]);

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
        scheduledCount={lakePosts.length}
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
              { icon: Clapperboard, k: "RENDER MILL", v: "CANVAS + MEDIARECORDER" },
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
            posts={lakePosts}
            credits={lakeStatus.credits?.total ?? null}
            hourLimit={apConfig.videosPerHour}
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
              disabled={busy || apRunning}
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
              disabled={busy || apRunning}
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
              disabled={busy || apRunning}
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
              disabled={apRunning}
              onPrepare={() => void prepare()}
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
              disabled={apRunning}
              postMode={prefs.mode}
              onPostMode={(m) => setPrefs({ ...prefs, mode: m })}
              onBuildZip={buildZip}
              onRenderOne={renderOne}
              onPostItems={(targets) => void postItems(targets)}
            />
          </div>

          {/* ---------------- RIGHT: autopilot, social, calendar, analytics ---------------- */}
          <div className="grid content-start gap-5 xl:max-h-[calc(100vh-7rem)] xl:overflow-y-auto xl:pr-2">
            <div ref={postRef} className="scroll-mt-28">
              <AutopilotPanel
                config={apConfig}
                onConfig={setApConfig}
                running={apRunning}
                stats={apStats}
                log={apLog}
                queueDepth={apQueueDepth}
                posting={apPosting}
                canStart={canAutostart}
                blockers={autopilotBlockers}
                hasKey={lakeStatus.hasApiKey}
                credits={lakeStatus.credits?.total ?? null}
                onStart={startAutopilot}
                onStop={() => stopAutopilot(false)}
              />
            </div>

            <PostlakeAccounts
              status={lakeStatus}
              posts={lakePosts}
              loading={lakeLoading}
              prefs={prefs}
              onPrefs={setPrefs}
              onRefresh={() => void syncLake()}
            />

            <div ref={calendarRef} className="scroll-mt-28">
              <PostlakeCalendar
                posts={lakePosts}
                timezone={prefs.timezone}
                loading={lakeLoading}
                onPostsChange={setLakePosts}
                onRefresh={() => void syncLake()}
              />
            </div>

            <div ref={analyticsRef} className="scroll-mt-28">
              <PostlakeAnalytics posts={lakePosts} />
            </div>
          </div>
        </div>

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
            SHORTSFACTORY · CLIP MILL + POSTLAKE AUTOPILOT — NO FFMPEG · NO MERCY
          </p>
        </footer>
      </main>

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

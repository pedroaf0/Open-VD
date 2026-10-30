import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import {
  buildVolumeFromFiles,
  flipVolumeInPlace,
  groupFilesBySeries,
  VOLUME_AXES,
  type DicomSeriesGroup,
  type Plane,
  type Volume,
  type VolumeAxis,
} from "@/lib/dicom";
import { expandArchives, isZipBuffer, type ExpandInput } from "@/lib/zip";
import { useRenderMode } from "@/lib/renderMode";
import { MultiSeriesModal } from "@/components/MultiSeriesModal";
import { CreditConfirmDialog } from "@/components/viewer/dialogs/CreditConfirmDialog";
import { MeshDeleteDialog } from "@/components/viewer/dialogs/MeshDeleteDialog";
import { OpenUrlDialog } from "@/components/viewer/dialogs/OpenUrlDialog";
import { QrDialog } from "@/components/viewer/dialogs/QrDialog";
import { RecordingAudioDialog } from "@/components/viewer/dialogs/RecordingAudioDialog";
import { SegmentationPickerDialog } from "@/components/viewer/dialogs/SegmentationPickerDialog";
import { SegmentationProgressDialog } from "@/components/viewer/dialogs/SegmentationProgressDialog";
import { ShareDialog } from "@/components/viewer/dialogs/ShareDialog";
import { ShareLinkBar } from "@/components/viewer/dialogs/ShareLinkBar";
import { UrlErrorDialog } from "@/components/viewer/dialogs/UrlErrorDialog";
import { QuizLoadingPanel } from "@/components/viewer/QuizLoadingPanel";
import { EmptyState } from "@/components/viewer/layout/EmptyState";
import { MobileBottomNav } from "@/components/viewer/layout/MobileBottomNav";
import { MobilePlaneTabs } from "@/components/viewer/layout/MobilePlaneTabs";
import { MobileSheets } from "@/components/viewer/layout/MobileSheets";
import { TabletAnnotationBar } from "@/components/viewer/layout/TabletAnnotationBar";
import { ViewerHeader } from "@/components/viewer/layout/ViewerHeader";
import { ViewerRail } from "@/components/viewer/layout/ViewerRail";
import { ViewerSidePanel } from "@/components/viewer/layout/ViewerSidePanel";
import { ViewportGrid } from "@/components/viewer/layout/ViewportGrid";
import { VideoPreviewDialog } from "@/components/VideoPreviewDialog";
import { usePanelRecorder } from "@/hooks/usePanelRecorder";
import { formatRecordingDuration, recordingFileExtension } from "@/lib/videoCapture";
import { hookConsole, DEBUG_OVERLAY_ENABLED } from "@/lib/debuglog";
import { DebugOverlay } from "@/components/DebugPanel";
import {
  crosshair,
  defaultPlaneState,
  defaultPlaneStates,
  clampPlane,
  toNormalized,
  type PlaneState,
  type Vec3,
} from "@/lib/mpr";
import {
  ANNOTATION_COLORS,
  renderAnnotationPng,
  snapshotAllStates,
  snapshotState,
  type Annotation,
  type AnnotationDraft,
  type Tool,
} from "@/lib/annotations";
import type { MeshFile } from "@/components/Volume3D";
import { Volume3DAsync } from "@/components/Volume3DAsync";
import { ProfileView } from "@/components/ProfileView";
import { SceneDownloadModal } from "@/components/SceneDownloadModal";
import { LoginRequiredModal } from "@/components/LoginRequiredModal";
import { LoadingIcons } from "@/components/LoadingIcons";
import i18n from "@/i18n";
import type { UploadIconHandle } from "@/components/UploadIcon";
import { formatBytes, pctUsed } from "@/lib/format";
import { registerServiceWorker } from "@/lib/pwa";
import {
  currentSceneKey,
  createScene,
  deleteScene,
  downloadSceneFiles,
  fetchRecentScenes,
  fetchScene,
  fetchSegmentationStatus,
  fetchUrlFiles,
  fetchUserPanel,
  AuthorizeUrlError,
  markSceneAccessed,
  runSegmentation,
  saveSceneSettings,
  shareUrl,
  uploadAnnotationPng,
  uploadSceneFile,
  wpConfig,
  useWpConfig,
  type SceneSettings,
  type SceneSummary,
  type UserPanel,
  type AuthorizeUrlResponse,
  type UrlProgress,
  type WpConfig,
} from "@/lib/wp";
import { computeMeshFileVolume, formatMeshVolume } from "@/lib/meshVolume";
import { forcedMeshColor } from "@/lib/meshColors";

/** Polls for authentication after login page is opened. */
async function pollForAuthentication(
  onAuthChange: (authenticated: boolean, userPanel?: UserPanel) => void,
  maxAttempts = 60,
): Promise<boolean> {
  onAuthChange(false); // Start checking

  for (let attempts = 0; attempts < maxAttempts; attempts++) {
    await new Promise((r) => setTimeout(r, 2000));

    try {
      const panel = await fetchUserPanel();
      if (panel.isLoggedIn) {
        onAuthChange(true, panel);
        return true;
      }
    } catch {
      // Ignore errors during polling (e.g., not logged in yet)
    }
  }

  onAuthChange(false);
  return false;
}

/** Retry a network step a couple of times before giving up. */
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw last instanceof Error ? last : new Error(i18n.t("viewer.errors.uploadFailed"));
}

/** Maximum simultaneous uploads. */
const UPLOAD_CONCURRENCY = 6;

/**
 * Run `task` for every item with a bounded number of parallel workers.
 * Results keep the original order; the first failure aborts the pool.
 */
async function runPool<T, R>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
  onDone?: (done: number, total: number) => void,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let done = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await task(items[i]!, i);
      done++;
      onDone?.(done, items.length);
    }
  });
  await Promise.all(workers);
  return results;
}

const ACCENTS: Record<Plane, string> = {
  axial: "var(--axial)",
  coronal: "var(--coronal)",
  sagittal: "var(--sagittal)",
};

/** placeholder usado antes de qualquer volume ser carregado */
const ZERO_STATES: Record<Plane, PlaneState> = {
  axial: { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] },
  coronal: { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 0, 1], n: [0, 1, 0] },
  sagittal: { origin: [0, 0, 0], u: [0, 1, 0], v: [0, 0, 1], n: [1, 0, 0] },
};

const serializePlane = (p: PlaneState) => ({
  origin: [...p.origin],
  u: [...p.u],
  v: [...p.v],
  n: [...p.n],
});

/**
 * Correção manual da orientação do volume: quais eixos estão espelhados.
 * Exames CBCT sem tags de orientação confiáveis podem abrir invertidos
 * (de cabeça para baixo / espelhados); estes flags são aplicados aos dados do
 * volume ao carregar e ficam salvos nas configurações da cena compartilhada.
 */
type FlipFlags = { x: boolean; y: boolean; z: boolean };

const ZERO_FLIP: FlipFlags = { x: false, y: false, z: false };

/** Normaliza flags vindos das configurações da cena (podem faltar/inválidos). */
const normalizeFlip = (f: FlipFlags | null | undefined): FlipFlags => ({
  x: f?.x === true,
  y: f?.y === true,
  z: f?.z === true,
});

const MESH_COLORS = ["#9fd9ff", "#ffb3c1", "#c9f7a1", "#ffd580", "#d5b3ff", "#7fe3d4"];

/** Breakpoints: desktop ≥1024px, tablet 768–1023px, mobile <768px. */
function useBreakpoint() {
  const [bp, setBp] = useState<"mobile" | "tablet" | "desktop">(() =>
    typeof window === "undefined"
      ? "desktop"
      : window.innerWidth < 768
        ? "mobile"
        : window.innerWidth < 1024
          ? "tablet"
          : "desktop",
  );
  useEffect(() => {
    const onResize = () =>
      setBp(window.innerWidth < 768 ? "mobile" : window.innerWidth < 1024 ? "tablet" : "desktop");
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return { isMobile: bp === "mobile", isTablet: bp === "tablet", isDesktop: bp === "desktop" };
}

/** Converte um `ExpandInput` em `File` para envio ao servidor (re-upload). */
function toUploadFile(input: ExpandInput): File {
  return input instanceof File
    ? input
    : new File([input.data as unknown as BlobPart], input.name, {
        type: "application/octet-stream",
      });
}

export function Viewer() {
  const { t } = useTranslation();
  const renderMode = useRenderMode();
  const [volume, setVolume] = useState<Volume | null>(null);
  /** referência do volume atual, usada pelos controles de orientação */
  const volumeRef = useRef<Volume | null>(null);
  volumeRef.current = volume;
  /** eixos espelhados para corrigir a orientação do volume (ver FlipFlags) */
  const [volumeFlip, setVolumeFlip] = useState<FlipFlags>(ZERO_FLIP);
  const volumeFlipRef = useRef(volumeFlip);
  volumeFlipRef.current = volumeFlip;
  const [meshes, setMeshes] = useState<MeshFile[]>([]);
  /** Espelho de `meshes` para uso em callbacks sem criar dependências. */
  const meshesRef = useRef(meshes);
  useEffect(() => {
    meshesRef.current = meshes;
  }, [meshes]);
  const meshVolumeCacheRef = useRef<Map<string, string | null>>(new Map());
  const [meshVolumes, setMeshVolumes] = useState<Map<string, string | null>>(() => new Map());
  useEffect(() => {
    let cancelled = false;
    const cache = meshVolumeCacheRef.current;
    const currentIds = new Set(meshes.map((mf) => mf.id));
    for (const key of [...cache.keys()]) if (!currentIds.has(key)) cache.delete(key);

    const out = new Map<string, string | null>();
    const pending: MeshFile[] = [];
    for (const mf of meshes) {
      if (cache.has(mf.id)) out.set(mf.id, cache.get(mf.id) ?? null);
      else pending.push(mf);
    }
    setMeshVolumes(out);
    if (!pending.length) return;

    void (async () => {
      for (const mf of pending) {
        const info = await computeMeshFileVolume(mf);
        if (cancelled) return;
        const label = info?.closed && info.volumeMm3 > 0 ? formatMeshVolume(info.volumeMm3) : null;
        cache.set(mf.id, label);
        out.set(mf.id, label);
      }
      if (!cancelled) setMeshVolumes(new Map(out));
    })();

    return () => {
      cancelled = true;
    };
  }, [meshes]);
  /**
   * Visibilidade real dos modelos (nome do arquivo → visível), usada pelo
   * módulo de download para priorizar os STL que aparecem na cena 3D.
   */
  const meshVisibility = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const m of meshes) map.set(m.name, (map.get(m.name) ?? false) || m.visible);
    return map;
  }, [meshes]);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Redireciona console.* para um buffer exibível na página (depuração no celular).
  useEffect(() => {
    if (DEBUG_OVERLAY_ENABLED) hookConsole();
  }, []);
  /** Progresso do download da cena compartilhada (barra no topo + bytes/velocidade). */
  const [sceneProgress, setSceneProgress] = useState<{
    done: number;
    total: number;
    receivedBytes: number;
    totalBytes: number;
    speedBps: number;
  } | null>(null);
  /** Exibe o painel com quiz Odonto Show enquanto a cena compartilhada carrega. */
  const [quizWhileLoading, setQuizWhileLoading] = useState(false);
  const [wc, setWc] = useState(300);
  const [ww, setWw] = useState(2000);
  const [invert, setInvert] = useState(false);
  /**
   * Estado dos planos de reslice. O volume DICOM permanece fixo: apenas a
   * origem e os eixos de cada plano mudam para gerar os cortes obliquos.
   */
  const [planeStates, setPlaneStates] = useState<Record<Plane, PlaneState>>(ZERO_STATES);
  const statesRef = useRef(planeStates);
  statesRef.current = planeStates;
  const [threshold, setThreshold] = useState(0.45);
  const [opacity, setOpacity] = useState(0.35);
  /**
   * Visibilidade da renderização volumétrica no 3D. Afeta somente a
   * representação visual do volume: os dados da tomografia e os cortes MPR
   * (que usam `volume`) permanecem intactos.
   */
  const [showVolume, setShowVolume] = useState(true);
  const [showPlanes, setShowPlanes] = useState({ axial: true, coronal: true, sagittal: true });
  /** Painel lateral de parâmetros (desktop/tablet). */
  const [panelOpen, setPanelOpen] = useState(() =>
    typeof window === "undefined" ? true : window.innerWidth >= 1024,
  );
  const [expanded, setExpanded] = useState<"axial" | "coronal" | "sagittal" | "3d" | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const viewportGridRef = useRef<HTMLDivElement | null>(null);
  const volume3dRenderRef = useRef<(() => void) | null>(null);
  const [isFull, setIsFull] = useState(false);

  const [sceneKey, setSceneKey] = useState<string | null>(null);
  const [share, setShare] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [sceneName, setSceneName] = useState("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const stlInput = useRef<HTMLInputElement>(null);
  /** Entrada de arquivos DICOM (arquivos soltos ou ZIP). */
  const dicomInput = useRef<HTMLInputElement>(null);
  /** Entrada de pasta DICOM (atributo não padrão `webkitdirectory`). */
  const dicomFolderInput = useRef<HTMLInputElement>(null);
  const [urlOpen, setUrlOpen] = useState(false);
  const [urlValue, setUrlValue] = useState("");
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [urlErrorOpen, setUrlErrorOpen] = useState(false);
  const [urlErrorDetail, setUrlErrorDetail] = useState<string | null>(null);
  const [multiSeriesGroups, setMultiSeriesGroups] = useState<DicomSeriesGroup[] | null>(null);
  const [multiSeriesOpen, setMultiSeriesOpen] = useState(false);
  const [multiSeriesOpenedName, setMultiSeriesOpenedName] = useState("");

  // Diálogo de confirmação antes de consumir um crédito para autorizar URL
  const [creditConfirmOpen, setCreditConfirmOpen] = useState(false);
  const creditConfirmResolve = useRef<(value: boolean) => void>(() => {});
  const creditConfirmData = useRef<{ credits: number; shopUrl: string } | null>(null);

  // Diálogo de confirmação antes de excluir um modelo STL
  const [meshDeleteConfirmOpen, setMeshDeleteConfirmOpen] = useState(false);
  const meshDeleteConfirmResolve = useRef<(value: boolean) => void>(() => {});
  const meshDeleteConfirmData = useRef<{ id: string; name: string } | null>(null);

  // Pergunta se a gravação do painel deve incluir o microfone.
  const [recordingAudioOpen, setRecordingAudioOpen] = useState(false);

  /** original files currently loaded (used when saving the scene to WordPress) */
  const sourceFiles = useRef<ExpandInput[]>([]);
  const sceneLoaded = useRef(false);
  /** names of files already stored on the server (skipped on re-share) */
  const uploadedNames = useRef<Set<string>>(new Set());
  /** names of files loaded via URL (excluded from upload, only URL is stored) */
  const urlSourceNames = useRef<Set<string>>(new Set());
  /** names of URLs loaded via URL (for tracking which URLs were loaded) */
  const urlsSourceNames = useRef<Set<string>>(new Set());
  /** URL used to load the current scene (stored in DB instead of files when sharing) */
  const sceneSourceUrl = useRef<string | null>(null);

  const cfg = useWpConfig();
  const { isMobile, isTablet, isDesktop } = useBreakpoint();
  const panelRecording = usePanelRecorder(viewportGridRef, volume3dRenderRef);
  const {
    error: recordingError,
    clearError: clearRecordingError,
    start: startPanelRecorder,
    stop: stopPanelRecorder,
  } = panelRecording;

  useEffect(() => {
    if (!recordingError) return;
    let messageKey = "viewer.recording.failed";
    if (recordingError === "unsupported") messageKey = "viewer.recording.unsupported";
    else if (recordingError === "microphone") messageKey = "viewer.recording.microphoneFailed";
    setError(t(messageKey));
    clearRecordingError();
  }, [recordingError, clearRecordingError, t]);

  const requestRecordingToggle = useCallback(() => {
    if (panelRecording.recording) {
      stopPanelRecorder();
      return;
    }
    setRecordingAudioOpen(true);
  }, [panelRecording.recording, stopPanelRecorder]);

  const startPanelRecording = useCallback(
    (audio: boolean) => {
      setRecordingAudioOpen(false);
      void startPanelRecorder({ audio });
    },
    [startPanelRecorder],
  );

  // Flags derivados da configuração — declarados cedo para uso em callbacks
  const canUpload = !cfg || cfg.canUpload;
  const canLoadPublicly = !!(cfg && cfg.publicLoadingEnabled);

  /** Roteamento simples do app: visor DICOM ou perfil (dashboard).
   *  Usuário logado sem cena aberta começa no perfil; o visor só é exibido
   *  ao criar/abrir uma cena (?scene=key) ou pelo botão Visor do cabeçalho. */
  const [route, setRoute] = useState<"viewer" | "profile">(() => {
    const forceNew =
      typeof sessionStorage !== "undefined" && sessionStorage.getItem("v_dicom_new_scene") === "1";
    if (forceNew) {
      try {
        sessionStorage.removeItem("v_dicom_new_scene");
      } catch {
        /* ignora */
      }
      return "viewer";
    }
    return cfg?.canUpload && !currentSceneKey() ? "profile" : "viewer";
  });
  const [userPanel, setUserPanel] = useState<UserPanel | null>(null);
  const [recentScenes, setRecentScenes] = useState<SceneSummary[]>([]);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [panelBusy, setPanelBusy] = useState(false);

  const [annMode, setAnnMode] = useState(false);
  const [annTool, setAnnTool] = useState<Tool>("select");
  const [annColor, setAnnColor] = useState(ANNOTATION_COLORS[0]!);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [annActive, setAnnActive] = useState<string | null>(null);
  const [showLines, setShowLines] = useState(true);

  /** Categoria ativa da navegação inferior (mobile). */
  const [activeSheet, setActiveSheet] = useState<
    "cortes" | "janela" | "3d" | "modelos" | "anotar" | null
  >(null);

  /** Modal de login necessário para ações protegidas (compartilhar, segmentar). */
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [loginModalChecking, setLoginModalChecking] = useState(false);
  const loginModalResolve = useRef<((value: boolean) => void) | null>(null);

  /** Ícone animado de upload no estado vazio (ativa no hover e no arraste). */
  const uploadIconRef = useRef<UploadIconHandle>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const dragDepth = useRef(0);

  /** Anima o ícone de upload enquanto um arquivo é arrastado sobre a janela. */
  useEffect(() => {
    const hasFiles = (e: DragEvent) =>
      !!e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files");

    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepth.current++;
      if (dragDepth.current === 1) {
        setIsDraggingFile(true);
        uploadIconRef.current?.startAnimation();
      }
    };
    const onDragLeave = () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) {
        setIsDraggingFile(false);
        uploadIconRef.current?.stopAnimation();
      }
    };
    const onDrop = () => {
      dragDepth.current = 0;
      setIsDraggingFile(false);
      uploadIconRef.current?.stopAnimation();
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  /** Mobile: prioriza um único viewport em foco (via estado `expanded`). */
  useEffect(() => {
    if (isMobile) setExpanded((e) => e ?? "axial");
    else setActiveSheet(null);
  }, [isMobile]);

  /** Painel de parâmetros: aberto por padrão no desktop, recolhido no tablet. */
  useEffect(() => {
    if (isDesktop) setPanelOpen(true);
    else if (isTablet) setPanelOpen(false);
  }, [isDesktop, isTablet]);

  const brandName = cfg?.brand?.name?.trim() || "";
  const brandLogo = cfg?.brand?.logo?.trim() || "";
  const quizUrl = cfg?.brand?.quizUrl?.trim() || "";
  const quizText = cfg?.brand?.quizText?.trim() || "";

  /** cursor 3D = interseccao dos tres planos, normalizado para o render 3D */
  const cross = useMemo(
    () =>
      volume ? toNormalized(volume, crosshair(volume, planeStates)) : { x: 0.5, y: 0.5, z: 0.5 },
    [volume, planeStates],
  );

  /**
   * Reaplica as cores especiais definidas no painel do WordPress quando a
   * config fica disponível (chega de forma assíncrona, após decriptar). Evita
   * que modelos carregados antes da config fiquem com a cor padrão.
   */
  useEffect(() => {
    setMeshes((list) => {
      let changed = false;
      const next = list.map((m) => {
        const forced = forcedMeshColor(m.name);
        if (forced && m.color.toLowerCase() !== forced.toLowerCase()) {
          changed = true;
          return { ...m, color: forced };
        }
        return m;
      });
      return changed ? next : list;
    });
  }, [cfg]);

  /** Atualiza campos de um modelo (cor, visibilidade, opacidade, coordenadas). */
  const patchMesh = useCallback((id: string, patch: Partial<MeshFile>) => {
    setMeshes((list) => list.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }, []);

  /** Abre o diálogo de confirmação para excluir um modelo STL. */
  const requestMeshDelete = useCallback((id: string, name: string) => {
    meshDeleteConfirmData.current = { id, name };
    meshDeleteConfirmResolve.current = () => {};
    setMeshDeleteConfirmOpen(true);
  }, []);

  /** Cancela a exclusão do modelo STL. */
  const cancelMeshDelete = useCallback(() => {
    meshDeleteConfirmResolve.current(false);
    setMeshDeleteConfirmOpen(false);
    meshDeleteConfirmData.current = null;
  }, []);

  /**
   * Pedido de centralização da rotação num modelo. O `seq` garante que clicar
   * novamente no mesmo modelo dispare uma nova centralização.
   */
  const [centerRequest, setCenterRequest] = useState<{ id: string; seq: number } | null>(null);

  const centerMesh = useCallback((id: string) => {
    setCenterRequest((prev) => ({ id, seq: (prev?.seq ?? 0) + 1 }));
  }, []);

  const addMeshFiles = useCallback(async (files: File[]) => {
    const geoms = files.filter((f) => /\.(stl|ply|obj)$/i.test(f.name));
    if (!geoms.length) return;
    const mtls = files.filter((f) => /\.mtl$/i.test(f.name));
    const images = files.filter((f) => /\.(png|jpe?g|bmp|gif|webp)$/i.test(f.name));
    const textures: Record<string, string> = {};
    for (const img of images) textures[img.name.toLowerCase()] = URL.createObjectURL(img);

    const loaded: MeshFile[] = [];
    for (let i = 0; i < geoms.length; i++) {
      const f = geoms[i]!;
      const lower = f.name.toLowerCase();
      const ext = lower.endsWith(".ply") ? "ply" : lower.endsWith(".obj") ? "obj" : "stl";
      let mtl: string | undefined;
      if (ext === "obj") {
        const base = f.name.replace(/\.obj$/i, "").toLowerCase();
        const match =
          mtls.find((m) => m.name.toLowerCase() === `${base}.mtl`) ??
          (mtls.length === 1 && geoms.length === 1 ? mtls[0] : undefined);
        if (match) mtl = await match.text();
      }
      loaded.push({
        id: `${Date.now()}-${i}-${f.name}`,
        name: f.name,
        data: await f.arrayBuffer(),
        ext,
        color: forcedMeshColor(f.name) ?? MESH_COLORS[i % MESH_COLORS.length]!,
        visible: true,
        opacity: 0.95,
        coordSystem: "ras",
        ...(mtl ? { mtl, textures } : {}),
      });
    }
    if (!loaded.length) return;
    // Regra automática: o PRIMEIRO modelo inserido numa cena sem modelos oculta
    // a renderização volumétrica (apenas a representação 3D; os voxels e os
    // cortes MPR não mudam). Inserções seguintes preservam a escolha atual do
    // usuário — reabilitar o volume pelo controle existente continua valendo.
    if (meshesRef.current.length === 0) setShowVolume(false);
    setMeshes((m) => [
      ...m,
      ...loaded.map((x, i) => ({
        ...x,
        color: forcedMeshColor(x.name) ?? MESH_COLORS[(m.length + i) % MESH_COLORS.length]!,
      })),
    ]);
  }, []);

  const loadDicom = useCallback(
    async (
      fileList: FileList | ExpandInput[] | null,
      opts?: { trackForUpload?: boolean; flip?: FlipFlags | null },
    ) => {
      if (!fileList || !fileList.length) return;
      setError(null);
      setStatus(t("viewer.status.readingFiles"));
      setMultiSeriesOpen(false);
      setMultiSeriesGroups(null);
      try {
        const original = Array.from(fileList);
        const hasZip = original.some(
          (f) => /\.zip$/i.test(f.name) || ("data" in f && isZipBuffer(f.data)),
        );
        if (opts?.trackForUpload !== false)
          sourceFiles.current = [...sourceFiles.current, ...original];

        // Uma passada cria o volume; se falhar, tenta de novo forçando a
        // descompactação com o decoder puro em JS (mais resistente).
        const attempt = async (forceJs: boolean): Promise<Volume | null> => {
          const all = await expandArchives(
            original,
            (p) => setStatus(`${p.label} ${p.done}/${p.total}`),
            forceJs ? { forceJs: true } : undefined,
          );
          const meshFiles = all.filter((f) =>
            /\.(stl|ply|obj|mtl|png|jpe?g|bmp|gif|webp)$/i.test(f.name),
          );
          const files = all.filter(
            (f) => !/\.(stl|ply|obj|mtl|png|jpe?g|bmp|gif|webp)$/i.test(f.name),
          );
          if (meshFiles.length) await addMeshFiles(meshFiles);
          if (!files.length) {
            if (!meshFiles.length) throw new Error(t("viewer.errors.noDicomFiles"));
            return null;
          }
          if (files.length > 1) {
            const groups = await groupFilesBySeries(files, (d, t, label) =>
              setStatus(`${label} ${d}/${t}`),
            );
            if (groups.length > 1) {
              setMultiSeriesGroups(groups);
              setMultiSeriesOpenedName(groups[0]!.displayName);
              setMultiSeriesOpen(true);
              return buildVolumeFromFiles(groups[0]!.files, (d, t, label) =>
                setStatus(`${label} ${d}/${t}`),
              );
            }
          }
          return buildVolumeFromFiles(files, (d, t, label) => setStatus(`${label} ${d}/${t}`));
        };

        let v: Volume | null;
        try {
          v = await attempt(false);
        } catch (firstErr) {
          console.warn("Falha ao carregar a cena; tentando descompactação forçada:", firstErr);
          if (!hasZip) throw firstErr;
          v = await attempt(true);
        }

        if (v) {
          // Correção de orientação: aplica os espelhamentos salvos na cena (ou
          // nenhum, ao abrir um estudo novo) diretamente nos dados do volume.
          const flags = normalizeFlip(opts?.flip);
          volumeFlipRef.current = flags;
          setVolumeFlip(flags);
          for (const axis of VOLUME_AXES) if (flags[axis]) flipVolumeInPlace(v, axis);
          setVolume(v);
          setWc(v.windowCenter);
          setWw(v.windowWidth);
          setPlaneStates(defaultPlaneStates(v));
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : t("viewer.errors.loadStudyFailed"));
      } finally {
        setStatus(null);
      }
    },
    [addMeshFiles, t],
  );

  const confirmCreditConsumption = useCallback((resp: AuthorizeUrlResponse): Promise<boolean> => {
    return new Promise((resolve) => {
      creditConfirmResolve.current = resolve;
      creditConfirmData.current = {
        credits: resp.current_credits ?? resp.credits_after ?? resp.credits_available ?? 0,
        shopUrl: resp.shop_url || "",
      };
      setCreditConfirmOpen(true);
    });
  }, []);

  /** Baixa o arquivo apontado pela URL e o carrega (DICOM/ZIP/STL). */
  const openByUrl = useCallback(
    async (rawUrl: string) => {
      const url = rawUrl.trim();
      if (!url) return;
      setUrlOpen(false);
      setError(null);
      try {
        // Usa o MESMO caminho do download de cena (streaming + expandArchives
        // com retry forceJs), garantindo que zip via URL funcione no celular.
        const files = await fetchUrlFiles(
          url,
          (label) => setStatus(label),
          confirmCreditConsumption,
        );
        console.info(`[url-debug] carregados ${files.length} arquivo(s) por URL`);
        for (const f of files) urlSourceNames.current.add(f.name);
        sceneSourceUrl.current = url;
        await loadDicom(files, { trackForUpload: false });
      } catch (e) {
        if (e instanceof AuthorizeUrlError) {
          setError(
            e.shopUrl
              ? t("viewer.errors.urlNotAuthorizedShop")
              : t("viewer.errors.urlNotAuthorized"),
          );
          return;
        }
        const msg = e instanceof Error ? e.message : t("viewer.errors.openByUrlFailed");
        const isFetchFail =
          /falha ao baixar|HTTP|não forneceu|exigir login|confirm|OneDrive|Google Drive/i.test(msg);
        if (isFetchFail) {
          setUrlErrorDetail(msg);
          setUrlErrorOpen(true);
        } else {
          setError(msg);
        }
        console.warn("[url-debug] erro ao abrir por URL:", e);
      } finally {
        setStatus(null);
        setUrlValue("");
      }
    },
    [loadDicom, confirmCreditConsumption, t],
  );

  const applySettings = useCallback((s: Partial<SceneSettings> | null) => {
    if (!s) return;
    if (typeof s.wc === "number") setWc(s.wc);
    if (typeof s.ww === "number") setWw(s.ww);
    if (typeof s.invert === "boolean") setInvert(s.invert);
    if (s.planes) {
      const parse = (x: unknown): PlaneState | null => {
        const o = x as Partial<Record<keyof PlaneState, number[]>> | undefined;
        if (!o?.origin || !o.u || !o.v || !o.n) return null;
        return {
          origin: [...o.origin] as Vec3,
          u: [...o.u] as Vec3,
          v: [...o.v] as Vec3,
          n: [...o.n] as Vec3,
        };
      };
      const ax = parse(s.planes.axial);
      const co = parse(s.planes.coronal);
      const sa = parse(s.planes.sagittal);
      if (ax && co && sa) setPlaneStates({ axial: ax, coronal: co, sagittal: sa });
    }
    if (typeof s.threshold === "number") setThreshold(s.threshold);
    if (typeof s.opacity === "number") setOpacity(s.opacity);
    if (typeof s.showVolume === "boolean") setShowVolume(s.showVolume);
    if (s.showPlanes) setShowPlanes(s.showPlanes);
    if (s.meshes?.length) {
      setMeshes((list) =>
        list.map((m) => {
          const forced = forcedMeshColor(m.name);
          const cfgMesh = s.meshes!.find((x) => x.name === m.name);
          const coordSystem =
            (cfgMesh?.coordSystem as "lps" | "ras" | undefined) ??
            (typeof s.meshRas === "boolean" ? (s.meshRas ? "ras" : "lps") : m.coordSystem);
          if (forced)
            return {
              ...m,
              color: forced,
              visible: cfgMesh?.visible ?? m.visible,
              opacity: cfgMesh?.opacity ?? m.opacity,
              coordSystem,
            };
          return cfgMesh
            ? {
                ...m,
                color: cfgMesh.color,
                visible: cfgMesh.visible,
                opacity: cfgMesh.opacity,
                coordSystem,
              }
            : { ...m, coordSystem };
        }),
      );
    } else if (typeof s.meshRas === "boolean") {
      const fallback = s.meshRas ? ("ras" as const) : ("lps" as const);
      setMeshes((list) => list.map((m) => ({ ...m, coordSystem: fallback })));
    }
    if (!s.meshes?.length) {
      setMeshes((list) => {
        let changed = false;
        const next = list.map((m) => {
          const forced = forcedMeshColor(m.name);
          if (forced && m.color.toLowerCase() !== forced.toLowerCase()) {
            changed = true;
            return { ...m, color: forced };
          }
          return m;
        });
        return changed ? next : list;
      });
    }
  }, []);

  /** Load a shared scene coming from WordPress (?scene=key or /key/). */
  useEffect(() => {
    if (sceneLoaded.current) return;
    const key = currentSceneKey();
    if (!key) return;
    sceneLoaded.current = true;
    (async () => {
      setStatus(t("viewer.status.loadingScene"));
      setQuizWhileLoading(true);
      try {
        const scene = await fetchScene(key);
        setSceneKey(scene.key);
        setSceneName(scene.title || "");
        // Registra o acesso à cena (para a lista de cenas recentes).
        void markSceneAccessed(key).catch(() => {});

        // Se a cena tem URLs de origem (carregadas via URL), carrega DA URL
        // em vez de (ou ao lado de) baixar os arquivos do servidor.
        // Suporta cenas mistas: arquivos do servidor E URLs referenciadas.
        // O scene.settings.urls é um array de strings (novas cenas).
        // O scene.settings.url é uma string única (cenas antigas - legado).
        const settings = scene.settings ?? {};
        const hasUrlsArray = settings.urls && settings.urls.length > 0;
        const hasLegacyUrl = settings.url && !hasUrlsArray;
        const sourceUrl = hasUrlsArray ? settings.urls![0] : hasLegacyUrl ? settings.url : null;

        if (sourceUrl) {
          sceneSourceUrl.current = sourceUrl;
          // Trackear os nomes dos URLs carregados
          // Extract names from URLs - get the last path segment
          const urlName = sourceUrl.split(/[/?#]/).filter(Boolean).pop() || "url";
          urlsSourceNames.current.add(urlName);

          // Always try downloading from server first to get already-uploaded files
          const serverTotalBytes: { done: number; total: number } = { done: 0, total: 0 };
          const serverFiles = await downloadSceneFiles(scene, (p) => {
            serverTotalBytes.done = p.done;
            serverTotalBytes.total = p.total;
            setSceneProgress({
              done: p.done,
              total: p.total,
              receivedBytes: p.receivedBytes,
              totalBytes: p.totalBytes,
              speedBps: p.speedBps,
            });
            setStatus(`${p.label} ${p.done}/${p.total}`);
          });
          // Add server files to uploadedNames
          serverFiles.forEach((f) => uploadedNames.current.add(f.name));
          // Now load additional files from URL original (if there are more files than server)
          setStatus(t("viewer.status.downloadingExtra"));
          const urlFiles = await fetchUrlFiles(
            sourceUrl,
            (label) => setStatus(label),
            confirmCreditConsumption,
            (up: UrlProgress) => {
              setSceneProgress({
                done: serverTotalBytes.done + up.done,
                total: serverTotalBytes.total + up.total,
                receivedBytes: up.receivedBytes,
                totalBytes: up.totalBytes,
                speedBps: up.speedBps,
              });
            },
          );
          for (const f of urlFiles) urlsSourceNames.current.add(f.name);
          // Combine: use server files first, then add URL files that aren't already loaded
          const allFiles = [
            ...serverFiles,
            ...urlFiles.filter((f) => !serverFiles.some((sf) => sf.name === f.name)),
          ];
          await loadDicom(allFiles, { trackForUpload: false, flip: settings.flip ?? null });
        } else {
          // Caso contrário, baixa os arquivos do servidor como antes.
          const files = await downloadSceneFiles(scene, (p) => {
            setSceneProgress({
              done: p.done,
              total: p.total,
              receivedBytes: p.receivedBytes,
              totalBytes: p.totalBytes,
              speedBps: p.speedBps,
            });
            setStatus(`${p.label} ${p.done}/${p.total}`);
          });
          scene.files.forEach((f) => uploadedNames.current.add(f.name));
          await loadDicom(files, { trackForUpload: false, flip: settings.flip ?? null });
        }
        applySettings(scene.settings);
        setAnnotations(scene.annotations ?? []);
        setAnnActive(null);
      } catch (e) {
        sceneLoaded.current = false; // Reset so it can retry on reload
        if (e instanceof AuthorizeUrlError) {
          setError(
            e.shopUrl
              ? t("viewer.errors.sceneUrlNotAuthorizedShop")
              : t("viewer.errors.sceneUrlNotAuthorized"),
          );
        } else {
          setError(e instanceof Error ? e.message : t("viewer.errors.openSceneFailed"));
        }
      } finally {
        setQuizWhileLoading(false);
        setSceneProgress(null);
        setStatus(null);
      }
    })();
  }, [loadDicom, applySettings, confirmCreditConsumption, t]);

  const collectSettings = useCallback(
    (): SceneSettings => ({
      wc,
      ww,
      invert,
      cross,
      planes: {
        axial: serializePlane(planeStates.axial),
        coronal: serializePlane(planeStates.coronal),
        sagittal: serializePlane(planeStates.sagittal),
      },
      flip: { ...volumeFlip },
      threshold,
      opacity,
      showVolume,
      showPlanes,
      meshes: meshes.map((m) => ({
        name: m.name,
        color: m.color,
        visible: m.visible,
        opacity: m.opacity,
        coordSystem: m.coordSystem,
      })),
      ...(sceneSourceUrl.current ? { urls: [sceneSourceUrl.current] } : { urls: [] }),
    }),
    [
      wc,
      ww,
      invert,
      cross,
      planeStates,
      volumeFlip,
      threshold,
      opacity,
      showVolume,
      showPlanes,
      meshes,
    ],
  );

  /** Executa a exclusão do modelo STL após confirmação e persiste na cena. */
  const confirmMeshDelete = useCallback(() => {
    const data = meshDeleteConfirmData.current;
    // Fecha o diálogo imediatamente; a persistência na cena roda em segundo
    // plano para não bloquear a interface enquanto a API responde.
    meshDeleteConfirmResolve.current(true);
    setMeshDeleteConfirmOpen(false);
    meshDeleteConfirmData.current = null;
    if (!data) return;

    console.log("[Viewer] confirmMeshDelete: deleting mesh", data.id, data.name);
    // Compute the new meshes array BEFORE state update so we can persist it immediately
    const newMeshes = meshes.filter((m) => m.id !== data.id);
    setMeshes(newMeshes);
    // If there's an existing scene, persist the removal immediately
    if (!sceneKey) {
      console.warn("[Viewer] confirmMeshDelete: no sceneKey, skipping persist");
      return;
    }
    // Pass the new meshes array directly to avoid stale closure
    const settings = {
      ...collectSettings(),
      meshes: newMeshes.map((m) => ({
        name: m.name,
        color: m.color,
        visible: m.visible,
        opacity: m.opacity,
        coordSystem: m.coordSystem,
      })),
    };
    console.log("[Viewer] confirmMeshDelete: settings.meshes to save:", settings.meshes);
    void saveSceneSettings(sceneKey, settings, sceneName)
      .then(() => console.log("[Viewer] confirmMeshDelete: saveSceneSettings succeeded"))
      .catch((e) => {
        // Non-fatal: log but don't block UI — user can re-save manually
        console.warn("[Viewer] Failed to persist mesh deletion:", e);
      });
  }, [sceneKey, sceneName, meshes, collectSettings]);

  const loadPanel = useCallback(async () => {
    if (!cfg) return;
    try {
      const panel = await fetchUserPanel();
      setUserPanel(panel);
      setPanelError(null);
    } catch (e) {
      setPanelError(e instanceof Error ? e.message : t("viewer.errors.loadPanelFailed"));
    }
    // Cenas acessadas recentemente (via user meta). Falha silenciosa.
    try {
      const recent = await fetchRecentScenes();
      setRecentScenes(recent);
    } catch {
      setRecentScenes([]);
    }
  }, [cfg, t]);

  useEffect(() => {
    if (cfg?.canUpload) void loadPanel();
  }, [cfg, loadPanel]);

  useEffect(() => {
    registerServiceWorker();
  }, []);

  /** Inicia polling de autenticação quando o modal solicita login */
  useEffect(() => {
    if (!loginModalChecking || !cfg?.loginUrl) return;

    let cancelled = false;

    (async () => {
      const authenticated = await pollForAuthentication(async (authed, panel) => {
        if (cancelled) return;
        if (authed && panel) {
          setUserPanel(panel);
          await loadPanel();
          loginModalResolve.current?.(true);
        } else {
          loginModalResolve.current?.(false);
        }
      });

      if (cancelled) return;
      if (!authenticated) {
        setLoginModalChecking(false);
        alert(t("viewer.auth.authFailed"));
      }
      // Fecha o modal após polling (sucesso ou falha)
      setLoginModalOpen(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [loginModalChecking, cfg, loadPanel, t]);

  const openShare = useCallback(async () => {
    // Se carregamento público está habilitado mas usuário não está logado, exige autenticação via modal
    if (!cfg?.canUpload && canLoadPublicly && cfg?.loginUrl) {
      const authenticated = await new Promise<boolean>((resolve) => {
        loginModalResolve.current = resolve;
        setLoginModalOpen(true);
        setLoginModalChecking(false);
      });

      if (authenticated) {
        // O onAuthChange já atualizou userPanel e chamou loadPanel
      } else {
        return;
      }
    }

    setSceneName((n) => n || "");

    // Exibe nome do paciente automaticamente em todas as telas
    setShareOpen(true);
    void loadPanel();
  }, [cfg, canLoadPublicly, loadPanel]);

  const handleDeleteScene = useCallback(
    async (s: SceneSummary) => {
      if (!window.confirm(t("viewer.confirm.deleteScene", { title: s.title }))) return;
      setPanelBusy(true);
      setPanelError(null);
      try {
        await deleteScene(s.key);
        if (sceneKey === s.key) {
          setSceneKey(null);
          setShare(null);
        }
        await loadPanel();
      } catch (e) {
        setPanelError(e instanceof Error ? e.message : t("viewer.errors.deleteSceneFailed"));
      } finally {
        setPanelBusy(false);
      }
    },
    [sceneKey, loadPanel, t],
  );

  /** Estado de segmentação por cena: status exibido no painel + polling. */
  const [segBusy, setSegBusy] = useState<string | null>(null);
  const [segBusyType, setSegBusyType] = useState<string | null>(null);
  const segTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  useEffect(
    () => () => {
      segTimers.current.forEach((t) => clearTimeout(t));
    },
    [],
  );

  const segTypesEnabled = useMemo(() => {
    const fromCfg = cfg?.segmentationTypes?.filter((s) => s.enabled !== false) ?? [];
    if (fromCfg.length) return fromCfg;
    const fallbackCost = cfg?.segmentationCost ?? 1;
    return [
      {
        id: "default",
        name: t("viewer.segmentation.defaultType"),
        description: "",
        cost: fallbackCost,
        enabled: true,
      },
    ];
  }, [cfg, t]);
  const segCost = cfg?.segmentationCost ?? segTypesEnabled[0]?.cost ?? 1;
  const currentSceneSummary = sceneKey
    ? (userPanel?.scenes.find((x) => x.key === sceneKey) ?? null)
    : null;
  const isOwnerCurrentScene = !!currentSceneSummary;
  const getSegStatus = useCallback(
    (s: SceneSummary | null, typeId: string): string | null => {
      if (!s) return null;
      if (s.segmentations && s.segmentations[typeId] !== undefined)
        return s.segmentations[typeId] ?? null;
      if (typeId === "default" || segTypesEnabled.length === 1) return s.segmentationStatus ?? null;
      return null;
    },
    [segTypesEnabled],
  );
  const hasAvailableSegType = useMemo(() => {
    if (!currentSceneSummary) return segTypesEnabled.length > 0;
    return segTypesEnabled.some((t) => {
      const st = getSegStatus(currentSceneSummary, t.id);
      return !st || st === "FAILED";
    });
  }, [currentSceneSummary, segTypesEnabled, getSegStatus]);
  const canSegmentCurrentScene = hasAvailableSegType;
  const SEG_FAKE_TOTAL_S = 600;
  const [segModal, setSegModal] = useState<{
    key: string;
    title: string;
    startAt: number;
    typeId?: string;
  } | null>(null);
  const [segFakePct, setSegFakePct] = useState(0);
  const [segPicker, setSegPicker] = useState<{
    key: string;
    title: string;
    summary: SceneSummary | null;
  } | null>(null);
  const sceneKeyRef = useRef(sceneKey);
  useEffect(() => {
    sceneKeyRef.current = sceneKey;
  }, [sceneKey]);
  useEffect(() => {
    if (!segModal) return;
    const id = window.setInterval(() => {
      const elapsed = (Date.now() - segModal.startAt) / 1000;
      const ratio = Math.min(1, elapsed / SEG_FAKE_TOTAL_S);
      const pct = ratio >= 1 ? 96 : Math.min(96, 96 * (Math.log(1 + 9 * ratio) / Math.log(10)));
      setSegFakePct(Math.round(pct * 10) / 10);
    }, 400);
    return () => window.clearInterval(id);
  }, [segModal]);

  const handleSegmentScene = useCallback(
    async (s: SceneSummary, explicitTypeId?: string) => {
      if (!cfg || segBusy) return;
      let typeId = explicitTypeId ?? "";
      const available = segTypesEnabled;
      if (!typeId) {
        if (available.length === 1) typeId = available[0]!.id;
        else {
          setSegPicker({ key: s.key, title: s.title, summary: s });
          return;
        }
      }
      const segType = available.find((x) => x.id === typeId);
      if (!segType) return;
      const cost = segType.cost;
      const costLabel =
        cost === 0
          ? t("viewer.segmentation.free")
          : t("viewer.segmentation.credits", { count: cost });
      if (cost > 0 && userPanel && userPanel.credits < cost) {
        window.alert(
          `${t("viewer.segmentation.alertNoCredits", { name: segType.name, cost: costLabel })}\n\n${
            cfg.shopUrl
              ? t("viewer.segmentation.alertBuyPack")
              : t("viewer.segmentation.alertAskAdmin")
          }`,
        );
        return;
      }
      const curStatus = getSegStatus(s, typeId);
      const isRetry = curStatus === "FAILED";
      const alreadyDone = curStatus && curStatus !== "FAILED";
      if (alreadyDone) return;
      if (
        !window.confirm(
          cost === 0
            ? isRetry
              ? t("viewer.segmentation.confirmRetry", { name: segType.name })
              : t("viewer.segmentation.confirmStart", { name: segType.name })
            : isRetry
              ? t("viewer.segmentation.confirmRetryCost", {
                  name: segType.name,
                  cost: costLabel,
                })
              : t("viewer.segmentation.confirmStartCost", {
                  name: segType.name,
                  cost: costLabel,
                }),
        )
      )
        return;
      setSegBusy(s.key);
      setSegBusyType(typeId);
      setPanelError(null);
      try {
        const res = await runSegmentation(s.key, typeId);
        setSegModal({
          key: s.key,
          title: `${s.title} — ${segType.name}`,
          startAt: Date.now(),
          typeId,
        });
        setSegFakePct(2);
        setUserPanel((p) =>
          p
            ? {
                ...p,
                credits: cost > 0 ? Math.max(0, p.credits - cost) : p.credits,
                scenes: p.scenes.map((x) =>
                  x.key === s.key
                    ? {
                        ...x,
                        segmentationUsed: true,
                        segmentationStatus: res.status,
                        segmentations: { ...(x.segmentations ?? {}), [typeId]: res.status },
                      }
                    : x,
                ),
              }
            : p,
        );
        const timerKey = `${s.key}:${typeId}`;
        const tick = async () => {
          try {
            const { status } = await fetchSegmentationStatus(s.key, typeId);
            setUserPanel((p) =>
              p
                ? {
                    ...p,
                    scenes: p.scenes.map((x) =>
                      x.key === s.key
                        ? {
                            ...x,
                            segmentationStatus: status,
                            segmentations: { ...(x.segmentations ?? {}), [typeId]: status },
                          }
                        : x,
                    ),
                  }
                : p,
            );
            if (status === "COMPLETED") {
              setSegFakePct(100);
              setTimeout(() => setSegModal(null), 1600);
              if (sceneKeyRef.current === s.key) {
                try {
                  const updated = await fetchScene(s.key);
                  const existingNames = new Set(meshesRef.current.map((m) => m.name));
                  const newMeshFiles = updated.files.filter(
                    (f) => f.kind === "mesh" && !existingNames.has(f.name),
                  );
                  if (newMeshFiles.length > 0) {
                    setStatus(t("viewer.status.loadingMeshes"));
                    const files: File[] = [];
                    for (const f of newMeshFiles) {
                      try {
                        const resF = await fetch(f.url);
                        if (!resF.ok) continue;
                        const buf = await resF.arrayBuffer();
                        files.push(new File([buf], f.name, { type: "application/octet-stream" }));
                      } catch {
                        /* ignora arquivo de mesh inacessível */
                      }
                    }
                    if (files.length) {
                      await addMeshFiles(files);
                      files.forEach((f) => uploadedNames.current.add(f.name));
                    }
                    setStatus(null);
                  }
                } catch {
                  /* falha ao recarregar os meshes segmentados: segue com o painel */
                }
              }
              void loadPanel();
              return;
            }
            if (status === "FAILED") {
              setSegFakePct(100);
              setPanelError(t("viewer.segmentation.failedMsg", { name: segType.name }));
              setTimeout(() => setSegModal(null), 1800);
              void loadPanel();
              return;
            }
          } catch {
            /* erro transitório no polling: tenta novamente no próximo tick */
          }
          const tt = setTimeout(() => void tick(), 5000);
          segTimers.current.set(timerKey, tt);
        };
        const tt = setTimeout(() => void tick(), 5000);
        segTimers.current.set(timerKey, tt);
      } catch (e) {
        setPanelError(e instanceof Error ? e.message : t("viewer.errors.segmentStartFailed"));
      } finally {
        setSegBusy(null);
        setSegBusyType(null);
      }
    },
    [cfg, segBusy, segTypesEnabled, loadPanel, userPanel, addMeshFiles, getSegStatus, t],
  );

  const onCreateAnnotation = useCallback(
    (draft: AnnotationDraft) => {
      if (!volume) return;
      let text: string | undefined;
      if (draft.kind === "text") {
        text = window.prompt(t("viewer.annotations.prompt"), "")?.trim();
        if (!text) return;
      }
      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const ann: Annotation = {
        id,
        kind: draft.kind,
        plane: draft.plane,
        label:
          draft.kind === "measure"
            ? `${(draft.measureMm ?? 0).toFixed(1)} mm`
            : draft.kind === "text"
              ? (text ?? "").slice(0, 60)
              : draft.kind === "arrow"
                ? t("viewer.annTools.arrow")
                : draft.kind === "draw"
                  ? t("viewer.annTools.draw")
                  : t("viewer.annTools.mark"),
        ...(text ? { text } : {}),
        color: annColor,
        points: draft.points,
        measure:
          draft.kind === "measure" && draft.measureMm != null
            ? { lengthMm: draft.measureMm }
            : null,
        hidden: false,
        planeState: snapshotState(statesRef.current[draft.plane]),
        allPlaneStates: snapshotAllStates(statesRef.current),
        created: new Date().toISOString(),
      };
      setAnnotations((list) => [...list, ann]);
      setAnnActive(ann.id);
    },
    [volume, annColor, t],
  );

  const selectAnnotation = useCallback(
    (a: Annotation) => {
      setAnnActive(a.id);
      if (volume) {
        if (a.allPlaneStates) {
          setPlaneStates({
            axial: clampPlane(volume, a.allPlaneStates.axial),
            coronal: clampPlane(volume, a.allPlaneStates.coronal),
            sagittal: clampPlane(volume, a.allPlaneStates.sagittal),
          });
        } else {
          setPlaneStates((s) => ({ ...s, [a.plane]: clampPlane(volume, a.planeState) }));
        }
      }
    },
    [volume],
  );

  const deleteAnnotation = useCallback((id: string) => {
    setAnnotations((list) => list.filter((a) => a.id !== id));
    setAnnActive((cur) => (cur === id ? null : cur));
  }, []);

  const toggleAnnotationVisibility = useCallback((id: string) => {
    setAnnotations((list) => list.map((a) => (a.id === id ? { ...a, hidden: !a.hidden } : a)));
  }, []);

  const sortedAnnotations = useMemo(
    () =>
      [...annotations].sort(
        (a, b) =>
          (a.plane === b.plane ? 0 : a.plane < b.plane ? -1 : 1) ||
          (a.created < b.created ? -1 : a.created > b.created ? 1 : 0),
      ),
    [annotations],
  );

  const ensureAnnotationPngs = useCallback(
    async (
      dest: { token: string } | { sceneKey: string },
      list: Annotation[],
    ): Promise<Annotation[]> => {
      if (!volume) return list;
      const out: Annotation[] = [];
      for (const a of list) {
        if (a.hidden || a.png) {
          out.push(a);
          continue;
        }
        try {
          const blob = await renderAnnotationPng(a, volume);
          const { url } = await uploadAnnotationPng(dest, blob, a.id);
          out.push({ ...a, png: url });
        } catch {
          out.push(a);
        }
      }
      return out;
    },
    [volume],
  );

  /**
   * Share flow: create the scene record FIRST, then send the files into it.
   * Creating the scene before any byte is uploaded guarantees that every file
   * has an owner: if an upload fails or is interrupted, its files stay
   * attached to a real scene that can be deleted, never orphaned on the
   * server. Files loaded via URL are excluded from upload - only the URL is
   * stored. When the scene already exists this only adds what is missing.
   */
  const publishScene = useCallback(async (): Promise<string | null> => {
    if (!cfg?.canUpload) return null;
    const title = sceneName.trim() || t("viewer.share.defaultTitle");
    setError(null);
    setBusy(true);
    try {
      const pending = sourceFiles.current.filter((f) => !uploadedNames.current.has(f.name));
      let key = sceneKey;

      // Step 1 — guarantee the scene exists before uploading anything.
      if (!key) {
        if (!pending.length && !sceneSourceUrl.current) {
          throw new Error(t("viewer.errors.noFilesToShare"));
        }
        setStatus(t("viewer.status.creatingScene"));
        const created = await createScene({ title, settings: collectSettings() });
        key = created.key;
        setSceneKey(key);
      }
      const targetKey = key;

      // Step 2 — send every file that isn't stored yet, straight into the scene.
      if (pending.length) {
        setProgress({ done: 0, total: pending.length });
        setStatus(t("viewer.status.uploadingCount", { count: pending.length }));
        await runPool(
          pending,
          UPLOAD_CONCURRENCY,
          async (f) => {
            await withRetry(() => uploadSceneFile(targetKey, toUploadFile(f)));
            uploadedNames.current.add(f.name);
          },
          (d, total) => {
            setProgress({ done: d, total });
            setStatus(t("viewer.status.uploadingFiles", { done: d, total }));
          },
        );
      }

      // Step 3 — store the annotation PNGs and the final settings/link.
      setStatus(t("viewer.status.savingSettings"));
      const annForSave = await ensureAnnotationPngs({ sceneKey: targetKey }, annotations);
      await saveSceneSettings(targetKey, collectSettings(), title, annForSave);
      setAnnotations(annForSave);
      setShare(shareUrl(targetKey));
      setShareOpen(false);
      void loadPanel();
      return targetKey;
    } catch (e) {
      // The scene may have been created before the failure; refresh the list
      // so it can be deleted (and its files cleaned up) instead of leaking.
      void loadPanel();
      setError(e instanceof Error ? e.message : t("viewer.errors.shareFailed"));
      return null;
    } finally {
      setProgress(null);
      setStatus(null);
      setBusy(false);
    }
  }, [cfg, sceneKey, sceneName, collectSettings, loadPanel, annotations, ensureAnnotationPngs, t]);

  const preset = (c: number, w: number) => {
    setWc(c);
    setWw(w);
  };

  /** Volta um plano para a orientacao ortogonal original do exame. */
  const resetPlane = useCallback(
    (plane: Plane) => {
      if (!volume) return;
      setPlaneStates((s) => ({ ...s, [plane]: defaultPlaneState(volume, plane) }));
    },
    [volume],
  );

  /** Volta os tres planos para a orientacao ortogonal original. */
  const resetAllPlanes = useCallback(() => {
    if (volume) setPlaneStates(defaultPlaneStates(volume));
  }, [volume]);

  /**
   * Espelha os voxels do volume em um eixo para corrigir a orientação do exame
   * (ex.: exame abrindo de cabeça para baixo). Alterna o eixo: aplicar de novo
   * no mesmo eixo restaura o volume. Não altera as dimensões/espaçamentos, logo
   * os planos MPR e o cursor 3D continuam válidos.
   */
  const toggleFlip = useCallback((axis: VolumeAxis) => {
    const v = volumeRef.current;
    if (!v) return;
    const next: FlipFlags = { ...volumeFlipRef.current, [axis]: !volumeFlipRef.current[axis] };
    volumeFlipRef.current = next;
    setVolumeFlip(next);
    flipVolumeInPlace(v, axis);
    setVolume({ ...v });
  }, []);

  /** Desfaz todos os espelhamentos, restaurando a orientação original. */
  const resetFlip = useCallback(() => {
    const v = volumeRef.current;
    const flags = volumeFlipRef.current;
    if (v && (flags.x || flags.y || flags.z)) {
      for (const axis of VOLUME_AXES) if (flags[axis]) flipVolumeInPlace(v, axis);
      setVolume({ ...v });
    }
    volumeFlipRef.current = ZERO_FLIP;
    setVolumeFlip(ZERO_FLIP);
  }, []);

  /** Restaura todos os parâmetros de visualização aos padrões. */
  const handleResetAll = useCallback(() => {
    setInvert(false);
    setThreshold(0.45);
    setOpacity(0.35);
    setShowVolume(true);
    setShowPlanes({ axial: true, coronal: true, sagittal: true });
    if (volume) {
      setWc(volume.windowCenter);
      setWw(volume.windowWidth);
    }
    resetAllPlanes();
    resetFlip();
  }, [volume, resetAllPlanes, resetFlip]);

  const hasData = !!volume || meshes.length > 0;

  /**
   * Carregamento direto de DICOM a partir de arquivos/pasta do disco.
   * No modo local (sem WordPress) é sempre permitido; dentro do WordPress
   * depende da opção do administrador (padrão: desativado = só Drive/OneDrive).
   * Quando o carregamento público está habilitado, também permite sem login.
   */
  const allowDirectDicom = !cfg || cfg.directDicomEnabled === true || canLoadPublicly;

  /**
   * Permite abrir exames por URL (Drive/OneDrive) sem login quando o
   * carregamento público está habilitado.
   */
  const allowUrlLoading = canLoadPublicly;

  /**
   * `webkitdirectory` é um atributo não padronizado e não consta nos tipos do
   * React, então é aplicado de forma imperativa no input de pasta DICOM.
   */
  useEffect(() => {
    const el = dicomFolderInput.current;
    if (!el) return;
    el.setAttribute("webkitdirectory", "");
    el.setAttribute("directory", "");
  }, [allowDirectDicom]);

  const handleSegmentAction = useCallback(async () => {
    if (!cfg || segBusy || busy) return;
    if (!hasData) {
      setError(t("viewer.errors.segmentBefore"));
      return;
    }
    if (!hasAvailableSegType && sceneKey) return;

    // Se carregamento público está habilitado mas usuário não está logado, exige autenticação via modal
    if (!cfg.canUpload && canLoadPublicly && cfg?.loginUrl) {
      const authenticated = await new Promise<boolean>((resolve) => {
        loginModalResolve.current = resolve;
        setLoginModalOpen(true);
        setLoginModalChecking(false);
      });

      if (authenticated) {
        // O onAuthChange já atualizou userPanel e chamou loadPanel
      } else {
        return;
      }
    }

    let targetKey: string | null = sceneKey;
    if (!targetKey) {
      const created = await publishScene();
      if (!created) return;
      targetKey = created;
      try {
        window.history.replaceState(null, "", shareUrl(targetKey));
      } catch {
        /* ambiente sem History API: ignora */
      }
    }
    const targetTitle =
      (targetKey && currentSceneSummary?.key === targetKey
        ? currentSceneSummary.title
        : sceneName.trim()) || t("viewer.share.defaultTitle");
    const summary: SceneSummary =
      currentSceneSummary && currentSceneSummary.key === targetKey
        ? currentSceneSummary
        : {
            key: targetKey!,
            title: targetTitle,
            fileCount: 0,
            bytes: 0,
            created: new Date().toISOString(),
            segmentationUsed: false,
            segmentationStatus: null,
            segmentations: {},
          };
    if (segTypesEnabled.length === 1) {
      await handleSegmentScene(summary, segTypesEnabled[0]!.id);
    } else {
      setSegPicker({ key: targetKey!, title: targetTitle, summary });
    }
  }, [
    cfg,
    canLoadPublicly,
    segBusy,
    busy,
    hasData,
    sceneKey,
    currentSceneSummary,
    sceneName,
    publishScene,
    handleSegmentScene,
    segTypesEnabled,
    hasAvailableSegType,
    t,
  ]);

  /**
   * Cria uma cena nova de fato: navega para a raiz do visualizador sem nenhuma
   * cena e recarrega, limpando qualquer volume/modelo carregado na sessão.
   */
  const handleCreateScene = useCallback(() => {
    try {
      sessionStorage.setItem("v_dicom_new_scene", "1");
    } catch {
      /* storage indisponível: apenas navega */
    }
    const base = cfg?.viewerUrl || window.location.href.split("?")[0]!;
    const current = window.location.href.split("?")[0]!;
    if (current === base) window.location.reload();
    else window.location.href = base;
  }, [cfg]);
  const storage = userPanel?.storage ?? null;
  const storageBlocked =
    !!storage && (storage.blocked || (storage.limitBytes > 0 && storage.availableBytes <= 0));

  useEffect(() => {
    const onFs = () => setIsFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const toggleFullscreen = () => {
    const el = rootRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  };

  const annColorPicker = (
    <label
      className="icon-btn relative cursor-pointer"
      title={t("viewer.annotations.color")}
      aria-label={t("viewer.annotations.color")}
    >
      <input
        type="color"
        value={annColor}
        onChange={(e) => setAnnColor(e.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        aria-label={t("viewer.annotations.color")}
      />
      <span
        className="h-3.5 w-3.5 rounded-full border border-white/20"
        style={{ background: annColor }}
      />
    </label>
  );

  /** Mostra o botão de tela cheia apenas quando o dispositivo suporta a API. */
  const canFullscreen =
    typeof document !== "undefined" &&
    typeof document.documentElement?.requestFullscreen === "function" &&
    document.fullscreenEnabled !== false;

  return (
    <div ref={rootRef} className="flex h-[100dvh] overflow-hidden bg-background text-foreground">
      <input
        ref={stlInput}
        type="file"
        multiple
        accept=".stl,.ply,.obj,.mtl,.png,.jpg,.jpeg,.zip"
        className="hidden"
        onChange={async (e) => {
          const picked = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (!picked.length) return;
          sourceFiles.current = [...sourceFiles.current, ...picked];
          const all = await expandArchives(picked);
          await addMeshFiles(all);
        }}
      />

      {allowDirectDicom && (
        <>
          <input
            ref={dicomInput}
            type="file"
            multiple
            accept=".dcm,.dicom,.ima,.img,.zip,.nrrd,.nii,.gz,.bin"
            className="hidden"
            onChange={async (e) => {
              const picked = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (!picked.length) return;
              await loadDicom(picked);
            }}
          />
          <input
            ref={dicomFolderInput}
            type="file"
            multiple
            className="hidden"
            onChange={async (e) => {
              const picked = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (!picked.length) return;
              await loadDicom(picked);
            }}
          />
        </>
      )}

      <div className="relative flex min-h-0 w-full flex-col">
        {/* ── Header ─────────────────────────────────────────────────── */}
        <ViewerHeader
          brandLogo={brandLogo}
          brandName={brandName}
          cfg={cfg}
          route={route}
          setRoute={setRoute}
          volume={volume}
          sceneKey={sceneKey}
          sceneName={sceneName}
          isMobile={isMobile}
          isDesktop={isDesktop}
          hasData={hasData}
          canUpload={canUpload}
          canLoadPublicly={canLoadPublicly}
          allowDirectDicom={allowDirectDicom}
          expanded={expanded}
          setExpanded={setExpanded}
          panelOpen={panelOpen}
          setPanelOpen={setPanelOpen}
          canFullscreen={canFullscreen}
          isFull={isFull}
          toggleFullscreen={toggleFullscreen}
          stlInput={stlInput}
          dicomInput={dicomInput}
          dicomFolderInput={dicomFolderInput}
          setShare={setShare}
          shareUrl={shareUrl}
          openShare={openShare}
          storageBlocked={storageBlocked}
          setDownloadOpen={setDownloadOpen}
          status={status}
          busy={busy}
          segTypesEnabled={segTypesEnabled}
          segCost={segCost}
          segBusy={segBusy}
          canSegmentCurrentScene={canSegmentCurrentScene}
          handleSegmentAction={handleSegmentAction}
          currentSceneSummary={currentSceneSummary}
          annMode={annMode}
          setAnnMode={setAnnMode}
          setUrlOpen={setUrlOpen}
          setUrlValue={setUrlValue}
        />

        {error && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-destructive/40 bg-destructive/10 px-3 py-1.5 text-[11px] text-destructive">
            <span className="min-w-0 flex-1">{error}</span>
            <button
              className="btn-chip"
              onClick={() => setError(null)}
              aria-label={t("viewer.errors.closeWarning")}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        <ShareDialog
          open={shareOpen}
          sceneKey={sceneKey}
          sceneName={sceneName}
          onSceneNameChange={setSceneName}
          busy={busy}
          progress={progress}
          sourceFiles={sourceFiles.current}
          uploadedNames={uploadedNames.current}
          hasSourceUrl={!!sceneSourceUrl.current}
          storage={storage}
          storageBlocked={storageBlocked}
          onClose={() => setShareOpen(false)}
          onPublish={publishScene}
        />

        <ShareLinkBar
          share={share}
          onClose={() => setShare(null)}
          onShowQr={() => setQrOpen(true)}
        />

        <QrDialog open={qrOpen} share={share} onClose={() => setQrOpen(false)} />

        <RecordingAudioDialog
          open={recordingAudioOpen}
          onOpenChange={setRecordingAudioOpen}
          onStartWithoutAudio={() => startPanelRecording(false)}
          onStartWithAudio={() => startPanelRecording(true)}
        />

        <VideoPreviewDialog
          open={panelRecording.previewOpen}
          onOpenChange={panelRecording.setPreviewOpen}
          videoUrl={panelRecording.videoUrl}
          fileNamePattern={cfg?.recordingNamePattern}
          fileExtension={recordingFileExtension(panelRecording.videoMime)}
          title={t("viewer.recording.previewTitle")}
          description={t("viewer.recording.previewDesc")}
          downloadLabel={t("viewer.recording.download")}
          shareLabel={t("viewer.recording.share")}
          shareFailedLabel={t("viewer.recording.shareFailed")}
          closeLabel={t("viewer.common.close")}
        />

        {sceneKey && (
          <SceneDownloadModal
            open={downloadOpen}
            onOpenChange={setDownloadOpen}
            scene={sceneKey ? { key: sceneKey, title: sceneName } : null}
            meshVisibility={meshVisibility}
          />
        )}

        <LoginRequiredModal
          open={loginModalOpen}
          onOpenChange={setLoginModalOpen}
          loginUrl={cfg?.loginUrl || ""}
          onLoginClick={() => setLoginModalChecking(true)}
          isChecking={loginModalChecking}
        />

        <div className="flex min-h-0 flex-1">
          {route === "viewer" && (
            <>
              {/* ── Trilho lateral (desktop) ──────────────────────────── */}
              <ViewerRail
                isDesktop={isDesktop}
                hasData={hasData}
                canUpload={canUpload}
                annMode={annMode}
                annTool={annTool}
                setAnnTool={setAnnTool}
                showLines={showLines}
                setShowLines={setShowLines}
                volume={volume}
                expanded={expanded}
                setExpanded={setExpanded}
                resetAllPlanes={resetAllPlanes}
                annColorPicker={annColorPicker}
                recording={panelRecording.recording}
                recordedSeconds={panelRecording.seconds}
                onToggleRecording={requestRecordingToggle}
              />

              <div className="flex min-h-0 flex-1 flex-col">
                {/* Barra de ferramentas de anotação (tablet) */}
                <TabletAnnotationBar
                  isTablet={isTablet}
                  annMode={annMode}
                  canUpload={canUpload}
                  annTool={annTool}
                  setAnnTool={setAnnTool}
                  annColor={annColor}
                  setAnnColor={setAnnColor}
                />

                {/* Abas de plano (mobile: um viewport em foco) */}
                <MobilePlaneTabs
                  isMobile={isMobile}
                  volume={volume}
                  status={status}
                  expanded={expanded}
                  setExpanded={setExpanded}
                />

                <div className="flex min-h-0 flex-1">
                  <main className="relative min-h-0 flex-1 p-1.5 sm:p-2">
                    {!volume && !status && meshes.length > 0 && (
                      <div className="viewport-frame h-full">
                        <div className="viewport-header">
                          <span className="plane-label text-muted-foreground">3D / STL</span>
                          <span className="data-mono text-[9px] text-muted-foreground">
                            {t("viewer.status.meshCount", { count: meshes.length })}
                          </span>
                        </div>
                        <div className="min-h-0 flex-1">
                          <Volume3DAsync
                            volume={null}
                            meshes={meshes}
                            threshold={threshold}
                            opacity={opacity}
                            showVolume={showVolume}
                            showPlanes={showPlanes}
                            cross={cross}
                            planes={planeStates}
                            wc={wc}
                            ww={ww}
                            invert={invert}
                            centerRequest={centerRequest}
                          />
                        </div>
                      </div>
                    )}

                    {!volume && !status && !meshes.length && (
                      <EmptyState
                        isDraggingFile={isDraggingFile}
                        canUpload={canUpload}
                        canLoadPublicly={canLoadPublicly}
                        allowDirectDicom={allowDirectDicom}
                        allowUrlLoading={allowUrlLoading}
                        error={error}
                        dicomInput={dicomInput}
                        dicomFolderInput={dicomFolderInput}
                        stlInput={stlInput}
                        uploadIconRef={uploadIconRef}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={async (e) => {
                          e.preventDefault();
                          const files = Array.from(e.dataTransfer.files ?? []);
                          if (!files.length) return;
                          if (allowDirectDicom) {
                            // Arquivos e pasta DICOM (além de STL/ZIP) são aceitos
                            // diretamente; `loadDicom` já separa meshes do volume.
                            await loadDicom(files);
                            return;
                          }
                          const meshFiles = files.filter((f) =>
                            /\.(stl|ply|obj|mtl|png|jpe?g|bmp|gif|webp|zip)$/i.test(f.name),
                          );
                          if (meshFiles.length) {
                            sourceFiles.current = [...sourceFiles.current, ...meshFiles];
                            const all = await expandArchives(meshFiles);
                            await addMeshFiles(all);
                          } else {
                            setUrlErrorDetail(t("viewer.errors.dragMeshOnly"));
                            setUrlErrorOpen(true);
                          }
                        }}
                        onOpenUrl={() => {
                          setUrlValue("");
                          setUrlOpen(true);
                        }}
                        onLogin={() => {
                          const url = cfg?.loginUrl || `${cfg?.homeUrl || ""}/wp-login.php`;
                          if (url) window.location.href = url;
                        }}
                      />
                    )}

                    {status && quizWhileLoading && (
                      <QuizLoadingPanel
                        status={status}
                        progress={sceneProgress}
                        quizUrl={quizUrl}
                        quizText={quizText}
                      />
                    )}

                    {status && !quizWhileLoading && (
                      <div className="flex h-full flex-col items-center justify-center gap-3 text-primary">
                        <LoadingIcons size={200} />
                        <p className="data-mono text-xs text-primary">{status}</p>
                      </div>
                    )}

                    {volume && !status && (
                      <ViewportGrid
                        volume={volume}
                        meshes={meshes}
                        threshold={threshold}
                        opacity={opacity}
                        showVolume={showVolume}
                        showPlanes={showPlanes}
                        cross={cross}
                        planeStates={planeStates}
                        wc={wc}
                        ww={ww}
                        invert={invert}
                        centerRequest={centerRequest}
                        preciseRender={renderMode === "precise"}
                        containerRef={viewportGridRef}
                        render3dRef={volume3dRenderRef}
                        expanded={expanded}
                        setExpanded={setExpanded}
                        isMobile={isMobile}
                        annMode={annMode}
                        annTool={annTool}
                        annotations={annotations}
                        annActive={annActive}
                        onCreateAnnotation={onCreateAnnotation}
                        showLines={showLines}
                        onToggleLines={() => setShowLines((v) => !v)}
                        resetPlane={resetPlane}
                        onWindow={(a, b) => {
                          setWc(a);
                          setWw(b);
                        }}
                        onStates={(fn) => setPlaneStates((s) => fn(s))}
                        recording={panelRecording.recording}
                        recordedSeconds={panelRecording.seconds}
                        onToggleRecording={requestRecordingToggle}
                      />
                    )}

                    {panelRecording.recording && (
                      <div
                        role="status"
                        aria-live="polite"
                        aria-label={t("viewer.recording.indicator")}
                        className="pointer-events-none absolute bottom-4 left-4 z-30 flex items-center gap-2 rounded-full bg-red-600 px-2.5 py-1.5 text-white shadow-lg"
                      >
                        <span
                          aria-hidden
                          className="relative flex h-2.5 w-2.5 items-center justify-center"
                        >
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-60" />
                          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" />
                        </span>
                        <span className="text-[9px] font-bold uppercase tracking-wider">
                          {t("viewer.recording.indicator")}
                        </span>
                        <span className="font-mono text-[11px] font-semibold leading-none tabular-nums">
                          {formatRecordingDuration(panelRecording.seconds)}
                        </span>
                      </div>
                    )}
                  </main>

                  {/* ── Painel de parâmetros (desktop/tablet) ─────────── */}
                  <ViewerSidePanel
                    isMobile={isMobile}
                    isTablet={isTablet}
                    route={route}
                    panelOpen={panelOpen}
                    hasData={hasData}
                    volume={volume}
                    sceneName={sceneName}
                    meshes={meshes}
                    meshVolumes={meshVolumes}
                    wc={wc}
                    ww={ww}
                    setWc={setWc}
                    setWw={setWw}
                    threshold={threshold}
                    setThreshold={setThreshold}
                    opacity={opacity}
                    setOpacity={setOpacity}
                    showVolume={showVolume}
                    setShowVolume={setShowVolume}
                    showPlanes={showPlanes}
                    setShowPlanes={setShowPlanes}
                    volumeFlip={volumeFlip}
                    toggleFlip={toggleFlip}
                    resetFlip={resetFlip}
                    annotations={annotations}
                    sortedAnnotations={sortedAnnotations}
                    annMode={annMode}
                    annActive={annActive}
                    canUpload={canUpload}
                    selectAnnotation={selectAnnotation}
                    toggleAnnotationVisibility={toggleAnnotationVisibility}
                    deleteAnnotation={deleteAnnotation}
                    patchMesh={patchMesh}
                    requestMeshDelete={requestMeshDelete}
                    centerMesh={centerMesh}
                    setMeshes={setMeshes}
                    resetAllPlanes={resetAllPlanes}
                    handleResetAll={handleResetAll}
                    recording={panelRecording.recording}
                    recordedSeconds={panelRecording.seconds}
                    onToggleRecording={requestRecordingToggle}
                  />
                </div>
              </div>
            </>
          )}

          {route === "profile" && (
            <main className="min-h-0 w-full flex-1 overflow-y-auto p-3 sm:p-4">
              <ProfileView
                displayName={userPanel?.displayName ?? ""}
                userPanel={userPanel}
                recentScenes={recentScenes}
                error={panelError}
                shopUrl={cfg?.shopUrl ?? ""}
                segBusy={segBusy}
                panelBusy={panelBusy}
                segCost={segCost}
                onRefresh={() => void loadPanel()}
                onDeleteScene={(s) => void handleDeleteScene(s)}
                onSegmentScene={(s) => void handleSegmentScene(s)}
                onCreateScene={handleCreateScene}
              />
            </main>
          )}
        </div>

        {/* ── Navegação inferior (mobile) ─────────────────────────────── */}
        <MobileBottomNav
          isMobile={isMobile}
          route={route}
          volume={volume}
          status={status}
          activeSheet={activeSheet}
          setActiveSheet={setActiveSheet}
          canUpload={canUpload}
          meshes={meshes}
        />

        {/* ── Painel secundário (mobile) ──────────────────────────────── */}
        <MobileSheets
          isMobile={isMobile}
          route={route}
          activeSheet={activeSheet}
          volume={volume}
          status={status}
          setActiveSheet={setActiveSheet}
          expanded={expanded}
          resetAllPlanes={resetAllPlanes}
          wc={wc}
          ww={ww}
          setWc={setWc}
          setWw={setWw}
          handleResetAll={handleResetAll}
          volumeFlip={volumeFlip}
          toggleFlip={toggleFlip}
          resetFlip={resetFlip}
          threshold={threshold}
          setThreshold={setThreshold}
          opacity={opacity}
          setOpacity={setOpacity}
          showVolume={showVolume}
          setShowVolume={setShowVolume}
          showPlanes={showPlanes}
          setShowPlanes={setShowPlanes}
          meshes={meshes}
          meshVolumes={meshVolumes}
          cfg={cfg}
          annMode={annMode}
          setAnnMode={setAnnMode}
          annTool={annTool}
          setAnnTool={setAnnTool}
          annColor={annColor}
          setAnnColor={setAnnColor}
          annotations={annotations}
          sortedAnnotations={sortedAnnotations}
          annActive={annActive}
          canUpload={canUpload}
          selectAnnotation={selectAnnotation}
          toggleAnnotationVisibility={toggleAnnotationVisibility}
          deleteAnnotation={deleteAnnotation}
          patchMesh={patchMesh}
          requestMeshDelete={requestMeshDelete}
          centerMesh={centerMesh}
          setMeshes={setMeshes}
          stlInput={stlInput}
          showLines={showLines}
          setShowLines={setShowLines}
          recording={panelRecording.recording}
          recordedSeconds={panelRecording.seconds}
          onToggleRecording={requestRecordingToggle}
        />
      </div>
      {DEBUG_OVERLAY_ENABLED && <DebugOverlay />}

      <OpenUrlDialog
        open={urlOpen}
        onOpenChange={setUrlOpen}
        value={urlValue}
        onValueChange={setUrlValue}
        onSubmit={(url) => void openByUrl(url)}
      />

      <UrlErrorDialog open={urlErrorOpen} onOpenChange={setUrlErrorOpen} detail={urlErrorDetail} />

      <SegmentationProgressDialog
        modal={segModal}
        pct={segFakePct}
        onClose={() => setSegModal(null)}
      />

      <SegmentationPickerDialog
        picker={segPicker}
        types={segTypesEnabled}
        credits={userPanel?.credits ?? 0}
        busy={!!segBusy}
        getStatus={(summary, typeId) => (summary ? getSegStatus(summary, typeId) : null)}
        onClose={() => setSegPicker(null)}
        onChoose={(summary, typeId) => {
          setSegPicker(null);
          void handleSegmentScene(summary, typeId);
        }}
      />

      {multiSeriesGroups && multiSeriesGroups.length > 1 && (
        <MultiSeriesModal
          open={multiSeriesOpen}
          onOpenChange={setMultiSeriesOpen}
          groups={multiSeriesGroups}
          openedName={multiSeriesOpenedName}
        />
      )}

      <CreditConfirmDialog
        open={creditConfirmOpen}
        credits={creditConfirmData.current?.credits ?? 0}
        onOpenChange={setCreditConfirmOpen}
        onCancel={() => {
          creditConfirmResolve.current(false);
          setCreditConfirmOpen(false);
        }}
        onConfirm={() => {
          creditConfirmResolve.current(true);
          setCreditConfirmOpen(false);
        }}
      />

      <MeshDeleteDialog
        open={meshDeleteConfirmOpen}
        meshName={meshDeleteConfirmData.current?.name}
        onOpenChange={setMeshDeleteConfirmOpen}
        onCancel={cancelMeshDelete}
        onHide={() => {
          const data = meshDeleteConfirmData.current;
          if (data) {
            patchMesh(data.id, { visible: false });
          }
          cancelMeshDelete();
        }}
        onDelete={confirmMeshDelete}
      />
    </div>
  );
}

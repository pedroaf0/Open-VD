import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowUpDown,
  Box,
  Boxes,
  ChevronDown,
  Crosshair,
  Eye,
  EyeOff,
  FileDown,
  FileUp,
  FlipHorizontal2,
  FlipVertical2,
  FolderOpen,
  FolderUp,
  Layers,
  LayoutGrid,
  Link2,
  Maximize2,
  Minimize2,
  MousePointer2,
  MoveUpRight,
  Palette,
  PanelRightClose,
  PanelRightOpen,
  PenLine,
  PenTool,
  Plus,
  QrCode,
  Ruler,
  RotateCcw,
  Share2,
  SlidersHorizontal,
  Type,
  User,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
import { MultiSeriesModal } from "@/components/MultiSeriesModal";
import { hookConsole, DEBUG_OVERLAY_ENABLED } from "@/lib/debuglog";
import { DebugOverlay } from "@/components/DebugPanel";
import { SliceView } from "@/components/SliceView";
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
import { Volume3D, type MeshFile } from "@/components/Volume3D";
import { ProfileView } from "@/components/ProfileView";
import { SceneDownloadModal } from "@/components/SceneDownloadModal";
import { LoadingIcons } from "@/components/LoadingIcons";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import i18n from "@/i18n";
import { UploadIcon, type UploadIconHandle } from "@/components/UploadIcon";
import { QRCode } from "react-qr-code";
import { formatBytes, pctUsed } from "@/lib/format";
import { registerServiceWorker } from "@/lib/pwa";
import { cn } from "@/lib/utils";
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
} from "@/lib/wp";
import { computeMeshFileVolume, formatMeshVolume } from "@/lib/meshVolume";

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

const FORCED_MESH_COLORS: Record<string, string> = {
  "maxila e cranio superior": "#FFF3B0",
  mandibula: "#FFF3B0",
  "dentes superiores": "#FFFFFF",
  "dentes inferiores": "#FFFFFF",
  "canal mandibular": "#FF0000",
};
const normalizeMeshName = (n: string) =>
  n
    .replace(/\.(stl|ply|obj)$/i, "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
const forcedMeshColor = (name: string): string | undefined =>
  FORCED_MESH_COLORS[normalizeMeshName(name)];

const MESH_COLORS = ["#9fd9ff", "#ffb3c1", "#c9f7a1", "#ffd580", "#d5b3ff", "#7fe3d4"];

const formatMb = (bytes: number) =>
  bytes <= 0
    ? "0 KB"
    : bytes < 1048576
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1048576).toFixed(1)} MB`;

const formatSpeed = (bps: number) =>
  bps <= 0
    ? ""
    : bps < 1048576
      ? `${(bps / 1024).toFixed(1)} KB/s`
      : `${(bps / 1048576).toFixed(2)} MB/s`;

const formatEta = (seconds: number) => {
  if (seconds < 60) {
    return i18n.t("viewer.quiz.etaSeconds", { value: Math.max(1, Math.round(seconds)) });
  }
  const m = Math.floor(seconds / 60);
  const s = Math.ceil(seconds % 60);
  return m >= 60
    ? i18n.t("viewer.quiz.etaHours", {
        hours: Math.floor(m / 60),
        minutes: String(m % 60).padStart(2, "0"),
      })
    : i18n.t("viewer.quiz.etaMinutes", { minutes: m, seconds: String(s).padStart(2, "0") });
};

type DownloadProgress = {
  done: number;
  total: number;
  receivedBytes: number;
  totalBytes: number;
  speedBps: number;
};

/** Ferramentas de anotação existentes, na ordem de apresentação. */
const ANN_TOOLS: Array<{ key: Tool; labelKey: string; icon: LucideIcon }> = [
  { key: "select", labelKey: "viewer.annTools.select", icon: MousePointer2 },
  { key: "ruler", labelKey: "viewer.annTools.ruler", icon: Ruler },
  { key: "arrow", labelKey: "viewer.annTools.arrow", icon: MoveUpRight },
  { key: "mark", labelKey: "viewer.annTools.mark", icon: Crosshair },
  { key: "draw", labelKey: "viewer.annTools.draw", icon: PenLine },
  { key: "text", labelKey: "viewer.annTools.text", icon: Type },
];

/** Abas de plano exibidas no mobile (um viewport em foco por vez). */
const PLANE_TABS: Array<{
  key: "axial" | "coronal" | "sagittal" | "3d";
  labelKey: string;
  color: string;
  hintKey: string;
}> = [
  {
    key: "axial",
    labelKey: "viewer.planes.axial",
    color: "var(--axial)",
    hintKey: "viewer.planes.hintAxial",
  },
  {
    key: "coronal",
    labelKey: "viewer.planes.coronal",
    color: "var(--coronal)",
    hintKey: "viewer.planes.hintCoronal",
  },
  {
    key: "sagittal",
    labelKey: "viewer.planes.sagittal",
    color: "var(--sagittal)",
    hintKey: "viewer.planes.hintSagittal",
  },
  {
    key: "3d",
    labelKey: "viewer.planes.tab3d",
    color: "oklch(0.6 0 0)",
    hintKey: "viewer.planes.hint3d",
  },
];

/** Painel exibido enquanto uma cena compartilhada carrega: progresso no topo + iframe de espera (opcional). */
function QuizLoadingPanel({
  status,
  progress,
  quizUrl,
  quizText,
}: {
  status: string;
  progress: DownloadProgress | null;
  quizUrl: string;
  quizText: string;
}) {
  const { t } = useTranslation();
  const totalBytes = progress && progress.totalBytes > 0 ? progress.totalBytes : 0;
  const pct = progress
    ? totalBytes > 0
      ? Math.min(100, Math.round((progress.receivedBytes / totalBytes) * 100))
      : Math.round((progress.done / Math.max(1, progress.total)) * 100)
    : 0;
  const text = quizText.trim() || t("viewer.quiz.defaultText");
  const url = quizUrl.trim();
  const speed = progress && progress.speedBps > 0 ? formatSpeed(progress.speedBps) : "";
  const eta =
    progress && totalBytes > 0 && progress.speedBps > 0
      ? formatEta((totalBytes - progress.receivedBytes) / progress.speedBps)
      : "";
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2">
      <section className="card-panel shrink-0 space-y-2 p-3">
        <div className="flex items-baseline justify-between gap-3">
          <p className="data-mono text-xs text-primary">{status}</p>
          {progress && (
            <span className="data-mono text-[10px] text-muted-foreground">
              {totalBytes > 0
                ? `${formatMb(progress.receivedBytes)} / ${formatMb(totalBytes)}`
                : `${progress.done}/${progress.total}`}{" "}
              · {pct}%
            </span>
          )}
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-panel-2">
          {progress ? (
            <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
          ) : (
            <div className="h-full w-1/3 animate-pulse rounded-full bg-primary/60" />
          )}
        </div>
        {progress && progress.receivedBytes > 0 && (
          <p className="data-mono text-[11px] text-muted-foreground">
            {t("viewer.quiz.transferred", { value: formatMb(progress.receivedBytes) })}
            {speed ? <> · {speed}</> : null}
            {eta ? <> · {eta}</> : null}
          </p>
        )}
        <p className="text-xs text-muted-foreground">{text}</p>
      </section>
      {url && (
        <iframe
          src={url}
          title={text}
          className="min-h-0 w-full flex-1 rounded-lg border border-border bg-background"
          allowFullScreen
        />
      )}
    </div>
  );
}

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
  const [volume, setVolume] = useState<Volume | null>(null);
  /** referência do volume atual, usada pelos controles de orientação */
  const volumeRef = useRef<Volume | null>(null);
  volumeRef.current = volume;
  /** eixos espelhados para corrigir a orientação do volume (ver FlipFlags) */
  const [volumeFlip, setVolumeFlip] = useState<FlipFlags>(ZERO_FLIP);
  const volumeFlipRef = useRef(volumeFlip);
  volumeFlipRef.current = volumeFlip;
  const [meshes, setMeshes] = useState<MeshFile[]>([]);
  const meshVolumeCacheRef = useRef<Map<string, string | null>>(new Map());
  const meshVolumes = useMemo(() => {
    const cache = meshVolumeCacheRef.current;
    const out = new Map<string, string | null>();
    for (const mf of meshes) {
      if (cache.has(mf.id)) {
        out.set(mf.id, cache.get(mf.id) ?? null);
        continue;
      }
      const info = computeMeshFileVolume(mf);
      const label = info?.closed && info.volumeMm3 > 0 ? formatMeshVolume(info.volumeMm3) : null;
      cache.set(mf.id, label);
      out.set(mf.id, label);
    }
    for (const k of [...cache.keys()]) if (!out.has(k)) cache.delete(k);
    return out;
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
  const [showVolume, setShowVolume] = useState(true);
  const [showPlanes, setShowPlanes] = useState({ axial: true, coronal: true, sagittal: true });
  /** Painel lateral de parâmetros (desktop/tablet). */
  const [panelOpen, setPanelOpen] = useState(() =>
    typeof window === "undefined" ? true : window.innerWidth >= 1024,
  );
  const [expanded, setExpanded] = useState<"axial" | "coronal" | "sagittal" | "3d" | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
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
  const urlInput = useRef<HTMLInputElement>(null);
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

  const openShare = useCallback(() => {
    setSceneName((n) => n || "");

    // Exibe nome do paciente automaticamente em todas as telas
    setShareOpen(true);
    void loadPanel();
  }, [loadPanel]);

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
  const meshesRef = useRef(meshes);
  const sceneKeyRef = useRef(sceneKey);
  useEffect(() => {
    meshesRef.current = meshes;
  }, [meshes]);
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

  const canUpload = !cfg || cfg.canUpload;
  const hasData = !!volume || meshes.length > 0;

  /**
   * Carregamento direto de DICOM a partir de arquivos/pasta do disco.
   * No modo local (sem WordPress) é sempre permitido; dentro do WordPress
   * depende da opção do administrador (padrão: desativado = só Drive/OneDrive).
   */
  const allowDirectDicom = !cfg || cfg.directDicomEnabled === true;

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
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card px-2 sm:px-3">
          <div className="flex min-w-0 items-center gap-2">
            <a
              href={cfg?.homeUrl || "/"}
              className="flex min-w-0 items-center gap-2 hover:opacity-80 transition-opacity"
              title={t("viewer.header.homeTitle")}
            >
              {brandLogo && (
                <img src={brandLogo} alt="" className="h-6 max-w-[140px] object-contain" />
              )}
              {brandName ? (
                <span className="truncate text-sm font-bold tracking-tight">{brandName}</span>
              ) : (
                <span className="whitespace-nowrap text-sm font-bold tracking-tight">
                  Visor<span className="text-primary">DICOM</span>
                </span>
              )}
              <span className="hidden text-[10px] font-medium uppercase tracking-wider text-muted-foreground lg:inline">
                MPR · 3D · STL
              </span>
            </a>
            {route === "viewer" && volume && (
              <div className="hidden min-w-0 flex-col border-l border-border pl-3 xl:flex">
                <span className="truncate text-[11px] font-semibold leading-tight text-foreground">
                  {sceneName.trim() || volume.studyDescription || t("viewer.header.defaultStudy")}
                </span>
                <span className="data-mono truncate text-[9px] leading-tight text-muted-foreground">
                  {volume.modality} · {volume.nx}×{volume.ny}×{volume.nz} · {volume.sx.toFixed(2)}/
                  {volume.sz.toFixed(2)} mm
                </span>
              </div>
            )}
          </div>

          <div className="ml-auto flex min-w-0 items-center gap-1">
            {/* Modo de navegação / anotação */}
            {route === "viewer" && canUpload && volume && !status && (
              <div
                className="mr-1 hidden items-center overflow-hidden rounded-md border border-border bg-panel md:flex"
                role="group"
                aria-label={t("viewer.nav.group")}
              >
                <button
                  className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide transition ${
                    !annMode
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setAnnMode(false)}
                  title={t("viewer.nav.modeTitle")}
                  aria-pressed={!annMode}
                >
                  {t("viewer.nav.label")}
                </button>
                <button
                  className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide transition ${
                    annMode
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setAnnMode(true)}
                  title={t("viewer.nav.annTitle")}
                  aria-pressed={annMode}
                >
                  {t("viewer.nav.annLabel")}
                </button>
              </div>
            )}

            {/* Abrir arquivos */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="icon-btn gap-1.5 sm:w-auto sm:px-2.5"
                  aria-label={t("viewer.header.openFiles")}
                  title={t("viewer.header.openFiles")}
                >
                  <FolderOpen className="h-4 w-4" />
                  <span className="hidden text-[11px] font-semibold sm:inline">
                    {t("viewer.header.addFiles")}
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="group-title">
                  {t("viewer.header.openFiles")}
                </DropdownMenuLabel>
                {allowDirectDicom && (
                  <DropdownMenuItem onSelect={() => dicomInput.current?.click()}>
                    <FileUp className="h-4 w-4" />
                    {t("viewer.header.openDicom")}
                  </DropdownMenuItem>
                )}
                {allowDirectDicom && (
                  <DropdownMenuItem onSelect={() => dicomFolderInput.current?.click()}>
                    <FolderUp className="h-4 w-4" />
                    {t("viewer.header.openDicomFolder")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => stlInput.current?.click()}>
                  <Box className="h-4 w-4" />
                  STL / PLY / OBJ
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    setUrlValue("");
                    setUrlOpen(true);
                  }}
                >
                  <Link2 className="h-4 w-4" />
                  {t("viewer.header.openByUrl")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Voltar ao mosaico */}
            {expanded && isDesktop && (
              <button
                className="btn-ghost hidden md:flex"
                onClick={() => setExpanded(null)}
                title={t("viewer.grid.backToGridTooltip")}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                {t("viewer.grid.multiview")}
              </button>
            )}

            {/* Painel de parâmetros */}
            {!isMobile && route === "viewer" && hasData && (
              <button
                className="icon-btn"
                onClick={() => setPanelOpen((o) => !o)}
                aria-pressed={panelOpen}
                aria-label={t("viewer.header.paramsPanel")}
                title={t("viewer.header.paramsPanel")}
              >
                {panelOpen ? (
                  <PanelRightClose className="h-4 w-4" />
                ) : (
                  <PanelRightOpen className="h-4 w-4" />
                )}
              </button>
            )}

            {/* Idioma */}
            <LanguageSwitcher />

            {/* Perfil */}
            {cfg?.canUpload && (
              <button
                className="icon-btn"
                onClick={() => setRoute((r) => (r === "profile" ? "viewer" : "profile"))}
                title={
                  route === "profile"
                    ? t("viewer.header.backToViewer")
                    : t("viewer.header.profileTitle")
                }
                aria-label={
                  route === "profile" ? t("viewer.header.backToViewer") : t("viewer.header.profile")
                }
              >
                <User className="h-4 w-4" />
              </button>
            )}

            {/* Compartilhar */}
            {cfg?.canUpload && hasData && (
              <button
                className="btn-primary"
                onClick={openShare}
                disabled={storageBlocked}
                title={storageBlocked ? t("viewer.header.storageLimit") : undefined}
              >
                <Share2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">
                  {sceneKey ? t("viewer.header.saveAndShare") : t("viewer.header.share")}
                </span>
              </button>
            )}
            {!cfg?.canUpload && sceneKey && (
              <button className="btn-ghost" onClick={() => setShare(shareUrl(sceneKey))}>
                {t("viewer.header.copyLink")}
              </button>
            )}
            {sceneKey && (
              <button
                className="btn-ghost gap-1.5"
                onClick={() => setDownloadOpen(true)}
                title={t("viewer.header.downloadFiles")}
              >
                <FileDown className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t("viewer.header.download")}</span>
              </button>
            )}
            {cfg?.canUpload && hasData && (canSegmentCurrentScene || !sceneKey) && (
              <button
                className="btn-ghost gap-1.5"
                disabled={!!segBusy || !!busy}
                onClick={() => void handleSegmentAction()}
                title={t("viewer.segmentation.chooseType")}
              >
                <Boxes className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">
                  {segBusy || busy
                    ? t("viewer.segmentation.segmenting")
                    : segTypesEnabled.length > 1
                      ? t("viewer.segmentation.segment")
                      : segCost === 0
                        ? t("viewer.segmentation.segment")
                        : t("viewer.segmentation.segmentWithCost", { cost: segCost })}
                </span>
              </button>
            )}
            {sceneKey &&
            currentSceneSummary &&
            currentSceneSummary.segmentations &&
            Object.keys(currentSceneSummary.segmentations).length > 0 ? (
              <span
                className="hidden items-center gap-1 text-[10px] text-muted-foreground sm:inline-flex"
                title={Object.entries(currentSceneSummary.segmentations)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(" | ")}
              >
                {Object.entries(currentSceneSummary.segmentations).map(([k, v]) => (
                  <span
                    key={k}
                    className={
                      v === "COMPLETED"
                        ? "text-green-500"
                        : v === "FAILED"
                          ? "text-destructive"
                          : ""
                    }
                  >
                    {k}: {v === "COMPLETED" ? "✓" : v === "FAILED" ? "✕" : "⏳"} {v}
                  </span>
                ))}
              </span>
            ) : sceneKey && currentSceneSummary?.segmentationUsed ? (
              <span
                className="hidden items-center gap-1 text-[10px] text-muted-foreground sm:inline-flex"
                title={t("viewer.segmentation.statusTitle", {
                  status: currentSceneSummary.segmentationStatus ?? "",
                })}
              >
                {currentSceneSummary.segmentationStatus === "COMPLETED"
                  ? t("viewer.segmentation.doneMark")
                  : currentSceneSummary.segmentationStatus === "FAILED"
                    ? t("viewer.segmentation.failedMark")
                    : `⏳ ${currentSceneSummary.segmentationStatus ?? "IN_QUEUE"}`}
              </span>
            ) : null}

            {/* Tela cheia (somente se suportado) */}
            {canFullscreen && (
              <button
                className="icon-btn"
                onClick={toggleFullscreen}
                aria-label={
                  isFull ? t("viewer.header.exitFullscreen") : t("viewer.header.fullscreen")
                }
                title={isFull ? t("viewer.header.exitFullscreen") : t("viewer.header.fullscreen")}
              >
                {isFull ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </button>
            )}
          </div>
        </header>

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

        {shareOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
            onClick={() => !busy && setShareOpen(false)}
          >
            <div
              className="card-panel w-full max-w-sm space-y-3 p-4"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label={t("viewer.share.title")}
            >
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold">{t("viewer.share.title")}</h2>
                <button
                  className="icon-btn-sm"
                  onClick={() => setShareOpen(false)}
                  disabled={busy}
                  aria-label={t("viewer.common.close")}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <label className="block space-y-1">
                <span className="data-mono text-[10px] text-muted-foreground">
                  {t("viewer.share.nameLabel")}
                </span>
                <input
                  value={sceneName}
                  onChange={(e) => setSceneName(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs"
                  placeholder={t("viewer.share.namePlaceholder")}
                />
              </label>
              <p className="text-[11px] text-muted-foreground">
                {sceneKey
                  ? (() => {
                      const pending = sourceFiles.current.filter(
                        (f) => !uploadedNames.current.has(f.name),
                      ).length;
                      return pending
                        ? t("viewer.share.pendingFiles", { count: pending })
                        : t("viewer.share.existsUpdate");
                    })()
                  : (() => {
                      const toUpload = sourceFiles.current.filter(
                        (f) => !uploadedNames.current.has(f.name),
                      ).length;
                      if (sceneSourceUrl.current && toUpload === 0) {
                        return t("viewer.share.urlOnly");
                      }
                      if (sceneSourceUrl.current && toUpload > 0) {
                        return t("viewer.share.urlMixed", { count: toUpload });
                      }
                      return t("viewer.share.uploadFiles", { count: toUpload });
                    })()}
              </p>
              {storageBlocked && (
                <p className="text-[11px] text-destructive">
                  {storage?.blocked
                    ? t("viewer.share.storageBlocked")
                    : t("viewer.share.storageFull")}
                </p>
              )}
              {progress && (
                <div className="space-y-1">
                  <div className="h-1.5 w-full overflow-hidden rounded bg-panel-2">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }}
                    />
                  </div>
                  <p className="data-mono text-[10px] text-muted-foreground">
                    {progress.done}/{progress.total}
                  </p>
                </div>
              )}
              <div className="flex justify-end gap-2">
                <button className="btn-chip" onClick={() => setShareOpen(false)} disabled={busy}>
                  {t("viewer.common.cancel")}
                </button>
                <button
                  className="btn-primary"
                  onClick={publishScene}
                  disabled={busy || storageBlocked}
                >
                  {busy
                    ? t("viewer.status.uploading")
                    : sceneKey
                      ? t("viewer.share.saveAndGenerate")
                      : t("viewer.share.sendAndGenerate")}
                </button>
              </div>
            </div>
          </div>
        )}

        {share && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-panel px-3 py-2 text-[11px]">
            <span className="data-mono text-muted-foreground">{t("viewer.share.linkLabel")}</span>
            <input
              readOnly
              value={share}
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px]"
            />
            <button className="btn-chip" onClick={() => navigator.clipboard?.writeText(share)}>
              {t("viewer.common.copy")}
            </button>
            <button
              className="btn-chip"
              onClick={() => setQrOpen(true)}
              title={t("viewer.share.showQr")}
              aria-label={t("viewer.share.showQr")}
            >
              <QrCode className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">QR</span>
            </button>
            <button className="btn-chip" onClick={() => setShare(null)}>
              {t("viewer.common.close")}
            </button>
          </div>
        )}

        {qrOpen && share && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
            onClick={() => setQrOpen(false)}
          >
            <div
              className="card-panel flex w-full max-w-sm flex-col items-center gap-3 p-5"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label={t("viewer.share.qrAria")}
            >
              <div className="flex w-full items-center justify-between">
                <span className="group-title">{t("viewer.share.qrTitle")}</span>
                <button
                  className="icon-btn-sm"
                  onClick={() => setQrOpen(false)}
                  aria-label={t("viewer.common.close")}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="rounded-lg border border-border bg-white p-3">
                <QRCode value={share} size={220} />
              </div>
              <p className="data-mono w-full truncate text-[10px] text-muted-foreground">{share}</p>
              <button className="btn-primary w-full" onClick={() => setQrOpen(false)}>
                {t("viewer.common.close")}
              </button>
            </div>
          </div>
        )}

        {sceneKey && (
          <SceneDownloadModal
            open={downloadOpen}
            onOpenChange={setDownloadOpen}
            scene={sceneKey ? { key: sceneKey, title: sceneName } : null}
          />
        )}

        <div className="flex min-h-0 flex-1">
          {route === "viewer" && (
            <>
              {/* ── Trilho lateral (desktop) ──────────────────────────── */}
              {isDesktop && hasData && (
                <nav className="rail py-2" aria-label={t("viewer.rail.tools")}>
                  <button
                    className={cn("icon-btn", !showLines && "icon-btn-active")}
                    onClick={() => setShowLines((v) => !v)}
                    aria-pressed={showLines}
                    aria-label={t("viewer.rail.referenceLines")}
                    title={
                      showLines
                        ? t("viewer.rail.hideReferenceLines")
                        : t("viewer.rail.showReferenceLines")
                    }
                  >
                    {showLines ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                  </button>

                  {canUpload && annMode && (
                    <>
                      <div className="rail-sep" aria-hidden />
                      {ANN_TOOLS.map((tool) => (
                        <button
                          key={tool.key}
                          className={cn("icon-btn", annTool === tool.key && "icon-btn-active")}
                          onClick={() => setAnnTool(tool.key)}
                          aria-pressed={annTool === tool.key}
                          aria-label={t(tool.labelKey)}
                          title={t(tool.labelKey)}
                        >
                          <tool.icon className="h-4 w-4" />
                        </button>
                      ))}
                      {annColorPicker}
                    </>
                  )}

                  <div className="flex-1" />

                  {volume && (
                    <>
                      <button
                        className="icon-btn"
                        onClick={resetAllPlanes}
                        aria-label={t("viewer.mpr.resetOblique")}
                        title={t("viewer.mpr.resetOblique")}
                      >
                        <RotateCcw className="h-4 w-4" />
                      </button>
                      {expanded && (
                        <button
                          className="icon-btn"
                          onClick={() => setExpanded(null)}
                          aria-label={t("viewer.grid.backToGrid")}
                          title={t("viewer.grid.backToGrid")}
                        >
                          <LayoutGrid className="h-4 w-4" />
                        </button>
                      )}
                    </>
                  )}
                </nav>
              )}

              <div className="flex min-h-0 flex-1 flex-col">
                {/* Barra de ferramentas de anotação (tablet) */}
                {isTablet && annMode && canUpload && (
                  <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border bg-card px-2 py-1.5">
                    <span className="group-title mr-1">{t("viewer.annTools.tool")}</span>
                    {ANN_TOOLS.map((tool) => (
                      <button
                        key={tool.key}
                        className={cn(
                          "flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold transition",
                          annTool === tool.key
                            ? "bg-primary text-primary-foreground"
                            : "bg-panel text-muted-foreground hover:text-foreground",
                        )}
                        onClick={() => setAnnTool(tool.key)}
                        aria-pressed={annTool === tool.key}
                      >
                        <tool.icon className="h-3.5 w-3.5" />
                        {t(tool.labelKey)}
                      </button>
                    ))}
                    <span className="ml-1 flex items-center gap-1.5 rounded-md border border-border bg-panel px-2 py-1">
                      <input
                        type="color"
                        value={annColor}
                        onChange={(e) => setAnnColor(e.target.value)}
                        className="h-4 w-6 cursor-pointer rounded border border-border bg-transparent p-0"
                        aria-label={t("viewer.annotations.color")}
                      />
                      <Palette className="h-3 w-3 text-muted-foreground" />
                    </span>
                    <span className="ml-auto hidden text-[10px] text-muted-foreground sm:inline">
                      {t("viewer.annotations.lockedHint")}
                    </span>
                  </div>
                )}

                {/* Abas de plano (mobile: um viewport em foco) */}
                {isMobile && volume && !status && (
                  <div
                    className="flex shrink-0 gap-1 border-b border-border bg-card px-2 py-1"
                    role="tablist"
                    aria-label={t("viewer.planes.tabsAria")}
                  >
                    {PLANE_TABS.map((tab) => {
                      const active = (expanded ?? "axial") === tab.key;
                      return (
                        <button
                          key={tab.key}
                          role="tab"
                          aria-selected={active}
                          aria-label={t(tab.hintKey)}
                          onClick={() => setExpanded(tab.key)}
                          className={cn(
                            "flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-[10px] font-bold uppercase tracking-wider transition",
                            active
                              ? "bg-panel-2 text-foreground"
                              : "text-muted-foreground active:bg-panel-2",
                          )}
                        >
                          <i
                            className="h-1.5 w-1.5 rounded-full"
                            style={{ background: tab.color }}
                          />
                          {t(tab.labelKey)}
                        </button>
                      );
                    })}
                  </div>
                )}

                <div className="flex min-h-0 flex-1">
                  <main className="min-h-0 flex-1 p-1.5 sm:p-2">
                    {!volume && !status && meshes.length > 0 && (
                      <div className="viewport-frame h-full">
                        <div className="viewport-header">
                          <span className="plane-label text-muted-foreground">3D / STL</span>
                          <span className="data-mono text-[9px] text-muted-foreground">
                            {t("viewer.status.meshCount", { count: meshes.length })}
                          </span>
                        </div>
                        <div className="min-h-0 flex-1">
                          <Volume3D
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
                          />
                        </div>
                      </div>
                    )}

                    {!volume && !status && !meshes.length && (
                      <div
                        className={cn(
                          "flex h-full items-center justify-center rounded-lg border border-dashed p-4 transition-colors duration-200",
                          isDraggingFile ? "border-primary bg-card/80" : "border-border",
                        )}
                        onDragOver={(e) => {
                          e.preventDefault();
                        }}
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
                      >
                        <div className="flex max-w-md flex-col items-center text-center">
                          <UploadIcon
                            ref={uploadIconRef}
                            size={48}
                            className="mb-4 cursor-pointer text-muted-foreground/70 transition-colors hover:text-foreground"
                            onMouseEnter={() => uploadIconRef.current?.startAnimation()}
                            onMouseLeave={() => uploadIconRef.current?.stopAnimation()}
                            aria-hidden
                          />
                          <h2 className="font-display text-xl font-bold">
                            {canUpload ? t("viewer.empty.loadStudy") : t("viewer.empty.noScene")}
                          </h2>
                          <p className="mt-2 text-xs text-muted-foreground">
                            {canUpload
                              ? allowDirectDicom
                                ? t("viewer.empty.loadStudyHintDirect")
                                : t("viewer.empty.loadStudyHint")
                              : t("viewer.empty.loginHint")}
                          </p>
                          {canUpload && (
                            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                              {allowDirectDicom && (
                                <button
                                  className="btn-primary gap-1.5"
                                  onClick={() => dicomInput.current?.click()}
                                >
                                  <FileUp className="h-3.5 w-3.5" />
                                  {t("viewer.header.openDicom")}
                                </button>
                              )}
                              {allowDirectDicom && (
                                <button
                                  className="btn-ghost gap-1.5"
                                  onClick={() => dicomFolderInput.current?.click()}
                                >
                                  <FolderUp className="h-3.5 w-3.5" />
                                  {t("viewer.header.openDicomFolder")}
                                </button>
                              )}
                              <button
                                className={
                                  allowDirectDicom ? "btn-ghost gap-1.5" : "btn-primary gap-1.5"
                                }
                                onClick={() => {
                                  setUrlValue("");
                                  setUrlOpen(true);
                                }}
                              >
                                <Link2 className="h-3.5 w-3.5" />
                                {t("viewer.header.openByUrl")}
                              </button>
                              <button
                                className="btn-ghost"
                                onClick={() => stlInput.current?.click()}
                              >
                                <Box className="h-3.5 w-3.5" />
                                STL / PLY / OBJ
                              </button>
                            </div>
                          )}
                          {!canUpload && (
                            <button
                              className="btn-primary mt-4"
                              onClick={() => {
                                const url = cfg?.loginUrl || `${cfg?.homeUrl || ""}/wp-login.php`;
                                if (url) window.location.href = url;
                              }}
                            >
                              {t("viewer.empty.login")}
                            </button>
                          )}
                          {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
                        </div>
                      </div>
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
                      <div
                        className={
                          expanded
                            ? "grid h-full grid-cols-1 grid-rows-1 gap-1.5 sm:gap-2"
                            : "grid h-full grid-cols-1 grid-rows-4 gap-1.5 md:grid-cols-2 md:grid-rows-2 sm:gap-2"
                        }
                      >
                        {(!expanded || expanded === "axial") && (
                          <SliceView
                            volume={volume}
                            plane="axial"
                            label={t("viewer.planes.axial")}
                            accent="var(--axial)"
                            wc={wc}
                            ww={ww}
                            onWindow={(a, b) => {
                              setWc(a);
                              setWw(b);
                            }}
                            invert={invert}
                            states={planeStates}
                            onStates={(fn) => setPlaneStates((s) => fn(s))}
                            accents={ACCENTS}
                            onResetPlane={resetPlane}
                            expanded={expanded === "axial"}
                            onToggleExpand={
                              isMobile
                                ? undefined
                                : () => setExpanded((e) => (e === "axial" ? null : "axial"))
                            }
                            annotating={annMode}
                            tool={annTool}
                            annotations={annotations}
                            annActive={annActive}
                            onCreateAnnotation={onCreateAnnotation}
                            showLines={showLines}
                            onToggleLines={() => setShowLines((v) => !v)}
                          />
                        )}
                        {(!expanded || expanded === "coronal") && (
                          <SliceView
                            volume={volume}
                            plane="coronal"
                            label={t("viewer.planes.coronal")}
                            accent="var(--coronal)"
                            wc={wc}
                            ww={ww}
                            onWindow={(a, b) => {
                              setWc(a);
                              setWw(b);
                            }}
                            invert={invert}
                            states={planeStates}
                            onStates={(fn) => setPlaneStates((s) => fn(s))}
                            accents={ACCENTS}
                            onResetPlane={resetPlane}
                            expanded={expanded === "coronal"}
                            onToggleExpand={
                              isMobile
                                ? undefined
                                : () => setExpanded((e) => (e === "coronal" ? null : "coronal"))
                            }
                            annotating={annMode}
                            tool={annTool}
                            annotations={annotations}
                            annActive={annActive}
                            onCreateAnnotation={onCreateAnnotation}
                            showLines={showLines}
                            onToggleLines={() => setShowLines((v) => !v)}
                          />
                        )}
                        {(!expanded || expanded === "sagittal") && (
                          <SliceView
                            volume={volume}
                            plane="sagittal"
                            label={t("viewer.planes.sagittal")}
                            accent="var(--sagittal)"
                            wc={wc}
                            ww={ww}
                            onWindow={(a, b) => {
                              setWc(a);
                              setWw(b);
                            }}
                            invert={invert}
                            states={planeStates}
                            onStates={(fn) => setPlaneStates((s) => fn(s))}
                            accents={ACCENTS}
                            onResetPlane={resetPlane}
                            expanded={expanded === "sagittal"}
                            onToggleExpand={
                              isMobile
                                ? undefined
                                : () => setExpanded((e) => (e === "sagittal" ? null : "sagittal"))
                            }
                            annotating={annMode}
                            tool={annTool}
                            annotations={annotations}
                            annActive={annActive}
                            onCreateAnnotation={onCreateAnnotation}
                            showLines={showLines}
                            onToggleLines={() => setShowLines((v) => !v)}
                          />
                        )}
                        {(!expanded || expanded === "3d") && (
                          <div className="viewport-frame">
                            <div className="viewport-header">
                              <span className="plane-label text-muted-foreground">3D / STL</span>
                              <span className="flex items-center gap-1">
                                <span className="data-mono text-[9px] text-muted-foreground">
                                  {t("viewer.planes.dragToRotate")}
                                </span>
                                {!isMobile && (
                                  <button
                                    className="icon-btn-sm"
                                    title={
                                      expanded === "3d"
                                        ? t("viewer.grid.backToGrid")
                                        : t("viewer.grid.expand")
                                    }
                                    aria-label={
                                      expanded === "3d"
                                        ? t("viewer.grid.backToGrid")
                                        : t("viewer.grid.expand3d")
                                    }
                                    onClick={() => setExpanded((e) => (e === "3d" ? null : "3d"))}
                                  >
                                    {expanded === "3d" ? (
                                      <Minimize2 className="h-3.5 w-3.5" />
                                    ) : (
                                      <Maximize2 className="h-3.5 w-3.5" />
                                    )}
                                  </button>
                                )}
                              </span>
                            </div>
                            <div className="min-h-0 flex-1">
                              <Volume3D
                                volume={volume}
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
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </main>

                  {/* ── Painel de parâmetros (desktop/tablet) ─────────── */}
                  {!isMobile && route === "viewer" && panelOpen && hasData && (
                    <aside
                      className="flex max-h-full min-h-0 w-[280px] shrink-0 flex-col gap-2.5 overflow-x-hidden overflow-y-auto border-l border-border bg-card p-3"
                      aria-label={t("viewer.panel.aria")}
                    >
                      <Section title={t("viewer.panel.studyTitle")}>
                        <p className="truncate text-xs font-semibold">{sceneName.trim() || "—"}</p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {volume?.studyDescription ?? t("viewer.panel.noStudy")}
                        </p>
                        {volume && (
                          <p className="data-mono text-[10px] leading-relaxed text-muted-foreground">
                            {volume.modality} · {volume.nx}×{volume.ny}×{volume.nz}
                            <br />
                            {volume.sx.toFixed(2)} / {volume.sz.toFixed(2)} mm
                          </p>
                        )}
                      </Section>

                      {volume && (
                        <Section
                          title={t("viewer.panel.windowingTitle")}
                          right={<MousePointer2 className="h-3 w-3 text-muted-foreground" />}
                        >
                          <Range
                            label={`WL ${Math.round(wc)}`}
                            min={-1000}
                            max={3000}
                            value={wc}
                            onChange={setWc}
                          />
                          <Range
                            label={`WW ${Math.round(ww)}`}
                            min={1}
                            max={4000}
                            value={ww}
                            onChange={setWw}
                          />
                        </Section>
                      )}

                      {volume && (
                        <Section title="MPR">
                          <button className="btn-chip w-full" onClick={resetAllPlanes}>
                            <RotateCcw className="h-3.5 w-3.5" />
                            {t("viewer.mpr.resetOblique")}
                          </button>
                        </Section>
                      )}

                      {volume && (
                        <Section title={t("viewer.orientation.title")}>
                          <FlipControls
                            flags={volumeFlip}
                            onToggle={toggleFlip}
                            onReset={resetFlip}
                          />
                        </Section>
                      )}

                      {volume && (
                        <Section title={t("viewer.panel.reconstructionTitle")}>
                          <Range
                            label={`${t("viewer.panel.density")} ${(threshold * 100).toFixed(0)}%`}
                            min={0}
                            max={0.95}
                            step={0.01}
                            value={threshold}
                            onChange={setThreshold}
                          />
                          <Range
                            label={`${t("viewer.panel.opacity")} ${(opacity * 100).toFixed(0)}%`}
                            min={0.02}
                            max={1}
                            step={0.01}
                            value={opacity}
                            onChange={setOpacity}
                          />
                          <button
                            className="btn-chip w-full"
                            onClick={() => setShowVolume((s) => !s)}
                          >
                            {showVolume
                              ? t("viewer.panel.hideVolume")
                              : t("viewer.panel.showVolume")}
                          </button>

                          <p className="group-title pt-1">{t("viewer.panel.planesIn3d")}</p>
                          <div className="grid grid-cols-3 gap-1">
                            {(["axial", "coronal", "sagittal"] as const).map((p) => (
                              <button
                                key={p}
                                className="btn-chip"
                                style={{ opacity: showPlanes[p] ? 1 : 0.4 }}
                                onClick={() => setShowPlanes((s) => ({ ...s, [p]: !s[p] }))}
                                aria-pressed={showPlanes[p]}
                              >
                                {p === "axial" ? "Ax" : p === "coronal" ? "Cor" : "Sag"}
                              </button>
                            ))}
                          </div>
                        </Section>
                      )}

                      {meshes.length > 0 && (
                        <Section
                          title={t("viewer.panel.modelsTitle")}
                          defaultOpen={false}
                          right={
                            <span className="data-mono text-[9px] text-muted-foreground">
                              {meshes.length}
                            </span>
                          }
                        >
                          {meshes.map((m) => (
                            <div key={m.id} className="space-y-1">
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="color"
                                  value={m.color}
                                  onChange={(e) =>
                                    setMeshes((list) =>
                                      list.map((x) =>
                                        x.id === m.id ? { ...x, color: e.target.value } : x,
                                      ),
                                    )
                                  }
                                  className="h-5 w-6 shrink-0 cursor-pointer rounded border border-border bg-transparent"
                                  aria-label={t("viewer.meshes.colorOf", { name: m.name })}
                                />
                                <button
                                  className="min-w-0 flex-1 truncate text-left text-[11px]"
                                  title={m.name}
                                  onClick={() =>
                                    setMeshes((list) =>
                                      list.map((x) =>
                                        x.id === m.id ? { ...x, visible: !x.visible } : x,
                                      ),
                                    )
                                  }
                                  style={{ opacity: m.visible ? 1 : 0.4 }}
                                  aria-pressed={m.visible}
                                >
                                  {m.name}
                                  {meshVolumes.get(m.id) ? (
                                    <span className="ml-1.5 font-mono text-[10px] font-normal text-muted-foreground">
                                      · {meshVolumes.get(m.id)}
                                    </span>
                                  ) : null}
                                </button>
                                <button
                                  className="icon-btn-sm"
                                  onClick={() =>
                                    setMeshes((list) => list.filter((x) => x.id !== m.id))
                                  }
                                  aria-label={t("viewer.meshes.remove", { name: m.name })}
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                              <input
                                type="range"
                                min={0.05}
                                max={1}
                                step={0.01}
                                value={m.opacity}
                                onChange={(e) =>
                                  setMeshes((list) =>
                                    list.map((x) =>
                                      x.id === m.id ? { ...x, opacity: Number(e.target.value) } : x,
                                    ),
                                  )
                                }
                                className="w-full accent-primary"
                                style={{ accentColor: "var(--primary)" }}
                                aria-label={t("viewer.meshes.opacityOf", { name: m.name })}
                              />
                              <button
                                className="btn-chip w-full py-1 text-[10px]"
                                onClick={() =>
                                  setMeshes((list) =>
                                    list.map((x) =>
                                      x.id === m.id
                                        ? {
                                            ...x,
                                            coordSystem: x.coordSystem === "ras" ? "lps" : "ras",
                                          }
                                        : x,
                                    ),
                                  )
                                }
                                title={t("viewer.panel.coordSystem")}
                              >
                                {m.coordSystem === "lps" ? "LPS (DICOM)" : "RAS (Slicer)"}
                              </button>
                            </div>
                          ))}
                          {meshes.length > 1 && (
                            <button
                              className="btn-chip w-full"
                              onClick={() =>
                                setMeshes((list) => {
                                  const allOn = list.every((x) => x.visible);
                                  return list.map((x) => ({ ...x, visible: !allOn }));
                                })
                              }
                            >
                              {t("viewer.panel.showHideAll")}
                            </button>
                          )}
                          {meshes.length > 0 && (
                            <button className="btn-chip w-full" onClick={() => setMeshes([])}>
                              {t("viewer.panel.removeAll")}
                            </button>
                          )}
                        </Section>
                      )}

                      {volume && canUpload && (
                        <Section
                          title={t("viewer.panel.annotationsTitle")}
                          defaultOpen={false}
                          right={
                            annotations.length > 0 ? (
                              <span className="data-mono text-[9px] text-muted-foreground">
                                {annotations.length}
                              </span>
                            ) : undefined
                          }
                        >
                          {!annotations.length && (
                            <p className="text-[11px] text-muted-foreground">
                              {annMode
                                ? t("viewer.annotations.emptyDraw")
                                : t("viewer.annotations.empty")}
                            </p>
                          )}
                          <div className="max-h-44 space-y-1 overflow-y-auto pr-0.5">
                            {sortedAnnotations.map((a) => (
                              <button
                                key={a.id}
                                onClick={() => selectAnnotation(a)}
                                className={cn(
                                  "flex w-full items-center gap-1.5 rounded-md border px-1.5 py-1 text-left text-[11px]",
                                  annActive === a.id
                                    ? "border-primary bg-panel-2"
                                    : "border-border bg-panel-2/60 hover:border-primary",
                                  a.hidden && "opacity-50",
                                )}
                              >
                                <i
                                  className="h-2 w-2 shrink-0 rounded-full"
                                  style={{ background: a.color }}
                                />
                                <span className="min-w-0 flex-1 truncate">
                                  {a.kind === "measure"
                                    ? a.measure
                                      ? `${a.measure.lengthMm.toFixed(1)} mm`
                                      : t("viewer.annotations.measure")
                                    : a.kind === "text"
                                      ? a.text || a.label || t("viewer.annotations.text")
                                      : a.kind === "arrow"
                                        ? t("viewer.annTools.arrow")
                                        : a.kind === "draw"
                                          ? t("viewer.annTools.draw")
                                          : t("viewer.annTools.mark")}
                                </span>
                                <span className="data-mono text-[9px] uppercase text-muted-foreground">
                                  {a.plane.slice(0, 3)}
                                </span>
                                {canUpload && (
                                  <span
                                    className="cursor-pointer px-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                                    title={
                                      a.hidden
                                        ? t("viewer.annotations.show")
                                        : t("viewer.annotations.hide")
                                    }
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toggleAnnotationVisibility(a.id);
                                    }}
                                  >
                                    {a.hidden ? (
                                      <EyeOff className="h-3 w-3" />
                                    ) : (
                                      <Eye className="h-3 w-3" />
                                    )}
                                  </span>
                                )}
                                {annMode && canUpload && (
                                  <span
                                    className="px-1 text-[11px] text-destructive hover:opacity-70"
                                    title={t("viewer.annotations.delete")}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      deleteAnnotation(a.id);
                                    }}
                                  >
                                    <X className="h-3 w-3" />
                                  </span>
                                )}
                              </button>
                            ))}
                          </div>
                        </Section>
                      )}

                      {volume && (
                        <Section title={t("viewer.panel.shortcutsTitle")} defaultOpen={false}>
                          <div className="space-y-1 text-[10px] leading-relaxed text-muted-foreground">
                            <p>{t("viewer.shortcuts.wheel")}</p>
                            <p>{t("viewer.shortcuts.dragIntersection")}</p>
                            <p>{t("viewer.shortcuts.dragLine")}</p>
                            <p>{t("viewer.shortcuts.dragCircles")}</p>
                            <p>{t("viewer.shortcuts.rightButton")}</p>
                            <p>{t("viewer.shortcuts.ctrlWheel")}</p>
                            <p>{t("viewer.shortcuts.eye")}</p>
                          </div>
                        </Section>
                      )}

                      {hasData && (
                        <button className="btn-ghost w-full" onClick={handleResetAll}>
                          <RotateCcw className="h-3.5 w-3.5" />
                          {t("viewer.panel.resetAll")}
                        </button>
                      )}
                    </aside>
                  )}
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
        {isMobile && route === "viewer" && volume && !status && (
          <nav
            className="flex h-14 shrink-0 items-stretch border-t border-border bg-card"
            aria-label={t("viewer.nav.label")}
          >
            {(
              [
                { key: "cortes", label: t("viewer.mobile.navCortes"), icon: Layers, show: true },
                {
                  key: "janela",
                  label: t("viewer.mobile.navJanela"),
                  icon: SlidersHorizontal,
                  show: true,
                },
                { key: "3d", label: "3D", icon: Box, show: true },
                {
                  key: "modelos",
                  label: t("viewer.mobile.navModelos"),
                  icon: Boxes,
                  show: canUpload || meshes.length > 0,
                },
                {
                  key: "anotar",
                  label: t("viewer.mobile.navAnotar"),
                  icon: PenTool,
                  show: canUpload,
                },
              ] as Array<{
                key: "cortes" | "janela" | "3d" | "modelos" | "anotar";
                label: string;
                icon: LucideIcon;
                show: boolean;
              }>
            )
              .filter((i) => i.show)
              .map((i) => {
                const open = activeSheet === i.key;
                return (
                  <button
                    key={i.key}
                    className={cn(
                      "flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition",
                      open ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                    onClick={() => {
                      setActiveSheet((s) => (s === i.key ? null : i.key));
                    }}
                    aria-pressed={open}
                  >
                    <i.icon className="h-5 w-5" />
                    <span>{i.label}</span>
                  </button>
                );
              })}
          </nav>
        )}

        {/* ── Painel secundário (mobile) ──────────────────────────────── */}
        {isMobile && route === "viewer" && activeSheet && volume && !status && (
          <div className="absolute inset-x-0 bottom-14 top-12 z-40 flex flex-col justify-end">
            <div className="absolute inset-0" onClick={() => setActiveSheet(null)} aria-hidden />
            <div
              className="relative max-h-[75%] w-full overflow-y-auto rounded-t-2xl border-t border-l border-r border-border bg-card p-3 shadow-2xl"
              role="dialog"
              aria-modal="true"
              aria-label={t("viewer.mobile.panelAria", { sheet: activeSheet })}
            >
              <div className="mb-2.5 flex items-center justify-between">
                <span className="group-title">
                  {activeSheet === "cortes"
                    ? t("viewer.mobile.navCortes")
                    : activeSheet === "janela"
                      ? t("viewer.mobile.navJanela")
                      : activeSheet === "3d"
                        ? t("viewer.panel.reconstructionTitle")
                        : activeSheet === "modelos"
                          ? t("viewer.panel.modelsTitle")
                          : t("viewer.panel.annotationsTitle")}
                </span>
                <button
                  className="icon-btn-sm"
                  onClick={() => setActiveSheet(null)}
                  aria-label={t("viewer.mobile.closePanel")}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {activeSheet === "cortes" && (
                <div className="space-y-2.5">
                  <div className="flex items-center gap-2 rounded-md border border-border bg-panel px-3 py-2">
                    {(() => {
                      const tab = PLANE_TABS.find((tb) => tb.key === (expanded ?? "axial"));
                      return (
                        <>
                          <i className="h-2 w-2 rounded-full" style={{ background: tab?.color }} />
                          <span className="plane-label" style={{ color: tab?.color }}>
                            {tab ? t(tab.labelKey) : null}
                          </span>
                        </>
                      );
                    })()}
                  </div>
                  <button className="btn-chip w-full" onClick={resetAllPlanes}>
                    <RotateCcw className="h-3.5 w-3.5" />
                    {t("viewer.mpr.resetOblique")}
                  </button>
                  <p className="group-title">{t("viewer.orientation.title")}</p>
                  <FlipControls flags={volumeFlip} onToggle={toggleFlip} onReset={resetFlip} />
                  <div className="space-y-1 text-[10px] leading-relaxed text-muted-foreground">
                    <p>{t("viewer.mobile.slicesHint1")}</p>
                    <p>{t("viewer.mobile.slicesHint2")}</p>
                  </div>
                </div>
              )}

              {activeSheet === "janela" && (
                <div className="space-y-3">
                  <Range
                    label={`WL ${Math.round(wc)}`}
                    min={-1000}
                    max={3000}
                    value={wc}
                    onChange={setWc}
                  />
                  <Range
                    label={`WW ${Math.round(ww)}`}
                    min={1}
                    max={4000}
                    value={ww}
                    onChange={setWw}
                  />
                  <button className="btn-chip w-full" onClick={handleResetAll}>
                    <RotateCcw className="h-3.5 w-3.5" />
                    {t("viewer.panel.resetAll")}
                  </button>
                </div>
              )}

              {activeSheet === "3d" && (
                <div className="space-y-3">
                  <Range
                    label={`${t("viewer.panel.density")} ${(threshold * 100).toFixed(0)}%`}
                    min={0}
                    max={0.95}
                    step={0.01}
                    value={threshold}
                    onChange={setThreshold}
                  />
                  <Range
                    label={`${t("viewer.panel.opacity")} ${(opacity * 100).toFixed(0)}%`}
                    min={0.02}
                    max={1}
                    step={0.01}
                    value={opacity}
                    onChange={setOpacity}
                  />
                  <button className="btn-chip w-full" onClick={() => setShowVolume((s) => !s)}>
                    {showVolume ? t("viewer.panel.hideVolume") : t("viewer.panel.showVolume")}
                  </button>
                  <div>
                    <p className="group-title mb-1.5">{t("viewer.panel.planesIn3d")}</p>
                    <div className="grid grid-cols-3 gap-1">
                      {(["axial", "coronal", "sagittal"] as const).map((p) => (
                        <button
                          key={p}
                          className="btn-chip"
                          style={{ opacity: showPlanes[p] ? 1 : 0.4 }}
                          onClick={() => setShowPlanes((s) => ({ ...s, [p]: !s[p] }))}
                          aria-pressed={showPlanes[p]}
                        >
                          {p === "axial" ? "Ax" : p === "coronal" ? "Cor" : "Sag"}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {activeSheet === "modelos" && (
                <div className="space-y-2.5">
                  {cfg?.canUpload && (
                    <button className="btn-ghost w-full" onClick={() => stlInput.current?.click()}>
                      <Plus className="h-3.5 w-3.5" />
                      {t("viewer.panel.addModels")}
                    </button>
                  )}
                  {!meshes.length && (
                    <p className="text-[11px] text-muted-foreground">
                      {t("viewer.panel.noModels")}
                    </p>
                  )}
                  {meshes.map((m) => (
                    <div
                      key={m.id}
                      className="space-y-1 rounded-md border border-border bg-panel p-2"
                    >
                      <div className="flex items-center gap-1.5">
                        <input
                          type="color"
                          value={m.color}
                          onChange={(e) =>
                            setMeshes((list) =>
                              list.map((x) =>
                                x.id === m.id ? { ...x, color: e.target.value } : x,
                              ),
                            )
                          }
                          className="h-5 w-6 shrink-0 cursor-pointer rounded border border-border bg-transparent"
                          aria-label={t("viewer.meshes.colorOf", { name: m.name })}
                        />
                        <button
                          className="min-w-0 flex-1 truncate text-left text-[11px]"
                          title={m.name}
                          onClick={() =>
                            setMeshes((list) =>
                              list.map((x) => (x.id === m.id ? { ...x, visible: !x.visible } : x)),
                            )
                          }
                          style={{ opacity: m.visible ? 1 : 0.4 }}
                          aria-pressed={m.visible}
                        >
                          {m.name}
                          {meshVolumes.get(m.id) ? (
                            <span className="ml-1.5 font-mono text-[10px] font-normal text-muted-foreground">
                              · {meshVolumes.get(m.id)}
                            </span>
                          ) : null}
                        </button>
                        <button
                          className="icon-btn-sm"
                          onClick={() => setMeshes((list) => list.filter((x) => x.id !== m.id))}
                          aria-label={t("viewer.meshes.remove", { name: m.name })}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                      <input
                        type="range"
                        min={0.05}
                        max={1}
                        step={0.01}
                        value={m.opacity}
                        onChange={(e) =>
                          setMeshes((list) =>
                            list.map((x) =>
                              x.id === m.id ? { ...x, opacity: Number(e.target.value) } : x,
                            ),
                          )
                        }
                        className="w-full"
                        style={{ accentColor: "var(--primary)" }}
                        aria-label={t("viewer.meshes.opacityOf", { name: m.name })}
                      />
                      <button
                        className="btn-chip w-full py-1 text-[10px]"
                        onClick={() =>
                          setMeshes((list) =>
                            list.map((x) =>
                              x.id === m.id
                                ? { ...x, coordSystem: x.coordSystem === "ras" ? "lps" : "ras" }
                                : x,
                            ),
                          )
                        }
                      >
                        {m.coordSystem === "lps" ? "LPS (DICOM)" : "RAS (Slicer)"}
                      </button>
                    </div>
                  ))}
                  {meshes.length > 1 && (
                    <button
                      className="btn-chip w-full"
                      onClick={() =>
                        setMeshes((list) => {
                          const allOn = list.every((x) => x.visible);
                          return list.map((x) => ({ ...x, visible: !allOn }));
                        })
                      }
                    >
                      {t("viewer.panel.showHideAll")}
                    </button>
                  )}
                  {meshes.length > 0 && (
                    <button className="btn-chip w-full" onClick={() => setMeshes([])}>
                      {t("viewer.panel.removeAll")}
                    </button>
                  )}
                </div>
              )}

              {activeSheet === "anotar" && canUpload && (
                <div className="space-y-2.5">
                  <button
                    className={cn(
                      "flex w-full items-center justify-center gap-2 rounded-md border px-3 py-2.5 text-xs font-bold transition",
                      annMode
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-panel text-muted-foreground",
                    )}
                    onClick={() => {
                      const next = !annMode;
                      setAnnMode(next);
                      if (next && annTool !== "mark" && annTool !== "text") setAnnTool("mark");
                    }}
                    aria-pressed={annMode}
                  >
                    {annMode ? (
                      <>
                        <Eye className="h-3.5 w-3.5" /> {t("viewer.annotations.modeActive")}
                      </>
                    ) : (
                      <>
                        <PenTool className="h-3.5 w-3.5" /> {t("viewer.annotations.modeEnable")}
                      </>
                    )}
                  </button>
                  {annMode && (
                    <>
                      <div>
                        <p className="group-title mb-1.5">{t("viewer.annTools.tool")}</p>
                        <div className="grid grid-cols-2 gap-1.5">
                          {ANN_TOOLS.filter(
                            (tool) => tool.key === "mark" || tool.key === "text",
                          ).map((tool) => (
                            <button
                              key={tool.key}
                              className={cn(
                                "flex flex-col items-center gap-1 rounded-md border px-2 py-2 text-[10px] font-semibold transition",
                                annTool === tool.key
                                  ? "border-primary bg-panel-2 text-foreground"
                                  : "border-border bg-panel text-muted-foreground hover:text-foreground",
                              )}
                              onClick={() => setAnnTool(tool.key)}
                              aria-pressed={annTool === tool.key}
                            >
                              <tool.icon className="h-4 w-4" />
                              {t(tool.labelKey)}
                            </button>
                          ))}
                        </div>
                      </div>
                      <label className="flex items-center justify-between rounded-md border border-border bg-panel px-3 py-2">
                        <span className="text-[11px] font-medium">
                          {t("viewer.annotations.color")}
                        </span>
                        <input
                          type="color"
                          value={annColor}
                          onChange={(e) => setAnnColor(e.target.value)}
                          className="h-6 w-10 cursor-pointer rounded border border-border bg-transparent"
                          aria-label={t("viewer.annotations.color")}
                        />
                      </label>
                      <p className="text-[10px] text-muted-foreground">
                        {t("viewer.annotations.lockedHintMobile")}
                      </p>
                    </>
                  )}
                  {!annMode && (
                    <p className="text-center text-[10px] text-muted-foreground">
                      {t("viewer.annotations.enableHint")}
                    </p>
                  )}
                  <button className="btn-chip w-full" onClick={() => setShowLines((v) => !v)}>
                    {showLines ? (
                      <>
                        <Eye className="h-3.5 w-3.5" /> {t("viewer.rail.hideReferenceLines")}
                      </>
                    ) : (
                      <>
                        <EyeOff className="h-3.5 w-3.5" /> {t("viewer.rail.showReferenceLines")}
                      </>
                    )}
                  </button>
                  <div>
                    <p className="group-title mb-1.5">
                      {t("viewer.annotations.title")}{" "}
                      {annotations.length ? `· ${annotations.length}` : ""}
                    </p>
                    {!annotations.length ? (
                      <p className="text-[11px] text-muted-foreground">
                        {t("viewer.annotations.empty")}
                      </p>
                    ) : (
                      <div className="max-h-48 space-y-1 overflow-y-auto pr-0.5">
                        {sortedAnnotations.map((a) => (
                          <button
                            key={a.id}
                            onClick={() => selectAnnotation(a)}
                            className={cn(
                              "flex w-full items-center gap-1.5 rounded-md border px-2 py-2 text-left text-[11px]",
                              annActive === a.id
                                ? "border-primary bg-panel-2"
                                : "border-border bg-panel-2/60 hover:border-primary",
                              a.hidden && "opacity-50",
                            )}
                          >
                            <i
                              className="h-2 w-2 shrink-0 rounded-full"
                              style={{ background: a.color }}
                            />
                            <span className="min-w-0 flex-1 truncate">
                              {a.kind === "measure"
                                ? a.measure
                                  ? `${a.measure.lengthMm.toFixed(1)} mm`
                                  : t("viewer.annotations.measure")
                                : a.kind === "text"
                                  ? a.text || a.label || t("viewer.annotations.text")
                                  : a.kind === "arrow"
                                    ? t("viewer.annTools.arrow")
                                    : a.kind === "draw"
                                      ? t("viewer.annTools.draw")
                                      : t("viewer.annTools.mark")}
                            </span>
                            <span className="data-mono shrink-0 text-[9px] uppercase text-muted-foreground">
                              {a.plane.slice(0, 3)}
                            </span>
                            <span
                              className="shrink-0 p-1 text-muted-foreground hover:text-foreground"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleAnnotationVisibility(a.id);
                              }}
                              role="button"
                              tabIndex={0}
                              aria-label={
                                a.hidden
                                  ? t("viewer.annotations.show")
                                  : t("viewer.annotations.hide")
                              }
                            >
                              {a.hidden ? (
                                <EyeOff className="h-3.5 w-3.5" />
                              ) : (
                                <Eye className="h-3.5 w-3.5" />
                              )}
                            </span>
                            {annMode && (
                              <span
                                className="shrink-0 p-1 text-destructive hover:opacity-70"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  deleteAnnotation(a.id);
                                }}
                                role="button"
                                tabIndex={0}
                                aria-label={t("viewer.annotations.delete")}
                              >
                                <X className="h-3.5 w-3.5" />
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      {DEBUG_OVERLAY_ENABLED && <DebugOverlay />}

      <Dialog open={urlOpen} onOpenChange={setUrlOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("viewer.header.openByUrl")}</DialogTitle>
            <DialogDescription>
              {t("viewer.urlDialog.descBefore")} <strong>.zip</strong>{" "}
              {t("viewer.urlDialog.descAfter")}
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void openByUrl(urlValue);
            }}
          >
            <Input
              ref={urlInput}
              autoFocus
              type="url"
              inputMode="url"
              value={urlValue}
              onChange={(e) => setUrlValue(e.target.value)}
              placeholder={t("viewer.urlDialog.placeholder")}
              aria-label={t("viewer.urlDialog.fileUrlAria")}
            />
            <p className="text-[11px] text-muted-foreground">{t("viewer.urlDialog.publicHint")}</p>
            <DialogFooter>
              <button type="button" className="btn-ghost" onClick={() => setUrlOpen(false)}>
                {t("viewer.common.cancel")}
              </button>
              <button type="submit" className="btn-primary" disabled={!urlValue.trim()}>
                <Link2 className="h-3.5 w-3.5" />
                {t("viewer.urlDialog.submit")}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={urlErrorOpen} onOpenChange={setUrlErrorOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("viewer.urlError.title")}</DialogTitle>
            <DialogDescription>{t("viewer.urlError.description")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <ol className="list-decimal space-y-1 pl-5">
              <li>
                <strong>{t("viewer.urlError.publicLinkLabel")}</strong>{" "}
                {t("viewer.urlError.publicLinkText")}
              </li>
              <li>
                <strong>{t("viewer.urlError.zipLabel")}</strong> {t("viewer.urlError.zipText")}
              </li>
            </ol>
            <p className="text-xs text-muted-foreground">{t("viewer.urlError.hint")}</p>
            {urlErrorDetail && (
              <details className="rounded border border-border bg-panel p-2">
                <summary className="cursor-pointer text-xs font-semibold">
                  {t("viewer.urlError.details")}
                </summary>
                <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-all text-[11px]">
                  {urlErrorDetail}
                </pre>
              </details>
            )}
          </div>
          <DialogFooter>
            <button className="btn-primary" onClick={() => setUrlErrorOpen(false)}>
              {t("viewer.urlError.understood")}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!segModal}
        onOpenChange={(o) => {
          if (!o) setSegModal(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("viewer.segmentation.modalTitle")}</DialogTitle>
            <DialogDescription>
              {segModal?.title
                ? t("viewer.segmentation.modalScene", { title: segModal.title })
                : t("viewer.segmentation.modalDesc")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="h-2 w-full overflow-hidden rounded-full bg-panel-2">
              <div
                className="h-full bg-primary transition-all duration-500"
                style={{ width: `${Math.min(100, segFakePct)}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px] text-muted-foreground">
              <span>{Math.min(100, segFakePct).toFixed(1)}%</span>
              <span>
                {(() => {
                  if (!segModal) return "";
                  const elapsed = Math.floor((Date.now() - segModal.startAt) / 1000);
                  const remain = Math.max(0, SEG_FAKE_TOTAL_S - elapsed);
                  const m = Math.floor(remain / 60);
                  const s = remain % 60;
                  return t("viewer.segmentation.modalEta", {
                    time: `${m}:${String(s).padStart(2, "0")}`,
                  });
                })()}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{t("viewer.segmentation.modalLeave")}</p>
            <p className="text-xs text-muted-foreground">{t("viewer.segmentation.modalEmail")}</p>
          </div>
          <DialogFooter>
            <button className="btn-ghost" onClick={() => setSegModal(null)}>
              {t("viewer.segmentation.modalBackground")}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!segPicker}
        onOpenChange={(o) => {
          if (!o) setSegPicker(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("viewer.segmentation.pickerTitle")}</DialogTitle>
            <DialogDescription>{t("viewer.segmentation.pickerDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
            {segTypesEnabled.map((segType) => {
              const st = segPicker?.summary ? getSegStatus(segPicker.summary, segType.id) : null;
              const done = st && st !== "FAILED";
              const failed = st === "FAILED";
              const running = st && st !== "COMPLETED" && st !== "FAILED";
              const canAfford = segType.cost === 0 || (userPanel?.credits ?? 0) >= segType.cost;
              const disabled = !!done || !!running || !!segBusy || !canAfford;
              const costLabel =
                segType.cost === 0
                  ? t("viewer.segmentation.free")
                  : t("viewer.segmentation.credits", { count: segType.cost });
              return (
                <div key={segType.id} className="rounded border border-border p-3 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold">{segType.name}</span>
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-panel-2">
                      {costLabel}
                    </span>
                  </div>
                  {segType.description && (
                    <div
                      className="text-[11px] leading-relaxed text-muted-foreground max-w-none break-words [&_p]:my-1 [&_ul]:ml-4 [&_ul]:list-disc [&_ol]:ml-4 [&_ol]:list-decimal [&_a]:text-primary [&_a]:underline [&_strong]:font-bold [&_em]:italic [&_h1]:text-sm [&_h2]:text-sm [&_h3]:text-xs"
                      dangerouslySetInnerHTML={{ __html: segType.description }}
                    />
                  )}
                  {st && (
                    <p className="text-[11px] font-mono">
                      {st === "COMPLETED" ? (
                        <span className="text-green-500">
                          ✓ {t("viewer.segmentation.completedWord")}
                        </span>
                      ) : st === "FAILED" ? (
                        <span className="text-destructive">
                          ✕ {t("viewer.segmentation.failedWord")}
                        </span>
                      ) : (
                        <span className="text-yellow-500">⏳ {st}</span>
                      )}
                    </p>
                  )}
                  <button
                    className="btn-primary w-full mt-2"
                    disabled={disabled}
                    title={
                      !canAfford
                        ? t("viewer.segmentation.notEnoughCredits")
                        : done
                          ? t("viewer.segmentation.alreadySegmentedTitle")
                          : running
                            ? t("viewer.segmentation.inProgress")
                            : undefined
                    }
                    onClick={() => {
                      if (!segPicker) return;
                      const s = segPicker.summary ?? {
                        key: segPicker.key,
                        title: segPicker.title,
                        fileCount: 0,
                        bytes: 0,
                        created: new Date().toISOString(),
                        segmentationUsed: false,
                        segmentationStatus: null,
                        segmentations: {},
                      };
                      setSegPicker(null);
                      void handleSegmentScene(s, segType.id);
                    }}
                  >
                    {failed
                      ? t("viewer.segmentation.retry")
                      : done
                        ? t("viewer.segmentation.alreadySegmented")
                        : running
                          ? t("viewer.segmentation.inProgress")
                          : t("viewer.segmentation.segmentWithNameCost", {
                              name: segType.name,
                              cost: costLabel,
                            })}
                  </button>
                  {!canAfford && (
                    <p className="text-[10px] text-destructive">
                      {t("viewer.segmentation.noCredits")}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <button className="btn-ghost" onClick={() => setSegPicker(null)}>
              {t("viewer.common.close")}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {multiSeriesGroups && multiSeriesGroups.length > 1 && (
        <MultiSeriesModal
          open={multiSeriesOpen}
          onOpenChange={setMultiSeriesOpen}
          groups={multiSeriesGroups}
          openedName={multiSeriesOpenedName}
        />
      )}

      <Dialog open={creditConfirmOpen} onOpenChange={setCreditConfirmOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("viewer.credit.title")}</DialogTitle>
            <DialogDescription>
              {t("viewer.credit.descIntro")} <strong>{t("viewer.credit.oneCredit")}</strong>.
              <br />
              {t("viewer.credit.balanceLabel")}{" "}
              <strong>
                {t("viewer.credit.balance", { count: creditConfirmData.current?.credits ?? 0 })}
              </strong>
              .
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              className="btn-ghost"
              onClick={() => {
                creditConfirmResolve.current(false);
                setCreditConfirmOpen(false);
              }}
            >
              {t("viewer.common.cancel")}
            </button>
            <button
              className="btn-primary"
              onClick={() => {
                creditConfirmResolve.current(true);
                setCreditConfirmOpen(false);
              }}
            >
              {t("viewer.credit.confirm")}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Controles de correção da orientação do volume (espelhamento por eixo). */
function FlipControls({
  flags,
  onToggle,
  onReset,
}: {
  flags: FlipFlags;
  onToggle: (axis: VolumeAxis) => void;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  const items: Array<{ axis: VolumeAxis; icon: LucideIcon; labelKey: string; hintKey: string }> = [
    {
      axis: "x",
      icon: FlipHorizontal2,
      labelKey: "viewer.orientation.leftRight",
      hintKey: "viewer.orientation.leftRightHint",
    },
    {
      axis: "y",
      icon: FlipVertical2,
      labelKey: "viewer.orientation.antPost",
      hintKey: "viewer.orientation.antPostHint",
    },
    {
      axis: "z",
      icon: ArrowUpDown,
      labelKey: "viewer.orientation.supInf",
      hintKey: "viewer.orientation.supInfHint",
    },
  ];
  return (
    <>
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        {t("viewer.orientation.hint")}
      </p>
      <div className="grid grid-cols-3 gap-1">
        {items.map((item) => (
          <button
            key={item.axis}
            className={cn("btn-chip", flags[item.axis] && "border-primary text-foreground")}
            onClick={() => onToggle(item.axis)}
            aria-pressed={flags[item.axis]}
            title={t(item.hintKey)}
          >
            <item.icon className="h-3.5 w-3.5" />
            {t(item.labelKey)}
          </button>
        ))}
      </div>
      <button className="btn-chip w-full" onClick={onReset}>
        <RotateCcw className="h-3.5 w-3.5" />
        {t("viewer.orientation.reset")}
      </button>
    </>
  );
}

/** Grupo colapsável do painel de parâmetros. */
function Section({
  title,
  defaultOpen = true,
  right,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="min-w-0 shrink-0 overflow-visible rounded-lg border border-border bg-panel">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="group-title">{title}</span>
        <span className="flex items-center gap-1.5">
          {right}
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200",
              open && "rotate-180",
            )}
          />
        </span>
      </button>
      {open && (
        <div className="min-w-0 space-y-2.5 break-words border-t border-border px-3 py-2.5">
          {children}
        </div>
      )}
    </section>
  );
}

function Range({
  label,
  min,
  max,
  step = 1,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block space-y-1">
      <span className="data-mono text-[10px] text-muted-foreground">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
        style={{ accentColor: "var(--primary)" }}
      />
    </label>
  );
}

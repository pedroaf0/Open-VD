import { useTranslation } from "react-i18next";
import {
  Box,
  Boxes,
  FileDown,
  FileUp,
  FolderOpen,
  FolderUp,
  LayoutGrid,
  Link2,
  Maximize2,
  Minimize2,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RotateCcw,
  Share2,
  SlidersHorizontal,
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
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { UploadIcon } from "@/components/UploadIcon";
import { cn } from "@/lib/utils";
import type { Volume } from "@/lib/dicom";
import type { WpConfig, SceneSummary } from "@/lib/wp";

interface ViewerHeaderProps {
  // Branding
  brandLogo: string | undefined;
  brandName: string | undefined;
  cfg: WpConfig | null;
  // Route
  route: "viewer" | "profile";
  setRoute: (
    r: "viewer" | "profile" | ((prev: "viewer" | "profile") => "viewer" | "profile"),
  ) => void;
  // Volume / scene
  volume: Volume | null;
  sceneKey: string | null;
  sceneName: string;
  // Layout
  isMobile: boolean;
  isDesktop: boolean;
  hasData: boolean;
  canUpload: boolean;
  canLoadPublicly: boolean;
  allowDirectDicom: boolean;
  expanded: "axial" | "coronal" | "sagittal" | "3d" | null;
  setExpanded: (
    e:
      | "axial"
      | "coronal"
      | "sagittal"
      | "3d"
      | null
      | ((
          prev: "axial" | "coronal" | "sagittal" | "3d" | null,
        ) => "axial" | "coronal" | "sagittal" | "3d" | null),
  ) => void;
  panelOpen: boolean;
  setPanelOpen: (o: boolean | ((prev: boolean) => boolean)) => void;
  canFullscreen: boolean;
  isFull: boolean;
  toggleFullscreen: () => void;
  // Upload inputs
  stlInput: React.RefObject<HTMLInputElement | null>;
  dicomInput: React.RefObject<HTMLInputElement | null>;
  dicomFolderInput: React.RefObject<HTMLInputElement | null>;
  // Share / download
  setShare: (s: string | null) => void;
  shareUrl: (key: string) => string;
  openShare: () => void;
  storageBlocked: boolean;
  setDownloadOpen: (o: boolean) => void;
  // Upload state
  status: string | null;
  busy: boolean;
  // Segmentation
  segTypesEnabled: Array<{ id: string; name: string; cost: number; description: string }>;
  segCost: number;
  segBusy: string | null;
  canSegmentCurrentScene: boolean;
  handleSegmentAction: () => void;
  currentSceneSummary: SceneSummary | null;
  // Annotation mode
  annMode: boolean;
  setAnnMode: (v: boolean) => void;
  // URL open
  setUrlOpen: (o: boolean) => void;
  setUrlValue: (v: string) => void;
}

export function ViewerHeader({
  brandLogo,
  brandName,
  cfg,
  route,
  setRoute,
  volume,
  sceneKey,
  sceneName,
  isMobile,
  isDesktop,
  hasData,
  canUpload,
  canLoadPublicly,
  allowDirectDicom,
  expanded,
  setExpanded,
  panelOpen,
  setPanelOpen,
  canFullscreen,
  isFull,
  toggleFullscreen,
  stlInput,
  dicomInput,
  dicomFolderInput,
  setShare,
  shareUrl,
  openShare,
  storageBlocked,
  setDownloadOpen,
  status,
  busy,
  segTypesEnabled,
  segCost,
  segBusy,
  canSegmentCurrentScene,
  handleSegmentAction,
  currentSceneSummary,
  annMode,
  setAnnMode,
  setUrlOpen,
  setUrlValue,
}: ViewerHeaderProps) {
  const { t } = useTranslation();
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card px-2 sm:px-3">
      <div className="flex min-w-0 items-center gap-2">
        <a
          href={cfg?.homeUrl || "/"}
          className="flex min-w-0 items-center gap-2 hover:opacity-80 transition-opacity"
          title={t("viewer.header.homeTitle")}
        >
          {brandLogo && <img src={brandLogo} alt="" className="h-6 max-w-[140px] object-contain" />}
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
        {(cfg?.canUpload || canLoadPublicly) && hasData && (
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
        {(cfg?.canUpload || canLoadPublicly) &&
          hasData &&
          (canSegmentCurrentScene || !sceneKey) && (
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

        {/* Tela cheia (somente se suportado) */}
        {canFullscreen && (
          <button
            className="icon-btn"
            onClick={toggleFullscreen}
            aria-label={isFull ? t("viewer.header.exitFullscreen") : t("viewer.header.fullscreen")}
            title={isFull ? t("viewer.header.exitFullscreen") : t("viewer.header.fullscreen")}
          >
            {isFull ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        )}
      </div>
    </header>
  );
}

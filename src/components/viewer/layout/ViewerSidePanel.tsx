import { useTranslation } from "react-i18next";
import { Eye, EyeOff, MousePointer2, RotateCcw, Plus, Square, Video, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatRecordingDuration } from "@/lib/videoCapture";
import { PanelSection } from "@/components/viewer/panels/PanelSection";
import { RangeField } from "@/components/viewer/panels/RangeField";
import { OrientationPanel } from "@/components/viewer/panels/OrientationPanel";
import { MeshList } from "@/components/viewer/panels/MeshPanel";
import type { MeshFile } from "@/components/Volume3D";
import type { Annotation, Tool } from "@/lib/annotations";
import type { Volume } from "@/lib/dicom";

interface ViewerSidePanelProps {
  isMobile: boolean;
  isTablet: boolean;
  route: "viewer" | "profile";
  panelOpen: boolean;
  hasData: boolean;
  volume: Volume | null;
  sceneName: string;
  meshes: MeshFile[];
  meshVolumes: Map<string, string | null>;
  wc: number;
  ww: number;
  setWc: (v: number) => void;
  setWw: (v: number) => void;
  threshold: number;
  setThreshold: (v: number) => void;
  opacity: number;
  setOpacity: (v: number) => void;
  showVolume: boolean;
  setShowVolume: (v: boolean | ((prev: boolean) => boolean)) => void;
  showPlanes: Record<"axial" | "coronal" | "sagittal", boolean>;
  setShowPlanes: (
    v:
      | Record<"axial" | "coronal" | "sagittal", boolean>
      | ((
          prev: Record<"axial" | "coronal" | "sagittal", boolean>,
        ) => Record<"axial" | "coronal" | "sagittal", boolean>),
  ) => void;
  volumeFlip: { x: boolean; y: boolean; z: boolean };
  toggleFlip: (axis: "x" | "y" | "z") => void;
  resetFlip: () => void;
  annotations: Annotation[];
  sortedAnnotations: Annotation[];
  annMode: boolean;
  annActive: string | null;
  canUpload: boolean;
  selectAnnotation: (annotation: Annotation) => void;
  toggleAnnotationVisibility: (id: string) => void;
  deleteAnnotation: (id: string) => void;
  patchMesh: (
    id: string,
    patch: Partial<{ visible: boolean; opacity: number; coordSystem: "ras" | "lps" }>,
  ) => void;
  requestMeshDelete: (id: string, name: string) => void;
  centerMesh: (id: string) => void;
  setMeshes: React.Dispatch<React.SetStateAction<MeshFile[]>>;
  resetAllPlanes: () => void;
  handleResetAll: () => void;
  recording: boolean;
  recordedSeconds: number;
  onToggleRecording: () => void;
}

export function ViewerSidePanel({
  isMobile,
  isTablet,
  route,
  panelOpen,
  hasData,
  volume,
  sceneName,
  meshes,
  meshVolumes,
  wc,
  ww,
  setWc,
  setWw,
  threshold,
  setThreshold,
  opacity,
  setOpacity,
  showVolume,
  setShowVolume,
  showPlanes,
  setShowPlanes,
  volumeFlip,
  toggleFlip,
  resetFlip,
  annotations,
  sortedAnnotations,
  annMode,
  annActive,
  canUpload,
  selectAnnotation,
  toggleAnnotationVisibility,
  deleteAnnotation,
  patchMesh,
  requestMeshDelete,
  centerMesh,
  setMeshes,
  resetAllPlanes,
  handleResetAll,
  recording,
  recordedSeconds,
  onToggleRecording,
}: ViewerSidePanelProps) {
  const { t } = useTranslation();
  if (isMobile || route !== "viewer" || !panelOpen || !hasData) return null;

  return (
    <aside
      className="flex max-h-full min-h-0 w-[280px] shrink-0 flex-col gap-2.5 overflow-x-hidden overflow-y-auto border-l border-border bg-card p-3"
      aria-label={t("viewer.panel.aria")}
    >
      <PanelSection title={t("viewer.panel.studyTitle")}>
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
      </PanelSection>

      {volume && (
        <PanelSection
          title={t("viewer.panel.windowingTitle")}
          right={<MousePointer2 className="h-3 w-3 text-muted-foreground" />}
        >
          <RangeField
            label={`WL ${Math.round(wc)}`}
            min={-1000}
            max={3000}
            value={wc}
            onChange={setWc}
          />
          <RangeField
            label={`WW ${Math.round(ww)}`}
            min={1}
            max={4000}
            value={ww}
            onChange={setWw}
          />
        </PanelSection>
      )}

      {volume && (
        <PanelSection title="MPR">
          <button className="btn-chip w-full" onClick={resetAllPlanes}>
            <RotateCcw className="h-3.5 w-3.5" />
            {t("viewer.mpr.resetOblique")}
          </button>
        </PanelSection>
      )}

      {volume && (
        <PanelSection title={t("viewer.orientation.title")}>
          <OrientationPanel flags={volumeFlip} onToggle={toggleFlip} onReset={resetFlip} />
        </PanelSection>
      )}

      {volume && (
        <PanelSection title={t("viewer.panel.reconstructionTitle")}>
          <RangeField
            label={`${t("viewer.panel.density")} ${(threshold * 100).toFixed(0)}%`}
            min={0}
            max={0.95}
            step={0.01}
            value={threshold}
            onChange={setThreshold}
          />
          <RangeField
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
        </PanelSection>
      )}

      {isTablet && volume && (
        <PanelSection title={t("viewer.recording.title")}>
          <button
            className={cn(
              "btn-chip w-full",
              recording && "border-red-500/50 text-red-400 hover:text-red-300",
            )}
            onClick={onToggleRecording}
            aria-pressed={recording}
          >
            {recording ? (
              <Square className="h-3.5 w-3.5 fill-red-400 text-red-400" />
            ) : (
              <Video className="h-3.5 w-3.5" />
            )}
            {recording
              ? `${t("viewer.recording.stop")} · ${formatRecordingDuration(recordedSeconds)}`
              : t("viewer.recording.start")}
          </button>
        </PanelSection>
      )}

      {meshes.length > 0 && (
        <PanelSection
          title={t("viewer.panel.modelsTitle")}
          defaultOpen={false}
          right={
            <span className="data-mono text-[9px] text-muted-foreground">{meshes.length}</span>
          }
        >
          <MeshList
            meshes={meshes}
            meshVolumes={meshVolumes}
            onPatch={patchMesh}
            onRemove={requestMeshDelete}
            onCenter={centerMesh}
          />
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
        </PanelSection>
      )}

      {volume && canUpload && (
        <PanelSection
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
              {annMode ? t("viewer.annotations.emptyDraw") : t("viewer.annotations.empty")}
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
                <i className="h-2 w-2 shrink-0 rounded-full" style={{ background: a.color }} />
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
                    title={a.hidden ? t("viewer.annotations.show") : t("viewer.annotations.hide")}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleAnnotationVisibility(a.id);
                    }}
                  >
                    {a.hidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
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
        </PanelSection>
      )}

      {volume && (
        <PanelSection title={t("viewer.panel.shortcutsTitle")} defaultOpen={false}>
          <div className="space-y-1 text-[10px] leading-relaxed text-muted-foreground">
            <p>{t("viewer.shortcuts.wheel")}</p>
            <p>{t("viewer.shortcuts.dragIntersection")}</p>
            <p>{t("viewer.shortcuts.dragLine")}</p>
            <p>{t("viewer.shortcuts.dragCircles")}</p>
            <p>{t("viewer.shortcuts.rightButton")}</p>
            <p>{t("viewer.shortcuts.ctrlWheel")}</p>
            <p>{t("viewer.shortcuts.eye")}</p>
          </div>
        </PanelSection>
      )}

      {hasData && (
        <button className="btn-ghost w-full" onClick={handleResetAll}>
          <RotateCcw className="h-3.5 w-3.5" />
          {t("viewer.panel.resetAll")}
        </button>
      )}
    </aside>
  );
}

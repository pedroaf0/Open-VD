import { useTranslation } from "react-i18next";
import { Maximize2, Minimize2 } from "lucide-react";
import { SliceView } from "@/components/SliceView";
import { Volume3DAsync } from "@/components/Volume3DAsync";
import { cn } from "@/lib/utils";
import { PLANE_TABS } from "@/components/viewer/constants";
import { ACCENTS } from "@/components/viewer/constants";
import type { Volume, Plane } from "@/lib/dicom";
import type { MeshFile } from "@/components/Volume3D";
import type { PlaneState } from "@/lib/mpr";
import type { Tool, Annotation, AnnotationDraft } from "@/lib/annotations";

interface ViewportGridProps {
  volume: Volume | null;
  meshes: MeshFile[];
  threshold: number;
  opacity: number;
  showVolume: boolean;
  showPlanes: Record<Plane, boolean>;
  cross: { x: number; y: number; z: number };
  planeStates: Record<Plane, PlaneState>;
  wc: number;
  ww: number;
  invert: boolean;
  centerRequest: { id: string; seq: number } | null;
  recordingNamePattern: string | undefined;
  preciseRender: boolean;
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
  isMobile: boolean;
  annMode: boolean;
  annTool: Tool;
  annotations: Annotation[];
  annActive: string | null;
  onCreateAnnotation: (annotation: AnnotationDraft) => void;
  showLines: boolean;
  onToggleLines: () => void;
  resetPlane: (plane: Plane) => void;
  onWindow: (wc: number, ww: number) => void;
  onStates: (fn: (s: Record<Plane, PlaneState>) => Record<Plane, PlaneState>) => void;
}

export function ViewportGrid({
  volume,
  meshes,
  threshold,
  opacity,
  showVolume,
  showPlanes,
  cross,
  planeStates,
  wc,
  ww,
  invert,
  centerRequest,
  recordingNamePattern,
  preciseRender,
  expanded,
  setExpanded,
  isMobile,
  annMode,
  annTool,
  annotations,
  annActive,
  onCreateAnnotation,
  showLines,
  onToggleLines,
  resetPlane,
  onWindow,
  onStates,
}: ViewportGridProps) {
  const { t } = useTranslation();
  if (!volume) return null;

  const planes: Plane[] = ["axial", "coronal", "sagittal"];

  return (
    <div
      className={
        expanded
          ? "grid h-full grid-cols-1 grid-rows-1 gap-1.5 sm:gap-2"
          : "grid h-full grid-cols-1 grid-rows-4 gap-1.5 md:grid-cols-2 md:grid-rows-2 sm:gap-2"
      }
    >
      {planes.map((plane) =>
        !expanded || expanded === plane ? (
          <SliceView
            key={plane}
            volume={volume}
            plane={plane}
            label={t(`viewer.planes.${plane}`)}
            accent={ACCENTS[plane]}
            wc={wc}
            ww={ww}
            onWindow={onWindow}
            invert={invert}
            states={planeStates}
            onStates={onStates}
            accents={ACCENTS}
            onResetPlane={() => resetPlane(plane)}
            expanded={expanded === plane}
            onToggleExpand={
              isMobile ? undefined : () => setExpanded((e) => (e === plane ? null : plane))
            }
            annotating={annMode}
            tool={annTool}
            annotations={annotations}
            annActive={annActive}
            onCreateAnnotation={onCreateAnnotation}
            showLines={showLines}
            onToggleLines={onToggleLines}
          />
        ) : null,
      )}
      {(!expanded || expanded === "3d") && (
        <div className="viewport-frame">
          <div className="viewport-header">
            <span className="plane-label text-muted-foreground">3D / STL</span>
            <span className="flex items-center gap-1">
              <span className="data-mono text-[9px] text-muted-foreground">
                {preciseRender
                  ? t("viewer.renderMode.preciseHint")
                  : t("viewer.planes.dragToRotate")}
              </span>
              {!isMobile && (
                <button
                  className="icon-btn-sm"
                  title={expanded === "3d" ? t("viewer.grid.backToGrid") : t("viewer.grid.expand")}
                  aria-label={
                    expanded === "3d" ? t("viewer.grid.backToGrid") : t("viewer.grid.expand3d")
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
            <Volume3DAsync
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
              centerRequest={centerRequest}
              recordingNamePattern={recordingNamePattern}
            />
          </div>
        </div>
      )}
    </div>
  );
}

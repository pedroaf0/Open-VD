import { useTranslation } from "react-i18next";
import { Eye, EyeOff, Plus, RotateCcw, X, PenTool } from "lucide-react";
import { cn } from "@/lib/utils";
import { PanelSection } from "@/components/viewer/panels/PanelSection";
import { RangeField } from "@/components/viewer/panels/RangeField";
import { OrientationPanel } from "@/components/viewer/panels/OrientationPanel";
import { MeshList } from "@/components/viewer/panels/MeshPanel";
import { PLANE_TABS } from "@/components/viewer/constants";
import { ANN_TOOLS } from "@/components/viewer/constants";
import type { MeshFile } from "@/components/Volume3D";
import type { Annotation, Tool } from "@/lib/annotations";
import type { Volume } from "@/lib/dicom";
import type { WpConfig } from "@/lib/wp";

interface MobileSheetsProps {
  isMobile: boolean;
  route: "viewer" | "profile";
  activeSheet: "cortes" | "janela" | "3d" | "modelos" | "anotar" | null;
  volume: Volume | null;
  status: string | null;
  setActiveSheet: (
    s:
      | "cortes"
      | "janela"
      | "3d"
      | "modelos"
      | "anotar"
      | null
      | ((
          prev: "cortes" | "janela" | "3d" | "modelos" | "anotar" | null,
        ) => "cortes" | "janela" | "3d" | "modelos" | "anotar" | null),
  ) => void;
  expanded: "axial" | "coronal" | "sagittal" | "3d" | null;
  resetAllPlanes: () => void;
  wc: number;
  ww: number;
  setWc: (v: number) => void;
  setWw: (v: number) => void;
  handleResetAll: () => void;
  volumeFlip: { x: boolean; y: boolean; z: boolean };
  toggleFlip: (axis: "x" | "y" | "z") => void;
  resetFlip: () => void;
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
  meshes: MeshFile[];
  meshVolumes: Map<string, string | null>;
  cfg: WpConfig | null;
  annMode: boolean;
  setAnnMode: (v: boolean) => void;
  annTool: Tool;
  setAnnTool: (t: Tool) => void;
  annColor: string;
  setAnnColor: (c: string) => void;
  annotations: Annotation[];
  sortedAnnotations: Annotation[];
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
  stlInput: React.RefObject<HTMLInputElement | null>;
  showLines: boolean;
  setShowLines: (v: boolean | ((prev: boolean) => boolean)) => void;
}

export function MobileSheets({
  isMobile,
  route,
  activeSheet,
  volume,
  status,
  setActiveSheet,
  expanded,
  resetAllPlanes,
  wc,
  ww,
  setWc,
  setWw,
  handleResetAll,
  volumeFlip,
  toggleFlip,
  resetFlip,
  threshold,
  setThreshold,
  opacity,
  setOpacity,
  showVolume,
  setShowVolume,
  showPlanes,
  setShowPlanes,
  meshes,
  meshVolumes,
  cfg,
  annMode,
  setAnnMode,
  annTool,
  setAnnTool,
  annColor,
  setAnnColor,
  annotations,
  sortedAnnotations,
  annActive,
  canUpload,
  selectAnnotation,
  toggleAnnotationVisibility,
  deleteAnnotation,
  patchMesh,
  requestMeshDelete,
  centerMesh,
  setMeshes,
  stlInput,
  showLines,
  setShowLines,
}: MobileSheetsProps) {
  const { t } = useTranslation();
  if (!isMobile || route !== "viewer" || !activeSheet || !volume || status) return null;

  const getSheetTitle = () => {
    switch (activeSheet) {
      case "cortes":
        return t("viewer.mobile.navCortes");
      case "janela":
        return t("viewer.mobile.navJanela");
      case "3d":
        return t("viewer.panel.reconstructionTitle");
      case "modelos":
        return t("viewer.panel.modelsTitle");
      case "anotar":
        return t("viewer.panel.annotationsTitle");
    }
  };

  return (
    <div className="absolute inset-x-0 bottom-14 top-12 z-40 flex flex-col justify-end">
      <div className="absolute inset-0" onClick={() => setActiveSheet(null)} aria-hidden />
      <div
        className="relative max-h-[75%] w-full overflow-y-auto rounded-t-2xl border-t border-l border-r border-border bg-card p-3 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={t("viewer.mobile.panelAria", { sheet: activeSheet })}
      >
        <div className="mb-2.5 flex items-center justify-between">
          <span className="group-title">{getSheetTitle()}</span>
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
            <OrientationPanel flags={volumeFlip} onToggle={toggleFlip} onReset={resetFlip} />
            <div className="space-y-1 text-[10px] leading-relaxed text-muted-foreground">
              <p>{t("viewer.mobile.slicesHint1")}</p>
              <p>{t("viewer.mobile.slicesHint2")}</p>
            </div>
          </div>
        )}

        {activeSheet === "janela" && (
          <div className="space-y-3">
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
            <button className="btn-chip w-full" onClick={handleResetAll}>
              <RotateCcw className="h-3.5 w-3.5" />
              {t("viewer.panel.resetAll")}
            </button>
          </div>
        )}

        {activeSheet === "3d" && (
          <div className="space-y-3">
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
              <p className="text-[11px] text-muted-foreground">{t("viewer.panel.noModels")}</p>
            )}
            <MeshList
              meshes={meshes}
              meshVolumes={meshVolumes}
              containerClassName="rounded-md border border-border bg-panel p-2"
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
                    {ANN_TOOLS.filter((tool) => tool.key === "mark" || tool.key === "text").map(
                      (tool) => (
                        <button
                          key={tool.key}
                          className={cn(
                            "flex flex-col items-center gap-1 rounded-md border px-2 py-2 text-[10px] font-semibold transition",
                            annTool === tool.key
                              ? "border-primary bg-panel-2 text-foreground"
                              : "border-border bg-panel text-muted-foreground hover:text-foreground",
                          )}
                          onClick={() => setAnnTool(tool.key as Tool)}
                          aria-pressed={annTool === tool.key}
                        >
                          <tool.icon className="h-4 w-4" />
                          {t(tool.labelKey)}
                        </button>
                      ),
                    )}
                  </div>
                </div>
                <label className="flex items-center justify-between rounded-md border border-border bg-panel px-3 py-2">
                  <span className="text-[11px] font-medium">{t("viewer.annotations.color")}</span>
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
                <p className="text-[11px] text-muted-foreground">{t("viewer.annotations.empty")}</p>
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
                          a.hidden ? t("viewer.annotations.show") : t("viewer.annotations.hide")
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
  );
}

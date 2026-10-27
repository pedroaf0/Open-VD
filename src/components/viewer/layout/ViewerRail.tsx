import { useTranslation } from "react-i18next";
import { Eye, EyeOff, LayoutGrid, RotateCcw, Square, Video, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatRecordingDuration } from "@/lib/videoCapture";
import { ANN_TOOLS } from "@/components/viewer/constants";
import type { Tool } from "@/lib/annotations";
import type { Volume } from "@/lib/dicom";

interface ViewerRailProps {
  isDesktop: boolean;
  hasData: boolean;
  canUpload: boolean;
  annMode: boolean;
  annTool: Tool;
  setAnnTool: (tool: Tool) => void;
  showLines: boolean;
  setShowLines: (v: boolean | ((prev: boolean) => boolean)) => void;
  volume: Volume | null;
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
  resetAllPlanes: () => void;
  annColorPicker: React.ReactNode;
  recording: boolean;
  recordedSeconds: number;
  onToggleRecording: () => void;
}

export function ViewerRail({
  isDesktop,
  hasData,
  canUpload,
  annMode,
  annTool,
  setAnnTool,
  showLines,
  setShowLines,
  volume,
  expanded,
  setExpanded,
  resetAllPlanes,
  annColorPicker,
  recording,
  recordedSeconds,
  onToggleRecording,
}: ViewerRailProps) {
  const { t } = useTranslation();
  if (!isDesktop || !hasData) return null;

  return (
    <nav className="rail py-2" aria-label={t("viewer.rail.tools")}>
      <button
        className={cn("icon-btn", !showLines && "icon-btn-active")}
        onClick={() => setShowLines((v) => !v)}
        aria-pressed={showLines}
        aria-label={t("viewer.rail.referenceLines")}
        title={
          showLines ? t("viewer.rail.hideReferenceLines") : t("viewer.rail.showReferenceLines")
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
              onClick={() => setAnnTool(tool.key as Tool)}
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
          <div className="rail-sep" aria-hidden />
          <button
            className={cn(
              "icon-btn",
              recording && "bg-red-500/15 text-red-400 hover:bg-red-500/25 hover:text-red-300",
            )}
            onClick={onToggleRecording}
            aria-pressed={recording}
            aria-label={recording ? t("viewer.recording.stop") : t("viewer.recording.start")}
            title={
              recording
                ? `${t("viewer.recording.stop")} · ${formatRecordingDuration(recordedSeconds)}`
                : t("viewer.recording.start")
            }
          >
            {recording ? (
              <Square className="h-4 w-4 fill-red-400 text-red-400" />
            ) : (
              <Video className="h-4 w-4" />
            )}
          </button>
          {recording && (
            <span className="data-mono text-[9px] font-semibold tabular-nums text-red-400">
              {formatRecordingDuration(recordedSeconds)}
            </span>
          )}
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
  );
}

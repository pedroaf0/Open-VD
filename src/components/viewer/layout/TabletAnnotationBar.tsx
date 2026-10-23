import { useTranslation } from "react-i18next";
import { Palette } from "lucide-react";
import { cn } from "@/lib/utils";
import { ANN_TOOLS } from "@/components/viewer/constants";
import type { Tool } from "@/lib/annotations";

interface TabletAnnotationBarProps {
  isTablet: boolean;
  annMode: boolean;
  canUpload: boolean;
  annTool: Tool;
  setAnnTool: (tool: Tool) => void;
  annColor: string;
  setAnnColor: (color: string) => void;
}

export function TabletAnnotationBar({
  isTablet,
  annMode,
  canUpload,
  annTool,
  setAnnTool,
  annColor,
  setAnnColor,
}: TabletAnnotationBarProps) {
  const { t } = useTranslation();
  if (!isTablet || !annMode || !canUpload) return null;

  return (
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
          onClick={() => setAnnTool(tool.key as Tool)}
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
  );
}

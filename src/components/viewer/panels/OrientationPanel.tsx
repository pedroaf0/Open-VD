import { useTranslation } from "react-i18next";
import {
  ArrowUpDown,
  FlipHorizontal2,
  FlipVertical2,
  RotateCcw,
  type LucideIcon,
} from "lucide-react";
import type { VolumeAxis } from "@/lib/dicom";
import type { FlipFlags } from "@/components/viewer/types";
import { cn } from "@/lib/utils";

/** Controles de correção da orientação do volume (espelhamento por eixo). */
export function OrientationPanel({
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

import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { PLANE_TABS } from "@/components/viewer/constants";
import type { Volume } from "@/lib/dicom";

interface MobilePlaneTabsProps {
  isMobile: boolean;
  volume: Volume | null;
  status: string | null;
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
}

export function MobilePlaneTabs({
  isMobile,
  volume,
  status,
  expanded,
  setExpanded,
}: MobilePlaneTabsProps) {
  const { t } = useTranslation();
  if (!isMobile || !volume || status) return null;

  return (
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
              active ? "bg-panel-2 text-foreground" : "text-muted-foreground active:bg-panel-2",
            )}
          >
            <i className="h-1.5 w-1.5 rounded-full" style={{ background: tab.color }} />
            {t(tab.labelKey)}
          </button>
        );
      })}
    </div>
  );
}

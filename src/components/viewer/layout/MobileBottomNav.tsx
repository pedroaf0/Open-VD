import { useTranslation } from "react-i18next";
import { Box, Boxes, Layers, PenTool, SlidersHorizontal, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Volume } from "@/lib/dicom";
import type { MeshFile } from "@/components/Volume3D";

interface MobileBottomNavProps {
  isMobile: boolean;
  route: "viewer" | "profile";
  volume: Volume | null;
  status: string | null;
  activeSheet: "cortes" | "janela" | "3d" | "modelos" | "anotar" | null;
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
  canUpload: boolean;
  meshes: MeshFile[];
}

export function MobileBottomNav({
  isMobile,
  route,
  volume,
  status,
  activeSheet,
  setActiveSheet,
  canUpload,
  meshes,
}: MobileBottomNavProps) {
  const { t } = useTranslation();
  if (!isMobile || route !== "viewer" || !volume || status) return null;

  const navItems = [
    { key: "cortes" as const, label: t("viewer.mobile.navCortes"), icon: Layers, show: true },
    {
      key: "janela" as const,
      label: t("viewer.mobile.navJanela"),
      icon: SlidersHorizontal,
      show: true,
    },
    { key: "3d" as const, label: "3D", icon: Box, show: true },
    {
      key: "modelos" as const,
      label: t("viewer.mobile.navModelos"),
      icon: Boxes,
      show: canUpload || meshes.length > 0,
    },
    { key: "anotar" as const, label: t("viewer.mobile.navAnotar"), icon: PenTool, show: canUpload },
  ];

  const visibleItems = navItems.filter((i) => i.show);

  return (
    <nav
      className="flex h-14 shrink-0 items-stretch border-t border-border bg-card"
      aria-label={t("viewer.nav.label")}
    >
      {visibleItems.map((item) => {
        const open = activeSheet === item.key;
        return (
          <button
            key={item.key}
            className={cn(
              "flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition",
              open ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setActiveSheet((s) => (s === item.key ? null : item.key))}
            aria-pressed={open}
          >
            <item.icon className="h-5 w-5" />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, Eye, EyeOff, Target, X } from "lucide-react";
import type { MeshFile } from "@/components/Volume3D";
import { groupMeshesByName } from "@/lib/meshGroups";
import { cn } from "@/lib/utils";

/** Um modelo na lista: cor, nome (liga/desliga), volume, opacidade e coordenadas. */
function MeshRow({
  mesh,
  volumeLabel,
  containerClassName,
  onPatch,
  onRemove,
  onCenter,
}: {
  mesh: MeshFile;
  volumeLabel?: string | null | undefined;
  containerClassName?: string | undefined;
  onPatch: (id: string, patch: Partial<MeshFile>) => void;
  onRemove: (id: string, name: string) => void;
  onCenter: (id: string) => void;
}) {
  const { t } = useTranslation();
  const m = mesh;
  return (
    <div className={cn("space-y-1", containerClassName)}>
      <div className="flex items-center gap-1.5">
        <input
          type="color"
          value={m.color}
          onChange={(e) => onPatch(m.id, { color: e.target.value })}
          className="h-5 w-6 shrink-0 cursor-pointer rounded border border-border bg-transparent"
          aria-label={t("viewer.meshes.colorOf", { name: m.name })}
        />
        <button
          className="min-w-0 flex-1 truncate text-left text-[11px]"
          title={m.name}
          onClick={() => onPatch(m.id, { visible: !m.visible })}
          style={{ opacity: m.visible ? 1 : 0.4 }}
          aria-pressed={m.visible}
        >
          {m.name}
          {volumeLabel ? (
            <span className="ml-1.5 font-mono text-[10px] font-normal text-muted-foreground">
              · {volumeLabel}
            </span>
          ) : null}
        </button>
        <button
          className={cn("icon-btn-sm", !m.visible && "opacity-40")}
          onClick={() => onPatch(m.id, { visible: !m.visible })}
          aria-pressed={m.visible}
          aria-label={
            m.visible
              ? t("viewer.meshes.hide", { name: m.name })
              : t("viewer.meshes.show", { name: m.name })
          }
          title={
            m.visible
              ? t("viewer.meshes.hide", { name: m.name })
              : t("viewer.meshes.show", { name: m.name })
          }
        >
          {m.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
        </button>
        <button
          className="icon-btn-sm"
          onClick={() => onCenter(m.id)}
          aria-label={t("viewer.meshes.center", { name: m.name })}
          title={t("viewer.meshes.center", { name: m.name })}
        >
          <Target className="h-3 w-3" />
        </button>
        <button
          className="icon-btn-sm"
          onClick={() => onRemove(m.id, m.name)}
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
        onChange={(e) => onPatch(m.id, { opacity: Number(e.target.value) })}
        className="w-full accent-primary"
        style={{ accentColor: "var(--primary)" }}
        aria-label={t("viewer.meshes.opacityOf", { name: m.name })}
      />
      <button
        className="btn-chip w-full py-1 text-[10px]"
        onClick={() => onPatch(m.id, { coordSystem: m.coordSystem === "ras" ? "lps" : "ras" })}
        title={t("viewer.panel.coordSystem")}
      >
        {m.coordSystem === "lps" ? "LPS (DICOM)" : "RAS (Slicer)"}
      </button>
    </div>
  );
}

/**
 * Lista de modelos agrupada por termo comum no nome (ver `lib/meshGroups`).
 * Grupos podem ser recolhidos e ter a visibilidade alternada de uma vez.
 */
export function MeshList({
  meshes,
  meshVolumes,
  containerClassName,
  onPatch,
  onRemove,
  onCenter,
}: {
  meshes: MeshFile[];
  meshVolumes: Map<string, string | null>;
  containerClassName?: string | undefined;
  onPatch: (id: string, patch: Partial<MeshFile>) => void;
  onRemove: (id: string, name: string) => void;
  onCenter: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const groups = useMemo(() => groupMeshesByName(meshes), [meshes]);

  const rows = (items: MeshFile[]) =>
    items.map((m) => (
      <MeshRow
        key={m.id}
        mesh={m}
        volumeLabel={meshVolumes.get(m.id)}
        containerClassName={containerClassName}
        onPatch={onPatch}
        onRemove={onRemove}
        onCenter={onCenter}
      />
    ));

  return (
    <>
      {groups.map((group) => {
        if (!group.label) {
          return (
            <div key="__ungrouped" className="space-y-1">
              {rows(group.items)}
            </div>
          );
        }
        const isCollapsed = collapsed[group.key] ?? false;
        const allVisible = group.items.every((m) => m.visible);
        return (
          <div key={group.key} className="space-y-1">
            <div className="flex items-center gap-1">
              <button
                className="icon-btn-sm"
                onClick={() => setCollapsed((c) => ({ ...c, [group.key]: !isCollapsed }))}
                title={
                  isCollapsed ? t("viewer.meshes.expandGroup") : t("viewer.meshes.collapseGroup")
                }
                aria-expanded={!isCollapsed}
                aria-label={
                  isCollapsed ? t("viewer.meshes.expandGroup") : t("viewer.meshes.collapseGroup")
                }
              >
                {isCollapsed ? (
                  <ChevronRight className="h-3 w-3" />
                ) : (
                  <ChevronDown className="h-3 w-3" />
                )}
              </button>
              <span className="min-w-0 flex-1 truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {group.label}
              </span>
              <span className="data-mono text-[9px] text-muted-foreground">
                {group.items.length}
              </span>
              <button
                className="icon-btn-sm"
                onClick={() => {
                  const next = !allVisible;
                  for (const m of group.items) onPatch(m.id, { visible: next });
                }}
                aria-label={t("viewer.meshes.toggleGroup", { name: group.label })}
                aria-pressed={allVisible}
              >
                {allVisible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
              </button>
            </div>
            {!isCollapsed && <div className="space-y-1 pl-2">{rows(group.items)}</div>}
          </div>
        );
      })}
    </>
  );
}

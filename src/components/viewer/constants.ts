import {
  Crosshair,
  MousePointer2,
  MoveUpRight,
  PenLine,
  Ruler,
  Type,
  type LucideIcon,
} from "lucide-react";
import type { Plane } from "@/lib/dicom";
import type { PlaneState } from "@/lib/mpr";
import type { Tool } from "@/lib/annotations";
import type { FlipFlags, PlaneTabKey } from "@/components/viewer/types";

export const ACCENTS: Record<Plane, string> = {
  axial: "var(--axial)",
  coronal: "var(--coronal)",
  sagittal: "var(--sagittal)",
};

/** placeholder usado antes de qualquer volume ser carregado */
export const ZERO_STATES: Record<Plane, PlaneState> = {
  axial: { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] },
  coronal: { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 0, 1], n: [0, 1, 0] },
  sagittal: { origin: [0, 0, 0], u: [0, 1, 0], v: [0, 0, 1], n: [1, 0, 0] },
};

export const ZERO_FLIP: FlipFlags = { x: false, y: false, z: false };

/** Duração simulada da segmentação (10 min) usada pela barra de progresso. */
export const SEG_FAKE_TOTAL_S = 600;

export const MESH_COLORS: string[] = [
  "#9fd9ff",
  "#ffb3c1",
  "#c9f7a1",
  "#ffd580",
  "#d5b3ff",
  "#7fe3d4",
];

/** Ferramentas de anotação existentes, na ordem de apresentação. */
export const ANN_TOOLS: Array<{ key: Tool; labelKey: string; icon: LucideIcon }> = [
  { key: "select", labelKey: "viewer.annTools.select", icon: MousePointer2 },
  { key: "ruler", labelKey: "viewer.annTools.ruler", icon: Ruler },
  { key: "arrow", labelKey: "viewer.annTools.arrow", icon: MoveUpRight },
  { key: "mark", labelKey: "viewer.annTools.mark", icon: Crosshair },
  { key: "draw", labelKey: "viewer.annTools.draw", icon: PenLine },
  { key: "text", labelKey: "viewer.annTools.text", icon: Type },
];

/** Abas de plano exibidas no mobile (um viewport em foco por vez). */
export const PLANE_TABS: Array<{
  key: PlaneTabKey;
  labelKey: string;
  color: string;
  hintKey: string;
}> = [
  {
    key: "axial",
    labelKey: "viewer.planes.axial",
    color: "var(--axial)",
    hintKey: "viewer.planes.hintAxial",
  },
  {
    key: "coronal",
    labelKey: "viewer.planes.coronal",
    color: "var(--coronal)",
    hintKey: "viewer.planes.hintCoronal",
  },
  {
    key: "sagittal",
    labelKey: "viewer.planes.sagittal",
    color: "var(--sagittal)",
    hintKey: "viewer.planes.hintSagittal",
  },
  {
    key: "3d",
    labelKey: "viewer.planes.tab3d",
    color: "oklch(0.6 0 0)",
    hintKey: "viewer.planes.hint3d",
  },
];

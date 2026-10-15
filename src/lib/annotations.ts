import type { Plane, Volume } from "@/lib/dicom";
import i18n from "@/i18n";
import { dot, planeGeometry, sub, type PlaneGeom, type PlaneState } from "@/lib/mpr";

export type AnnotationKind = "text" | "mark" | "measure" | "arrow" | "draw";
/** Ferramenta de anotação; a régua grava com kind "measure". */
export type Tool = "ruler" | "arrow" | "mark" | "draw" | "text" | "select";
export type AnnPoint = { x: number; y: number };

/** Anotação vinculada a um corte específico (posição + orientação). */
export type Annotation = {
  id: string;
  kind: AnnotationKind;
  plane: Plane;
  label?: string;
  text?: string;
  color: string;
  points: AnnPoint[];
  measure?: { lengthMm: number } | null;
  /** URL do PNG da anotação, salvo nos metadados da cena. */
  png?: string;
  /** Oculta a anotação no corte (acões na lista). */
  hidden?: boolean;
  /** Posição e orientação do corte no momento da criação. */
  planeState: PlaneState;
  /** Estados de TODOS os planos para restaurar ao clicar na anotação. */
  allPlaneStates?: Record<Plane, PlaneState>;
  created: string;
};

export type AnnotationDraft = {
  kind: AnnotationKind;
  plane: Plane;
  points: AnnPoint[];
  measureMm?: number;
};

export const ANNOTATION_COLORS = ["#ff5d73", "#3ec9a7", "#ffd166", "#5b8dff", "#c58cff", "#ff9e57"];

export function snapshotState(s: PlaneState): PlaneState {
  return { origin: [...s.origin], u: [...s.u], v: [...s.v], n: [...s.n] };
}

/** Cópia profunda dos estados dos três planos (axial, coronal, sagittal). */
export function snapshotAllStates(s: Record<Plane, PlaneState>): Record<Plane, PlaneState> {
  return {
    axial: snapshotState(s.axial),
    coronal: snapshotState(s.coronal),
    sagittal: snapshotState(s.sagittal),
  };
}

/**
 * True quando dois estados representam o mesmo corte: mesma orientação e
 * posição na mesma faixa de espessura (mesmo índice de corte).
 */
export function sameSlice(a: PlaneState, b: PlaneState, stepTol: number): boolean {
  const sameOrient =
    Math.abs(dot(a.n, b.n)) > 0.9995 &&
    Math.abs(dot(a.u, b.u)) > 0.9995 &&
    Math.abs(dot(a.v, b.v)) > 0.9995;
  if (!sameOrient) return false;
  const d = sub(b.origin, a.origin);
  return Math.abs(dot(d, a.n)) <= stepTol;
}

/** Comprimento físico (mm) entre dois pontos normalizados da imagem. */
export function measureLengthMm(
  g: Pick<PlaneGeom, "w" | "h" | "pxU" | "pxV">,
  a: AnnPoint,
  b: AnnPoint,
): number {
  const da = (b.x - a.x) * g.w * g.pxU;
  const db = (b.y - a.y) * g.h * g.pxV;
  return Math.hypot(da, db);
}

/**
 * Desenha uma anotação num canvas (novo governo PNG) com largura/altura em
 * pixels da imagem do corte. Coordenadas normalizadas 0..1.
 */
export function drawAnnotationInto(
  ctx: CanvasRenderingContext2D,
  ann: Annotation,
  pxW: number,
  pxH: number,
): void {
  const X = (p: AnnPoint) => p.x * pxW;
  const Y = (p: AnnPoint) => p.y * pxH;
  const sw = Math.max(1.5, Math.min(7, pxW * 0.004));
  ctx.strokeStyle = ann.color;
  ctx.fillStyle = ann.color;
  ctx.lineWidth = sw;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  if (ann.kind === "draw") {
    if (ann.points.length < 2) return;
    ctx.beginPath();
    ann.points.forEach((p, i) => (i ? ctx.lineTo(X(p), Y(p)) : ctx.moveTo(X(p), Y(p))));
    ctx.stroke();
    return;
  }

  const drawCross = (p: AnnPoint, r: number) => {
    ctx.beginPath();
    ctx.arc(X(p), Y(p), r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(X(p) - r, Y(p));
    ctx.lineTo(X(p) + r, Y(p));
    ctx.moveTo(X(p), Y(p) - r);
    ctx.lineTo(X(p), Y(p) + r);
    ctx.stroke();
  };

  if (ann.kind === "mark") {
    const p = ann.points[0] ?? { x: 0.5, y: 0.5 };
    drawCross(p, Math.max(5, Math.min(14, pxW * 0.012)));
    return;
  }

  if (ann.kind === "text") {
    const p = ann.points[0] ?? { x: 0.5, y: 0.5 };
    drawCross(p, Math.max(4, Math.min(10, pxW * 0.01)));
    const content = (ann.text || ann.label || "").trim();
    if (content) {
      ctx.font = `600 ${Math.max(11, pxW * 0.03).toFixed(1)}px Manrope, Arial, sans-serif`;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      const tx = X(p) + Math.max(4, Math.min(12, pxW * 0.012));
      const ty = Y(p) - Math.max(4, Math.min(10, pxW * 0.01));
      ctx.strokeStyle = "rgba(0,0,0,0.75)";
      ctx.lineWidth = Math.max(2, sw * 2);
      ctx.strokeText(content, tx, ty);
      ctx.strokeStyle = ann.color;
      ctx.lineWidth = Math.max(1, sw * 0.6);
      ctx.fillText(content, tx, ty);
    }
    return;
  }

  if (ann.kind === "arrow") {
    const a = ann.points[0] ?? { x: 0.3, y: 0.5 };
    const b = ann.points[1] ?? a;
    ctx.beginPath();
    ctx.moveTo(X(a), Y(a));
    ctx.lineTo(X(b), Y(b));
    ctx.stroke();
    const ang = Math.atan2(Y(b) - Y(a), X(b) - X(a));
    const hs = Math.max(8, Math.min(20, pxW * 0.02));
    const bw = Math.max(4, hs * 0.36);
    ctx.beginPath();
    ctx.moveTo(X(b), Y(b));
    ctx.lineTo(X(b) - hs * Math.cos(ang - 0.45), Y(b) - hs * Math.sin(ang - 0.45));
    ctx.lineTo(X(b) - bw * Math.cos(ang + Math.PI / 2), Y(b) - bw * Math.sin(ang + Math.PI / 2));
    ctx.closePath();
    ctx.fill();
    return;
  }

  // measure
  const a = ann.points[0] ?? { x: 0.3, y: 0.5 };
  const b = ann.points[1] ?? a;
  ctx.beginPath();
  ctx.moveTo(X(a), Y(a));
  ctx.lineTo(X(b), Y(b));
  ctx.stroke();
  const r = Math.max(4, Math.min(9, pxW * 0.008));
  ctx.beginPath();
  ctx.arc(X(a), Y(a), r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(X(b), Y(b), r, 0, Math.PI * 2);
  ctx.stroke();
  const label =
    ann.measure?.lengthMm != null ? `${ann.measure.lengthMm.toFixed(1)} mm` : (ann.label ?? "");
  if (label) {
    ctx.font = `600 ${Math.max(11, pxW * 0.03).toFixed(1)}px Manrope, Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    const mx = (X(a) + X(b)) / 2;
    const my = (Y(a) + Y(b)) / 2 - Math.max(3, sw);
    ctx.strokeStyle = "rgba(0,0,0,0.75)";
    ctx.lineWidth = Math.max(2, sw * 2);
    ctx.strokeText(label, mx, my);
    ctx.strokeStyle = ann.color;
    ctx.lineWidth = Math.max(1, sw * 0.6);
    ctx.fillText(label, mx, my);
  }
}

/** Gera o PNG (transparente) de uma anotação na resolução do corte. */
export async function renderAnnotationPng(ann: Annotation, volume: Volume): Promise<Blob> {
  const g = planeGeometry(volume, ann.plane, ann.planeState);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(2, g.w);
  canvas.height = Math.max(2, g.h);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error(i18n.t("lib.annotations.canvasUnavailable"));
  drawAnnotationInto(ctx, ann, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error(i18n.t("lib.annotations.pngFailed")))),
      "image/png",
    ),
  );
  return blob;
}

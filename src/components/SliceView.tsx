import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Camera,
  Eye,
  EyeOff,
  Lock,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  RotateCcw,
  RotateCw,
  X,
} from "lucide-react";
import type { Plane, Volume } from "@/lib/dicom";
import { CapturePreviewDialog } from "@/components/CapturePreviewDialog";
import {
  clampPlane,
  cross3,
  crosshair,
  fromPlane2D,
  intersectionLine,
  isOblique,
  planeGeometry,
  renderPlane,
  rotateOtherPlanes,
  movePlaneThrough,
  setPlaneIndex,
  toPlane2D,
  type PlaneGeom,
  type PlaneState,
  type Vec3,
} from "@/lib/mpr";
import {
  measureLengthMm,
  sameSlice,
  type AnnPoint,
  type Annotation,
  type AnnotationDraft,
  type Tool,
} from "@/lib/annotations";

type States = Record<Plane, PlaneState>;

type Props = {
  volume: Volume;
  plane: Plane;
  label: string;
  accent: string;
  wc: number;
  ww: number;
  onWindow: (wc: number, ww: number) => void;
  invert: boolean;
  /** estado (origem + eixos) dos tres planos de reslice */
  states: States;
  onStates: (update: (s: States) => States) => void;
  accents: Record<Plane, string>;
  /** volta este plano para a orientacao ortogonal original */
  onResetPlane: (plane: Plane) => void;
  expanded?: boolean;
  onToggleExpand?: (() => void) | undefined;
  /** anotações vinculadas a este plano */
  annotations?: Annotation[];
  /** modo anotação: cortes ficam travados e controles de navegação ocultos */
  annotating?: boolean;
  tool?: Tool;
  /** id da anotação destacada (selecionada na lista) */
  annActive?: string | null;
  onCreateAnnotation?: (draft: AnnotationDraft) => void;
  /** exibe as linhas de interseção dos outros planos */
  showLines: boolean;
  /** alterna a visibilidade das linhas de referência (global) */
  onToggleLines: () => void;
};

const OTHERS: Record<Plane, [Plane, Plane]> = {
  axial: ["coronal", "sagittal"],
  coronal: ["axial", "sagittal"],
  sagittal: ["axial", "coronal"],
};

const ZOOM_MIN = 0.4;
const ZOOM_MAX = 8;

/** Segmento da linha A*a + B*b = c recortado ao retangulo da imagem (mm). */
function clipLine(A: number, B: number, c: number, halfW: number, halfH: number) {
  const pts: Array<[number, number]> = [];
  const push = (a: number, b: number) => {
    if (a < -halfW - 1e-6 || a > halfW + 1e-6 || b < -halfH - 1e-6 || b > halfH + 1e-6) return;
    if (pts.some((p) => Math.abs(p[0] - a) < 1e-6 && Math.abs(p[1] - b) < 1e-6)) return;
    pts.push([a, b]);
  };
  if (Math.abs(B) > 1e-9) {
    push(-halfW, (c - A * -halfW) / B);
    push(halfW, (c - A * halfW) / B);
  }
  if (Math.abs(A) > 1e-9) {
    push((c - B * -halfH) / A, -halfH);
    push((c - B * halfH) / A, halfH);
  }
  if (pts.length < 2) return null;
  return [pts[0]!, pts[1]!] as [[number, number], [number, number]];
}

/** Serializa o overlay SVG (anotações/linhas) em um Blob URL rasterizável. */
function svgToObjectUrl(
  svg: SVGSVGElement,
  options: { width: number; height: number; viewBox?: string },
): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(options.width));
  clone.setAttribute("height", String(options.height));
  if (options.viewBox) clone.setAttribute("viewBox", options.viewBox);

  let xml = new XMLSerializer().serializeToString(clone);
  // O SVG vira uma imagem isolada, sem acesso ao documento: resolve as
  // variáveis CSS usadas nas cores (ex.: var(--axial)) para valores reais.
  const computed = getComputedStyle(svg);
  xml = xml.replace(/var\((--[A-Za-z0-9_-]+)\)/g, (match, name: string) => {
    const value = computed.getPropertyValue(name).trim();
    return value || match;
  });

  return URL.createObjectURL(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }));
}

function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("overlay-svg"));
    image.src = url;
  });
}

type Drag =
  | { mode: "all" }
  | { mode: "translate"; target: Plane }
  | { mode: "rotate"; target: Plane; last: number; pivot: Vec3; axis: Vec3 }
  | { mode: "window"; x: number; y: number; wc: number; ww: number }
  | { mode: "pan" };

export function SliceView(props: Props) {
  const { t } = useTranslation();
  const { volume, plane, states, wc, ww, invert } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<string | null>(null);
  const [rotateOpen, setRotateOpen] = useState(false);
  const [rotateDeg, setRotateDeg] = useState(0);
  const drag = useRef<Drag | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [captureUrl, setCaptureUrl] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);

  const annotating = !!props.annotating;
  const tool = props.tool ?? "select";
  const drawing = useRef<{ tool: Tool; points: AnnPoint[] } | null>(null);
  const [preview, setPreview] = useState<AnnPoint[] | null>(null);

  const st = states[plane];
  const geom = useMemo(() => planeGeometry(volume, plane, st), [volume, plane, st]);
  const pivot = useMemo(() => crosshair(volume, states), [volume, states]);
  const total = geom.total;
  const index = geom.index;
  const physW = geom.w * geom.pxU;
  const physH = geom.h * geom.pxV;
  const halfW = physW / 2;
  const halfH = physH / 2;

  /** anotações deste plano cujo corte (posição + orientação) é o atual */
  const visibleAnns = useMemo(
    () =>
      (props.annotations ?? []).filter(
        (a) => !a.hidden && a.plane === plane && sameSlice(st, a.planeState, geom.stepN / 2 + 1e-6),
      ),
    [props.annotations, plane, st, geom],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const id = requestAnimationFrame(() => {
      const { img, g } = renderPlane(volume, plane, st, wc, ww, invert);
      canvas.width = g.w;
      canvas.height = g.h;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.putImageData(img, 0, 0);
    });
    return () => cancelAnimationFrame(id);
  }, [volume, plane, st, wc, ww, invert]);

  // ajusta a razao de aspecto fisica dentro do viewport sem distorcer
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const fit = () => {
      const cw = el.clientWidth - 8;
      const ch = el.clientHeight - 8;
      if (cw <= 0 || ch <= 0) return;
      const s = Math.min(cw / physW, ch / physH);
      setBox({ w: physW * s, h: physH * s });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [physW, physH]);

  /** linhas de interseccao dos outros dois planos, em mm do plano atual */
  const overlays = useMemo(() => {
    const p2 = toPlane2D(geom, pivot);
    const handleLen = Math.min(halfW, halfH) * 0.62;
    return OTHERS[plane]
      .map((other) => {
        const line = intersectionLine(geom, states[other]);
        if (!line) return null;
        const seg = clipLine(line.A, line.B, line.c, halfW, halfH);
        if (!seg) return null;
        const dir: [number, number] = [line.B / line.norm, -line.A / line.norm];
        // ancora dos handles: projecao do cursor 3D sobre a linha
        const t = (line.c - (line.A * p2.a + line.B * p2.b)) / (line.norm * line.norm);
        const base: [number, number] = [p2.a + line.A * t, p2.b + line.B * t];
        const handles: Array<[number, number]> = [
          [base[0] + dir[0] * handleLen, base[1] + dir[1] * handleLen],
          [base[0] - dir[0] * handleLen, base[1] - dir[1] * handleLen],
        ];
        return { other, line, seg, handles };
      })
      .filter(Boolean) as Array<{
      other: Plane;
      line: { A: number; B: number; c: number; norm: number };
      seg: [[number, number], [number, number]];
      handles: Array<[number, number]>;
    }>;
  }, [geom, states, plane, pivot, halfW, halfH]);

  const pivot2D = useMemo(() => toPlane2D(geom, pivot), [geom, pivot]);

  /**
   * Deslocamento que mantém o ponto de interseção dos cortes (crosshair)
   * fixo na tela ao aplicar o zoom: o zoom sempre centraliza nele.
   */
  const zx = ((1 - zoom) * (box.w || 1) * pivot2D.a) / (physW || 1);
  const zy = ((1 - zoom) * (box.h || 1) * pivot2D.b) / (physH || 1);

  /** mm -> px na imagem renderizada (para o SVG com viewBox do canvas) */
  const toPxX = (a: number) => geom.w / 2 + a / geom.pxU;
  const toPxY = (b: number) => geom.h / 2 + b / geom.pxV;
  /** mm -> px de tela (para hit-test) */
  const screenScale = box.w && physW ? (box.w * zoom) / physW : 1;

  function eventMM(e: React.PointerEvent | React.MouseEvent) {
    const el = wrapRef.current;
    if (!el || !box.w || !box.h) return { a: 0, b: 0 };
    const r = el.getBoundingClientRect();
    const sx = (e.clientX - (r.left + r.width / 2) - pan.x - zx) / zoom;
    const sy = (e.clientY - (r.top + r.height / 2) - pan.y - zy) / zoom;
    return {
      a: sx * (physW / box.w),
      b: sy * (physH / box.h),
    };
  }

  /** ponto da imagem normalizado 0..1 a partir do evento do ponteiro */
  function norm(e: React.PointerEvent): AnnPoint {
    const { a, b } = eventMM(e);
    return {
      x: Math.min(1, Math.max(0, 0.5 + a / (physW || 1))),
      y: Math.min(1, Math.max(0, 0.5 + b / (physH || 1))),
    };
  }

  function hitTest(a: number, b: number) {
    if (!props.showLines) return null;
    for (const o of overlays) {
      for (const h of o.handles) {
        if (Math.hypot(a - h[0], b - h[1]) * screenScale < 11)
          return { kind: "rotate" as const, target: o.other };
      }
    }
    if (Math.hypot(a - pivot2D.a, b - pivot2D.b) * screenScale < 10)
      return { kind: "all" as const, target: plane };
    for (const o of overlays) {
      const d = Math.abs(o.line.A * a + o.line.B * b - o.line.c) / o.line.norm;
      if (d * screenScale < 6) return { kind: "translate" as const, target: o.other };
    }
    return null;
  }

  function updateStates(fn: (s: States) => States) {
    props.onStates((s) => {
      const next = fn(s);
      return {
        axial: clampPlane(volume, next.axial),
        coronal: clampPlane(volume, next.coronal),
        sagittal: clampPlane(volume, next.sagittal),
      };
    });
  }

  /** move os tres planos para conter o ponto clicado */
  function moveAll(a: number, b: number) {
    const p = fromPlane2D(geom, a, b);
    updateStates((s) => ({
      axial: movePlaneThrough(s.axial, p),
      coronal: movePlaneThrough(s.coronal, p),
      sagittal: movePlaneThrough(s.sagittal, p),
    }));
  }

  function onPointerDown(e: React.PointerEvent) {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    if (e.button === 2) {
      drag.current = { mode: "window", x: e.clientX, y: e.clientY, wc, ww };
      return;
    }
    if (e.button === 1) {
      drag.current = { mode: "pan" };
      return;
    }
    if (annotating) {
      if (tool === "select") return;
      drawing.current = { tool, points: [norm(e)] };
      setPreview([...drawing.current.points]);
      return;
    }
    const { a, b } = eventMM(e);
    const hit = hitTest(a, b);
    if (hit?.kind === "rotate") {
      drag.current = {
        mode: "rotate",
        target: hit.target,
        last: Math.atan2(b - pivot2D.b, a - pivot2D.a),
        pivot,
        axis: cross3(geom.u, geom.v),
      };
      return;
    }
    if (hit?.kind === "translate") {
      drag.current = { mode: "translate", target: hit.target };
      const o = overlays.find((x) => x.other === hit.target)!;
      const target = hit.target;
      const delta = o.line.A * a + o.line.B * b - o.line.c;
      updateStates((s) => ({
        ...s,
        [target]: {
          ...s[target],
          origin: [
            s[target].origin[0] + s[target].n[0] * delta,
            s[target].origin[1] + s[target].n[1] * delta,
            s[target].origin[2] + s[target].n[2] * delta,
          ] as Vec3,
        },
      }));
      return;
    }
    drag.current = { mode: "all" };
    moveAll(a, b);
  }

  function onPointerMove(e: React.PointerEvent) {
    const dr = drawing.current;
    if (dr) {
      const p = norm(e);
      if (dr.tool === "ruler" || dr.tool === "arrow") {
        dr.points = [dr.points[0]!, p];
      } else if (dr.tool === "draw") {
        const last = dr.points[dr.points.length - 1]!;
        if (Math.hypot(p.x - last.x, p.y - last.y) > 0.004) {
          dr.points.push(p);
          if (dr.points.length > 2000) dr.points.shift();
        }
      } else {
        dr.points = [p];
      }
      setPreview([...dr.points]);
      return;
    }
    const d = drag.current;
    if (!d) {
      if (annotating) {
        setHover(null);
        return;
      }
      const { a, b } = eventMM(e);
      const hit = hitTest(a, b);
      setHover(hit ? `${hit.kind}:${hit.target}` : null);
      return;
    }
    if (d.mode === "window") {
      props.onWindow(d.wc + (e.clientX - d.x) * 2, Math.max(1, d.ww + (d.y - e.clientY) * 2));
      return;
    }
    if (d.mode === "pan") {
      setPan((p) => ({ x: p.x + e.movementX, y: p.y + e.movementY }));
      return;
    }
    const { a, b } = eventMM(e);
    if (d.mode === "all") {
      moveAll(a, b);
      return;
    }
    if (d.mode === "translate") {
      const o = overlays.find((x) => x.other === d.target);
      if (!o) return;
      const delta = o.line.A * a + o.line.B * b - o.line.c;
      const target = d.target;
      updateStates((s) => ({
        ...s,
        [target]: {
          ...s[target],
          origin: [
            s[target].origin[0] + s[target].n[0] * delta,
            s[target].origin[1] + s[target].n[1] * delta,
            s[target].origin[2] + s[target].n[2] * delta,
          ] as Vec3,
        },
      }));
      return;
    }
    // rotate
    const ang = Math.atan2(b - pivot2D.b, a - pivot2D.a);
    let deg = ((ang - d.last) * 180) / Math.PI;
    if (deg > 180) deg -= 360;
    if (deg < -180) deg += 360;
    if (Math.abs(deg) < 0.05) return;
    d.last = ang;
    updateStates((s) => rotateOtherPlanes(s, plane, d.axis, deg, d.pivot));
  }

  const cancelDrawing = () => {
    drawing.current = null;
    setPreview(null);
    drag.current = null;
    setHover(null);
  };

  const stop = () => {
    const dr = drawing.current;
    drawing.current = null;
    setPreview(null);
    if (dr && dr.points.length) {
      let pts = dr.points;
      if (dr.tool === "ruler" || dr.tool === "arrow") {
        if (pts.length < 2) {
          drag.current = null;
          return;
        }
        pts = [pts[0]!, pts[pts.length - 1]!];
      } else if (dr.tool === "mark" || dr.tool === "text") {
        pts = [pts[0]!];
      }
      const kind = (dr.tool === "ruler" ? "measure" : dr.tool) as AnnotationDraft["kind"];
      const mm = dr.tool === "ruler" ? measureLengthMm(geom, pts[0]!, pts[1]!) : undefined;
      const draft: AnnotationDraft =
        kind === "measure"
          ? { kind, plane, points: pts, ...(mm != null ? { measureMm: mm } : {}) }
          : { kind, plane, points: pts };
      props.onCreateAnnotation?.(draft);
    }
    drag.current = null;
  };

  function onWheel(e: React.WheelEvent) {
    if (e.ctrlKey || e.shiftKey) {
      setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z * (e.deltaY > 0 ? 0.9 : 1.1))));
      return;
    }
    if (annotating) return; // corte travado no modo de anotação
    setIndex(index + (e.deltaY > 0 ? 1 : -1));
  }

  function setIndex(i: number) {
    updateStates((s) => ({ ...s, [plane]: setPlaneIndex(geom, s[plane], i) }));
  }

  function setRotation(deg: number) {
    const delta = deg - rotateDeg;
    if (!delta) return;
    setRotateDeg(deg);
    updateStates((s) => rotateOtherPlanes(s, plane, geom.n, delta, pivot));
  }

  /**
   * Compõe a captura do corte no estado exibido: imagem nativa do slice,
   * pan/zoom atuais e o overlay SVG (anotações, linhas de referência e
   * cursor). Nada do estado do visualizador é alterado.
   */
  async function composeCapture(): Promise<string | null> {
    const wrap = wrapRef.current;
    const sliceCanvas = canvasRef.current;
    const svg = svgRef.current;
    if (!wrap || !sliceCanvas || !svg || !box.w || !box.h) return null;
    const width = wrap.clientWidth;
    const height = wrap.clientHeight;
    if (!width || !height) return null;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(width * dpr));
    out.height = Math.max(1, Math.round(height * dpr));
    const ctx = out.getContext("2d");
    if (!ctx) return null;

    // Mesma composição do viewport: fundo preto, centro e pan/zoom do SliceView.
    ctx.scale(dpr, dpr);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);
    ctx.translate(width / 2 + pan.x + zx, height / 2 + pan.y + zy);
    ctx.scale(zoom, zoom);

    const left = -box.w / 2;
    const top = -box.h / 2;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(sliceCanvas, left, top, box.w, box.h);

    // Recorte visível da caixa (coordenadas locais), para rasterizar o
    // overlay apenas na área que aparece — memória limitada pelo viewport.
    const px = pan.x + zx;
    const py = pan.y + zy;
    const viewLeft = Math.max(0, Math.min(box.w, box.w / 2 + (-width / 2 - px) / zoom));
    const viewTop = Math.max(0, Math.min(box.h, box.h / 2 + (-height / 2 - py) / zoom));
    const viewRight = Math.max(viewLeft, Math.min(box.w, box.w / 2 + (width / 2 - px) / zoom));
    const viewBottom = Math.max(viewTop, Math.min(box.h, box.h / 2 + (height / 2 - py) / zoom));
    const viewW = viewRight - viewLeft;
    const viewH = viewBottom - viewTop;

    if (viewW > 0.5 && viewH > 0.5) {
      // viewBox correspondente em pixels nativos do corte.
      const sx = (viewLeft / box.w) * geom.w;
      const sy = (viewTop / box.h) * geom.h;
      const sw = (viewW / box.w) * geom.w;
      const sh = (viewH / box.h) * geom.h;
      // O overlay é vetorial; rasteriza na resolução final para manter
      // alinhamento, escala e nitidez sobre a imagem do corte.
      const overlayUrl = svgToObjectUrl(svg, {
        viewBox: `${sx} ${sy} ${sw} ${sh}`,
        width: Math.max(1, Math.round(viewW * zoom * dpr)),
        height: Math.max(1, Math.round(viewH * zoom * dpr)),
      });
      try {
        const overlay = await loadImageElement(overlayUrl);
        ctx.drawImage(overlay, left + viewLeft, top + viewTop, viewW, viewH);
      } finally {
        URL.revokeObjectURL(overlayUrl);
      }
    }

    return out.toDataURL("image/png");
  }

  async function handleCapture() {
    if (capturing) return;
    setCapturing(true);
    setCaptureError(null);
    try {
      const dataUrl = await composeCapture();
      if (!dataUrl) {
        setCaptureError(t("ui.sliceView.captureFailed"));
        return;
      }
      setCaptureUrl(dataUrl);
      setCaptureOpen(true);
    } catch (error) {
      console.warn("Falha ao capturar o corte:", error);
      setCaptureError(t("ui.sliceView.captureFailed"));
    } finally {
      setCapturing(false);
    }
  }

  const oblique = isOblique(volume, plane, st);
  const cursor = annotating
    ? "crosshair"
    : hover?.startsWith("rotate")
      ? "grab"
      : hover?.startsWith("translate")
        ? "move"
        : hover?.startsWith("all")
          ? "move"
          : "crosshair";

  return (
    <div className="viewport-frame group">
      <div className="viewport-header">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="plane-label truncate" style={{ color: props.accent }}>
            {props.label}
          </span>
          {oblique && (
            <span
              className="data-mono text-[8px] font-semibold text-muted-foreground"
              title={t("ui.sliceView.obliqueSlice")}
            >
              OBL
            </span>
          )}
          {annotating && (
            <span
              className="data-mono text-[8px] font-semibold uppercase text-muted-foreground"
              title={t("ui.sliceView.lockedTitle")}
            >
              <Lock className="mr-0.5 inline h-2.5 w-2.5" />
              {t("ui.sliceView.locked")}
            </span>
          )}
        </span>
        <span className="flex items-center gap-0.5">
          <button
            className="icon-btn-sm"
            title={
              props.showLines
                ? t("ui.sliceView.hideReferenceLines")
                : t("ui.sliceView.showReferenceLines")
            }
            aria-label={props.showLines ? t("ui.sliceView.hideLines") : t("ui.sliceView.showLines")}
            onClick={props.onToggleLines}
          >
            {props.showLines ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          </button>
          <span className="data-mono text-muted-foreground tabular-nums">
            {index + 1}/{total}
          </span>
          {props.onToggleExpand && (
            <button
              className="icon-btn-sm"
              title={props.expanded ? t("ui.sliceView.backToGrid") : t("ui.sliceView.expand")}
              aria-label={
                props.expanded
                  ? t("ui.sliceView.backToGrid")
                  : t("ui.sliceView.expandAria", { label: props.label })
              }
              onClick={props.onToggleExpand}
            >
              {props.expanded ? (
                <Minimize2 className="h-3.5 w-3.5" />
              ) : (
                <Maximize2 className="h-3.5 w-3.5" />
              )}
            </button>
          )}
        </span>
      </div>
      {rotateOpen && !annotating && (
        <input
          type="range"
          min={-180}
          max={180}
          step={1}
          value={rotateDeg}
          onChange={(e) => setRotation(Number(e.target.value))}
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={() => {
            setRotateDeg(0);
            props.onResetPlane(plane);
          }}
          className="slice-slider"
          style={{ accentColor: props.accent }}
          aria-label={t("ui.sliceView.rotateAria", { label: props.label })}
          title={t("ui.sliceView.rotateSliderHint")}
        />
      )}
      <div
        ref={wrapRef}
        className="relative flex-1 overflow-hidden bg-black"
        style={{ cursor }}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={stop}
        onPointerCancel={cancelDrawing}
        onPointerLeave={cancelDrawing}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ transform: `translate(${pan.x + zx}px, ${pan.y + zy}px) scale(${zoom})` }}
        >
          <div ref={imgRef} className="relative" style={{ width: box.w || 1, height: box.h || 1 }}>
            <canvas ref={canvasRef} className="block h-full w-full" />
            <svg
              ref={svgRef}
              className="pointer-events-none absolute inset-0 h-full w-full"
              viewBox={`0 0 ${geom.w} ${geom.h}`}
              preserveAspectRatio="none"
            >
              <g>
                {visibleAnns.map((a) => (
                  <AnnGlyph
                    key={a.id}
                    ann={a}
                    pxW={geom.w}
                    pxH={geom.h}
                    active={props.annActive === a.id}
                  />
                ))}
                {preview && preview.length > 0 && (
                  <AnnGlyph
                    ann={{
                      id: "__preview",
                      kind: tool === "ruler" ? "measure" : tool === "select" ? "mark" : tool,
                      plane,
                      color: "#ffffff",
                      points: preview.length === 1 ? [preview[0]!, preview[0]!] : preview,
                      planeState: st,
                      created: "",
                    }}
                    pxW={geom.w}
                    pxH={geom.h}
                  />
                )}
              </g>
              {!annotating &&
                props.showLines &&
                overlays.map((o) => {
                  const color = props.accents[o.other];
                  const active = hover?.endsWith(`:${o.other}`);
                  return (
                    <g key={o.other} stroke={color} fill={color}>
                      <line
                        x1={toPxX(o.seg[0][0])}
                        y1={toPxY(o.seg[0][1])}
                        x2={toPxX(o.seg[1][0])}
                        y2={toPxY(o.seg[1][1])}
                        strokeWidth={active ? 2.2 : 1.2}
                        opacity={0.9}
                        vectorEffect="non-scaling-stroke"
                      />
                      {o.handles.map((h, i) => (
                        <circle
                          key={i}
                          cx={toPxX(h[0])}
                          cy={toPxY(h[1])}
                          r={active ? 5 : 4}
                          fillOpacity={0.35}
                          strokeWidth={1.4}
                          vectorEffect="non-scaling-stroke"
                        />
                      ))}
                    </g>
                  );
                })}
              {!annotating && props.showLines && (
                <g stroke={props.accent} fill="none">
                  <circle
                    cx={toPxX(pivot2D.a)}
                    cy={toPxY(pivot2D.b)}
                    r={5}
                    strokeWidth={1.4}
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              )}
            </svg>
          </div>
        </div>

        <div
          className="absolute right-1 top-1 z-10 flex select-none flex-col items-center gap-1"
          onPointerDown={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button
            className="flex h-8 w-8 items-center justify-center rounded-md border border-white/15 bg-black/60 text-white/85 shadow-lg backdrop-blur-md transition hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 disabled:cursor-wait disabled:opacity-60"
            onClick={() => void handleCapture()}
            disabled={capturing}
            aria-label={t("ui.sliceView.capture")}
            title={t("ui.sliceView.capture")}
          >
            <Camera className="h-4 w-4 text-sky-300" />
          </button>
          {!annotating && (
            <button
              className="flex h-8 w-8 items-center justify-center rounded-md border backdrop-blur-sm transition"
              style={
                rotateOpen
                  ? {
                      background: "var(--color-panel-2)",
                      borderColor: props.accent,
                      color: props.accent,
                    }
                  : {
                      background: "rgba(0,0,0,0.5)",
                      borderColor: "rgba(255,255,255,0.1)",
                      color: "var(--color-muted-foreground)",
                    }
              }
              onClick={() => setRotateOpen((o) => !o)}
              aria-pressed={rotateOpen}
              aria-label={rotateOpen ? t("ui.sliceView.closeRotation") : t("ui.sliceView.rotate")}
              title={rotateOpen ? t("ui.sliceView.closeRotation") : t("ui.sliceView.rotate")}
            >
              <RotateCw className="h-4 w-4" />
            </button>
          )}
          <div
            className="flex flex-col items-center gap-0.5 rounded-md border border-white/10 bg-black/50 p-1 backdrop-blur-sm"
            title={t("ui.sliceView.zoomCenteredHint")}
            onPointerDown={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
          >
            <button
              className="icon-btn-sm"
              onClick={() => setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z * 1.25)))}
              aria-label={t("ui.sliceView.zoomIn")}
              title={t("ui.sliceView.zoomIn")}
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            <span className="data-mono w-8 py-0.5 text-center text-[9px] leading-none text-muted-foreground">
              {Math.round(zoom * 100)}%
            </span>
            <button
              className="icon-btn-sm"
              onClick={() => setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z * 0.8)))}
              aria-label={t("ui.sliceView.zoomOut")}
              title={t("ui.sliceView.zoomOut")}
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <button
              className="icon-btn-sm"
              onClick={() => {
                setZoom(1);
                setPan({ x: 0, y: 0 });
              }}
              title={t("ui.sliceView.resetZoom")}
            >
              <RotateCcw className="h-3 w-3" />
            </button>
          </div>
        </div>

        <div className="data-mono pointer-events-none absolute bottom-1 left-2 text-[10px] text-white/50">
          WL {Math.round(wc)} / WW {Math.round(ww)}
        </div>

        {captureError && (
          <div className="pointer-events-auto absolute bottom-6 left-1/2 z-20 flex max-w-[calc(100%-1rem)] -translate-x-1/2 items-start gap-2 rounded-lg border border-destructive/40 bg-zinc-950/95 px-2.5 py-2 text-[11px] text-destructive shadow-2xl backdrop-blur-md">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1">{captureError}</span>
            <button
              type="button"
              onClick={() => setCaptureError(null)}
              aria-label={t("ui.dialog.close")}
              className="rounded p-0.5 text-white/50 transition hover:bg-white/10 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
      {!annotating && (
        <input
          type="range"
          min={0}
          max={Math.max(0, total - 1)}
          value={index}
          onChange={(e) => setIndex(Number(e.target.value))}
          className="slice-slider"
          style={{ accentColor: props.accent }}
          aria-label={t("ui.sliceView.sliceAria", { label: props.label })}
        />
      )}

      <CapturePreviewDialog
        open={captureOpen}
        onOpenChange={setCaptureOpen}
        imageUrl={captureUrl}
        fileNamePrefix={`openvd-mpr-${plane}`}
        title={t("ui.sliceView.capturePreviewTitle", { label: props.label })}
        description={t("ui.sliceView.capturePreviewDesc")}
        labels={{
          copy: t("viewer.capture.copy"),
          copied: t("viewer.capture.copied"),
          copyUnsupported: t("viewer.capture.copyUnsupported"),
          copyFailed: t("viewer.capture.copyFailed"),
          download: t("viewer.capture.download"),
        }}
      />
    </div>
  );
}

/** Renderização vetorial de uma anotação sobre o corte (SVG). */
function AnnGlyph({
  ann,
  pxW,
  pxH,
  active,
}: {
  ann: Annotation;
  pxW: number;
  pxH: number;
  active?: boolean;
}) {
  const X = (p: AnnPoint) => p.x * pxW;
  const Y = (p: AnnPoint) => p.y * pxH;
  const sw = Math.max(1.5, Math.min(7, pxW * 0.004));
  const fs = Math.max(11, pxW * 0.03);
  const r = Math.max(4, Math.min(10, pxW * 0.01));
  const color = ann.color || "#ff5d73";
  const opacity = active ? 1 : 0.85;

  const cross = (p: AnnPoint, cr: number) => (
    <g stroke={color} strokeWidth={sw} fill="none">
      <circle cx={X(p)} cy={Y(p)} r={cr} fill={active ? color : "none"} fillOpacity={0.15} />
      <path d={`M ${X(p) - cr} ${Y(p)} h ${cr * 2} M ${X(p)} ${Y(p) - cr} v ${cr * 2}`} />
    </g>
  );

  if (ann.kind === "draw") {
    const d = ann.points
      .map((p, i) => `${i ? "L" : "M"} ${X(p).toFixed(2)} ${Y(p).toFixed(2)}`)
      .join(" ");
    return (
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={sw}
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity={opacity}
      />
    );
  }
  if (ann.kind === "mark") {
    const p = ann.points[0] ?? { x: 0.5, y: 0.5 };
    return <g opacity={opacity}>{cross(p, Math.max(5, Math.min(14, pxW * 0.012)))}</g>;
  }
  if (ann.kind === "arrow") {
    const a = ann.points[0]!;
    const b = ann.points[1] ?? a;
    if (ann.points.length < 2) return null;
    const ang = Math.atan2(Y(b) - Y(a), X(b) - X(a));
    const hs = Math.max(8, Math.min(20, pxW * 0.02));
    const bw = Math.max(4, hs * 0.36);
    return (
      <g opacity={opacity}>
        <line x1={X(a)} y1={Y(a)} x2={X(b)} y2={Y(b)} stroke={color} strokeWidth={sw} />
        <path
          d={`M ${X(b)} ${Y(b)} L ${
            X(b) - hs * Math.cos(ang - 0.45)
          } ${Y(b) - hs * Math.sin(ang - 0.45)} L ${
            X(b) - bw * Math.cos(ang + Math.PI / 2)
          } ${Y(b) - bw * Math.sin(ang + Math.PI / 2)} Z`}
          fill={color}
        />
      </g>
    );
  }
  if (ann.kind === "measure") {
    const a = ann.points[0]!;
    const b = ann.points[1] ?? a;
    const mx = (X(a) + X(b)) / 2;
    const my = (Y(a) + Y(b)) / 2 - sw;
    const label = ann.measure?.lengthMm != null ? `${ann.measure.lengthMm.toFixed(1)} mm` : "";
    return (
      <g opacity={opacity}>
        <line x1={X(a)} y1={Y(a)} x2={X(b)} y2={Y(b)} stroke={color} strokeWidth={sw} />
        <g stroke={color} strokeWidth={sw} fill="none">
          <circle cx={X(a)} cy={Y(a)} r={r} />
          <circle cx={X(b)} cy={Y(b)} r={r} />
        </g>
        {label && (
          <text
            x={mx}
            y={my}
            fill={color}
            fontSize={fs}
            fontWeight={600}
            textAnchor="middle"
            stroke="#000"
            strokeWidth={Math.max(2, sw * 2)}
            paintOrder="stroke"
            fontFamily="Manrope, sans-serif"
          >
            {label}
          </text>
        )}
      </g>
    );
  }
  // text
  const p = ann.points[0] ?? { x: 0.5, y: 0.5 };
  const content = (ann.text || ann.label || "").trim();
  return (
    <g opacity={opacity}>
      {cross(p, r)}
      {content && (
        <text
          x={X(p) + r + 5}
          y={Y(p) - r}
          fill={color}
          fontSize={fs}
          fontWeight={600}
          stroke="#000"
          strokeWidth={Math.max(2, sw * 2)}
          paintOrder="stroke"
          fontFamily="Manrope, sans-serif"
        >
          {content}
        </text>
      )}
    </g>
  );
}

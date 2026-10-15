import type { Plane, Volume } from "@/lib/dicom";

export type Vec3 = [number, number, number];
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export const IDENT3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function isIdentity(m: Mat3) {
  for (let i = 0; i < 9; i++) if (Math.abs(m[i]! - IDENT3[i]!) > 1e-9) return false;
  return true;
}

export function mat3mul(a: Mat3, b: Mat3): Mat3 {
  const o = new Array(9).fill(0) as number[];
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += a[r * 3 + k]! * b[k * 3 + c]!;
      o[r * 3 + c] = s;
    }
  return o as Mat3;
}

export function mat3apply(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0]! * v[0] + m[1]! * v[1] + m[2]! * v[2],
    m[3]! * v[0] + m[4]! * v[1] + m[5]! * v[2],
    m[6]! * v[0] + m[7]! * v[1] + m[8]! * v[2],
  ];
}

/** Rotacao (graus) em torno de um eixo unitario arbitrario. */
export function rotationAround(axis: Vec3, deg: number): Mat3 {
  const len = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  const x = axis[0] / len;
  const y = axis[1] / len;
  const z = axis[2] / len;
  const t = (deg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const k = 1 - c;
  return [
    c + x * x * k,
    x * y * k - z * s,
    x * z * k + y * s,
    y * x * k + z * s,
    c + y * y * k,
    y * z * k - x * s,
    z * x * k - y * s,
    z * y * k + x * s,
    c + z * z * k,
  ];
}

/** Reortonormaliza para evitar deriva numerica ao acumular giros. */
export function orthonormalize(m: Mat3): Mat3 {
  const c0: Vec3 = [m[0]!, m[3]!, m[6]!];
  let c1: Vec3 = [m[1]!, m[4]!, m[7]!];
  const n0 = Math.hypot(c0[0], c0[1], c0[2]) || 1;
  const u0: Vec3 = [c0[0] / n0, c0[1] / n0, c0[2] / n0];
  const d = u0[0] * c1[0] + u0[1] * c1[1] + u0[2] * c1[2];
  c1 = [c1[0] - d * u0[0], c1[1] - d * u0[1], c1[2] - d * u0[2]];
  const n1 = Math.hypot(c1[0], c1[1], c1[2]) || 1;
  const u1: Vec3 = [c1[0] / n1, c1[1] / n1, c1[2] / n1];
  const u2: Vec3 = [
    u0[1] * u1[2] - u0[2] * u1[1],
    u0[2] * u1[0] - u0[0] * u1[2],
    u0[0] * u1[1] - u0[1] * u1[0],
  ];
  return [u0[0], u1[0], u2[0], u0[1], u1[1], u2[1], u0[2], u1[2], u2[2]];
}

/* ------------------------------------------------------------------ *
 * Vetores
 * ------------------------------------------------------------------ */

export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const cross3 = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export function normalize(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

/* ------------------------------------------------------------------ *
 * Planos de reslice: volume FIXO, planos moveis.
 * Cada plano guarda origem (mm no espaco do volume) e seus proprios
 * eixos u/v (no plano) e n (normal). Nenhuma transformacao e aplicada
 * ao volume — a imagem 2D e sempre reamostrada do volume original.
 * ------------------------------------------------------------------ */

export type PlaneState = {
  /** ponto do plano em mm (espaco do volume) */
  origin: Vec3;
  /** eixo horizontal da imagem */
  u: Vec3;
  /** eixo vertical da imagem */
  v: Vec3;
  /** normal do plano */
  n: Vec3;
};

export const PLANES: Plane[] = ["axial", "coronal", "sagittal"];

/** indices dos eixos do volume usados como u, v e normal por padrao */
const AXES: Record<Plane, [number, number, number]> = {
  axial: [0, 1, 2],
  coronal: [0, 2, 1],
  sagittal: [1, 2, 0],
};

const MAX_DIM = 640;

function unit(i: number): Vec3 {
  return [i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0];
}

export function volumeExtent(v: Volume): Vec3 {
  return [(v.nx - 1) * v.sx, (v.ny - 1) * v.sy, (v.nz - 1) * v.sz];
}

export function volumeCenter(v: Volume): Vec3 {
  const e = volumeExtent(v);
  return [e[0] / 2, e[1] / 2, e[2] / 2];
}

/** Plano ortogonal padrao passando pelo centro do volume. */
export function defaultPlaneState(v: Volume, plane: Plane): PlaneState {
  const [iu, iv, iN] = AXES[plane];
  let u = unit(iu);
  let vv = unit(iv);
  // coronal e sagittal abrem invertidos: giro de 180 graus em torno da normal
  if (plane === "coronal" || plane === "sagittal") {
    u = scale(u, -1);
    vv = scale(vv, -1);
  }
  return { origin: volumeCenter(v), u, v: vv, n: unit(iN) };
}

export function defaultPlaneStates(v: Volume): Record<Plane, PlaneState> {
  return {
    axial: defaultPlaneState(v, "axial"),
    coronal: defaultPlaneState(v, "coronal"),
    sagittal: defaultPlaneState(v, "sagittal"),
  };
}

/** Verdadeiro quando o plano ainda esta na orientacao ortogonal original. */
export function isOblique(v: Volume, plane: Plane, st: PlaneState) {
  const d = defaultPlaneState(v, plane);
  return Math.abs(dot(d.n, st.n)) < 0.99995 || Math.abs(dot(d.u, st.u)) < 0.99995;
}

export type PlaneGeom = {
  u: Vec3;
  v: Vec3;
  n: Vec3;
  origin: Vec3;
  pxU: number;
  pxV: number;
  stepN: number;
  w: number;
  h: number;
  total: number;
  index: number;
  spacing: Vec3;
  extent: Vec3;
  centerMM: Vec3;
};

export function planeGeometry(v: Volume, plane: Plane, st: PlaneState): PlaneGeom {
  const [iu, iv, iN] = AXES[plane];
  const spacing: Vec3 = [v.sx, v.sy, v.sz];
  const extent = volumeExtent(v);
  const centerMM = volumeCenter(v);
  const span = (d: Vec3) =>
    Math.abs(d[0]) * extent[0] + Math.abs(d[1]) * extent[1] + Math.abs(d[2]) * extent[2];

  let pxU = spacing[iu]!;
  let pxV = spacing[iv]!;
  const stepN = spacing[iN]!;
  // Campo de visao FIXO (padrao do 3D Slicer): o retangulo amostrado usa as
  // dimensoes nativas do corte ortogonal deste plano, independente de como o
  // plano for girado/inclinado (obliquo). A imagem nao "cresce" nem muda de
  // resolucao conforme o angulo do corte; girar apenas reamostra o volume em
  // outra direcao dentro da mesma janela (fora do volume = fundo preto).
  let w = Math.max(2, Math.round(extent[iu]! / pxU) + 1);
  let h = Math.max(2, Math.round(extent[iv]! / pxV) + 1);
  const over = Math.max(w, h) / MAX_DIM;
  if (over > 1) {
    w = Math.max(2, Math.round(w / over));
    h = Math.max(2, Math.round(h / over));
    pxU *= over;
    pxV *= over;
  }

  const total = Math.max(1, Math.round(span(st.n) / stepN) + 1);
  const t = dot(sub(st.origin, centerMM), st.n);
  const half = ((total - 1) * stepN) / 2;
  const index = Math.min(total - 1, Math.max(0, Math.round((t + half) / stepN)));

  return {
    u: st.u,
    v: st.v,
    n: st.n,
    origin: st.origin,
    pxU,
    pxV,
    stepN,
    w,
    h,
    total,
    index,
    spacing,
    extent,
    centerMM,
  };
}

/** Move o plano ao longo da propria normal ate o indice de corte pedido. */
export function setPlaneIndex(g: PlaneGeom, st: PlaneState, index: number): PlaneState {
  const i = Math.min(g.total - 1, Math.max(0, index));
  const delta = (i - g.index) * g.stepN;
  return { ...st, origin: add(st.origin, scale(st.n, delta)) };
}

/** Translada o plano ao longo da propria normal (mm). */
export function translatePlane(st: PlaneState, mm: number): PlaneState {
  return { ...st, origin: add(st.origin, scale(st.n, mm)) };
}

/** Reposiciona o plano para conter o ponto p, sem alterar a orientacao. */
export function movePlaneThrough(st: PlaneState, p: Vec3): PlaneState {
  const d = dot(sub(p, st.origin), st.n);
  return { ...st, origin: add(st.origin, scale(st.n, d)) };
}

/** Rotaciona o plano em torno de um eixo passando por pivot. */
export function rotatePlane(st: PlaneState, axis: Vec3, deg: number, pivot: Vec3): PlaneState {
  const R = rotationAround(normalize(axis), deg);
  const u = normalize(mat3apply(R, st.u));
  let v = normalize(mat3apply(R, st.v));
  const n = normalize(cross3(u, v));
  // reortogonaliza v contra u para evitar deriva
  const vv = normalize(cross3(n, u));
  v = dot(vv, v) < 0 ? scale(vv, -1) : vv;
  const origin = add(pivot, mat3apply(R, sub(st.origin, pivot)));
  return { origin, u, v, n };
}

/**
 * Rotaciona os TRES planos como um referencial rigido, mantendo-os sempre
 * perpendiculares entre si. O volume continua fixo.
 */
export function rotateAllPlanes(
  s: Record<Plane, PlaneState>,
  axis: Vec3,
  deg: number,
  pivot: Vec3,
): Record<Plane, PlaneState> {
  return {
    axial: rotatePlane(s.axial, axis, deg, pivot),
    coronal: rotatePlane(s.coronal, axis, deg, pivot),
    sagittal: rotatePlane(s.sagittal, axis, deg, pivot),
  };
}

/**
 * Rotaciona apenas os dois planos diferentes de `keep`, mantendo o plano da
 * janela onde a rotacao acontece na sua orientacao atual (ortogonal).
 */
export function rotateOtherPlanes(
  s: Record<Plane, PlaneState>,
  keep: Plane,
  axis: Vec3,
  deg: number,
  pivot: Vec3,
): Record<Plane, PlaneState> {
  const out = { ...s };
  for (const p of PLANES) {
    if (p === keep) continue;
    out[p] = rotatePlane(s[p], axis, deg, pivot);
  }
  return out;
}

/** Mantem o plano dentro dos limites do volume. */
export function clampPlane(v: Volume, st: PlaneState): PlaneState {
  const e = volumeExtent(v);
  const o: Vec3 = [
    Math.min(e[0], Math.max(0, st.origin[0])),
    Math.min(e[1], Math.max(0, st.origin[1])),
    Math.min(e[2], Math.max(0, st.origin[2])),
  ];
  return { ...st, origin: o };
}

/** Ponto de interseccao dos tres planos (null quando degenerado). */
export function planesIntersection(a: PlaneState, b: PlaneState, c: PlaneState): Vec3 | null {
  const d1 = dot(a.n, a.origin);
  const d2 = dot(b.n, b.origin);
  const d3 = dot(c.n, c.origin);
  const det =
    a.n[0] * (b.n[1] * c.n[2] - b.n[2] * c.n[1]) -
    a.n[1] * (b.n[0] * c.n[2] - b.n[2] * c.n[0]) +
    a.n[2] * (b.n[0] * c.n[1] - b.n[1] * c.n[0]);
  if (Math.abs(det) < 1e-9) return null;
  const inv = (m: Vec3[], i: number, j: number) => {
    const r0 = m[(i + 1) % 3]!;
    const r1 = m[(i + 2) % 3]!;
    const c0 = (j + 1) % 3;
    const c1 = (j + 2) % 3;
    return r0[c0]! * r1[c1]! - r0[c1]! * r1[c0]!;
  };
  const rows: Vec3[] = [a.n, b.n, c.n];
  const rhs = [d1, d2, d3];
  const out: Vec3 = [0, 0, 0];
  for (let j = 0; j < 3; j++) {
    let s = 0;
    for (let i = 0; i < 3; i++) s += (inv(rows, i, j) / det) * rhs[i]!;
    out[j] = s;
  }
  return out;
}

/** Ponto de referencia (cursor 3D) dos tres planos. */
export function crosshair(v: Volume, s: Record<Plane, PlaneState>): Vec3 {
  return planesIntersection(s.axial, s.coronal, s.sagittal) ?? volumeCenter(v);
}

/** Normalizado 0..1 por eixo do volume, para o render 3D. */
export function toNormalized(v: Volume, p: Vec3) {
  const e = volumeExtent(v);
  return {
    x: e[0] ? Math.min(1, Math.max(0, p[0] / e[0])) : 0.5,
    y: e[1] ? Math.min(1, Math.max(0, p[1] / e[1])) : 0.5,
    z: e[2] ? Math.min(1, Math.max(0, p[2] / e[2])) : 0.5,
  };
}

/** Coordenadas 2D (mm, relativas ao centro da imagem) de um ponto 3D. */
export function toPlane2D(g: PlaneGeom, p: Vec3) {
  const d = sub(p, g.origin);
  return { a: dot(d, g.u), b: dot(d, g.v) };
}

/** Ponto 3D a partir de coordenadas 2D do plano (mm). */
export function fromPlane2D(g: PlaneGeom, a: number, b: number): Vec3 {
  return add(g.origin, add(scale(g.u, a), scale(g.v, b)));
}

/**
 * Linha de interseccao do plano `other` vista dentro do plano `g`:
 * A*a + B*b = c, com (a,b) em mm relativos ao centro da imagem.
 */
export function intersectionLine(g: PlaneGeom, other: PlaneState) {
  const A = dot(g.u, other.n);
  const B = dot(g.v, other.n);
  const c = dot(sub(other.origin, g.origin), other.n);
  const norm = Math.hypot(A, B);
  if (norm < 1e-6) return null;
  return { A, B, c, norm };
}

function sampleTrilinear(v: Volume, x: number, y: number, z: number, outside: number) {
  if (x < 0 || y < 0 || z < 0 || x > v.nx - 1 || y > v.ny - 1 || z > v.nz - 1) return outside;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const x1 = Math.min(v.nx - 1, x0 + 1);
  const y1 = Math.min(v.ny - 1, y0 + 1);
  const z1 = Math.min(v.nz - 1, z0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const fz = z - z0;
  const nxy = v.nx * v.ny;
  const d = v.data;
  const i000 = z0 * nxy + y0 * v.nx;
  const i001 = z1 * nxy + y0 * v.nx;
  const i010 = z0 * nxy + y1 * v.nx;
  const i011 = z1 * nxy + y1 * v.nx;
  const c00 = d[i000 + x0]! * (1 - fx) + d[i000 + x1]! * fx;
  const c01 = d[i001 + x0]! * (1 - fx) + d[i001 + x1]! * fx;
  const c10 = d[i010 + x0]! * (1 - fx) + d[i010 + x1]! * fx;
  const c11 = d[i011 + x0]! * (1 - fx) + d[i011 + x1]! * fx;
  const c0 = c00 * (1 - fy) + c10 * fy;
  const c1 = c01 * (1 - fy) + c11 * fy;
  return c0 * (1 - fz) + c1 * fz;
}

/**
 * Reamostra (reslice) o volume ORIGINAL no plano informado. A imagem 2D e
 * sempre recalculada por interpolacao trilinear — nunca por rotacao da
 * imagem ja renderizada.
 */
export function renderPlane(
  v: Volume,
  plane: Plane,
  st: PlaneState,
  center: number,
  width: number,
  invert: boolean,
): { img: ImageData; g: PlaneGeom } {
  const g = planeGeometry(v, plane, st);
  const { w, h } = g;
  const img = new ImageData(w, h);
  const px = img.data;
  const lo = center - width / 2;
  const scaleG = 255 / Math.max(1, width);
  const outside = v.min;
  const su = g.spacing[0]!;
  const sv = g.spacing[1]!;
  const sw = g.spacing[2]!;
  const o = st.origin;

  for (let y = 0; y < h; y++) {
    const dv = (y - (h - 1) / 2) * g.pxV;
    const baseX = o[0] + st.v[0] * dv;
    const baseY = o[1] + st.v[1] * dv;
    const baseZ = o[2] + st.v[2] * dv;
    for (let x = 0; x < w; x++) {
      const du = (x - (w - 1) / 2) * g.pxU;
      const val = sampleTrilinear(
        v,
        (baseX + st.u[0] * du) / su,
        (baseY + st.u[1] * du) / sv,
        (baseZ + st.u[2] * du) / sw,
        outside,
      );
      let gray = (val - lo) * scaleG;
      gray = gray < 0 ? 0 : gray > 255 ? 255 : gray;
      if (invert) gray = 255 - gray;
      const off = (y * w + x) * 4;
      px[off] = gray;
      px[off + 1] = gray;
      px[off + 2] = gray;
      px[off + 3] = 255;
    }
  }
  return { img, g };
}

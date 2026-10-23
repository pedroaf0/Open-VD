import type { PlaneState } from "@/lib/mpr";
import type { FlipFlags } from "@/components/viewer/types";

/** Serializa um plano para o formato salvo nas configurações da cena. */
export const serializePlane = (p: PlaneState) => ({
  origin: [...p.origin],
  u: [...p.u],
  v: [...p.v],
  n: [...p.n],
});

/** Normaliza flags vindos das configurações da cena (podem faltar/inválidos). */
export const normalizeFlip = (f: FlipFlags | null | undefined): FlipFlags => ({
  x: f?.x === true,
  y: f?.y === true,
  z: f?.z === true,
});

/** Converte do formato serializado (number[]) para PlaneState (Vec3 tuples). */
export const deserializePlane = (p: {
  origin: number[];
  u: number[];
  v: number[];
  n: number[];
}): PlaneState => ({
  origin: [p.origin[0] ?? 0, p.origin[1] ?? 0, p.origin[2] ?? 0] as [number, number, number],
  u: [p.u[0] ?? 1, p.u[1] ?? 0, p.u[2] ?? 0] as [number, number, number],
  v: [p.v[0] ?? 0, p.v[1] ?? 1, p.v[2] ?? 0] as [number, number, number],
  n: [p.n[0] ?? 0, p.n[1] ?? 0, p.n[2] ?? 1] as [number, number, number],
});

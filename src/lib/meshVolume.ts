import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import type { MeshFile } from "@/components/Volume3D";

function signedVolumeTriangle(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
) {
  return (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6;
}

function computeGeometryVolume(geo: THREE.BufferGeometry): number {
  const pos = geo.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!pos) return 0;
  const idx = geo.index;
  let vol = 0;
  if (idx) {
    for (let i = 0; i < idx.count; i += 3) {
      const a = idx.getX(i);
      const b = idx.getX(i + 1);
      const c = idx.getX(i + 2);
      vol += signedVolumeTriangle(
        pos.getX(a),
        pos.getY(a),
        pos.getZ(a),
        pos.getX(b),
        pos.getY(b),
        pos.getZ(b),
        pos.getX(c),
        pos.getY(c),
        pos.getZ(c),
      );
    }
  } else {
    for (let i = 0; i < pos.count; i += 3) {
      vol += signedVolumeTriangle(
        pos.getX(i),
        pos.getY(i),
        pos.getZ(i),
        pos.getX(i + 1),
        pos.getY(i + 1),
        pos.getZ(i + 1),
        pos.getX(i + 2),
        pos.getY(i + 2),
        pos.getZ(i + 2),
      );
    }
  }
  return Math.abs(vol);
}

function isWatertight(geo: THREE.BufferGeometry): boolean {
  const pos = geo.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!pos || pos.count < 3) return false;
  const idx = geo.index;
  const edgeCount = new Map<string, number>();
  const addEdge = (a: number, b: number) => {
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1);
  };
  if (idx) {
    if (idx.count % 3 !== 0) return false;
    for (let i = 0; i < idx.count; i += 3) {
      const a = idx.getX(i);
      const b = idx.getX(i + 1);
      const c = idx.getX(i + 2);
      if (a === b || b === c || a === c) continue;
      addEdge(a, b);
      addEdge(b, c);
      addEdge(c, a);
    }
  } else {
    const keyToId = new Map<string, number>();
    const vertIds: number[] = new Array(pos.count);
    let nextId = 0;
    for (let i = 0; i < pos.count; i++) {
      const key = `${pos.getX(i)}|${pos.getY(i)}|${pos.getZ(i)}`;
      let id = keyToId.get(key);
      if (id === undefined) {
        id = nextId++;
        keyToId.set(key, id);
      }
      vertIds[i] = id;
    }
    if (vertIds.length % 3 !== 0) return false;
    for (let i = 0; i < vertIds.length; i += 3) {
      const a = vertIds[i]!;
      const b = vertIds[i + 1]!;
      const c = vertIds[i + 2]!;
      if (a === b || b === c || a === c) continue;
      addEdge(a, b);
      addEdge(b, c);
      addEdge(c, a);
    }
  }
  if (edgeCount.size === 0) return false;
  for (const v of edgeCount.values()) if (v !== 2) return false;
  return true;
}

export function computeGeometryVolumeInfo(
  geo: THREE.BufferGeometry,
): { volumeMm3: number; closed: boolean } | null {
  const pos = geo.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!pos || pos.count === 0) return null;
  const vol = computeGeometryVolume(geo);
  if (!isFinite(vol) || vol <= 1e-9) return { volumeMm3: 0, closed: false };
  const closed = isWatertight(geo);
  return { volumeMm3: vol, closed };
}

export function computeMeshFileVolume(
  file: Pick<MeshFile, "data" | "ext" | "mtl">,
): { volumeMm3: number; closed: boolean } | null {
  try {
    if (file.ext === "obj" && file.data) {
      const text = new TextDecoder().decode(file.data);
      const parsed = new OBJLoader().parse(text);
      let total = 0;
      let allClosed = true;
      let found = false;
      parsed.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const g = m.geometry as THREE.BufferGeometry;
        if (!g) return;
        const info = computeGeometryVolumeInfo(g);
        if (!info) return;
        found = true;
        total += info.volumeMm3;
        if (!info.closed) allClosed = false;
      });
      if (!found) return null;
      return { volumeMm3: total, closed: allClosed };
    }
    let geo: THREE.BufferGeometry;
    if (file.ext === "ply") geo = new PLYLoader().parse(file.data as ArrayBuffer);
    else geo = new STLLoader().parse(file.data as ArrayBuffer);
    const info = computeGeometryVolumeInfo(geo);
    geo.dispose();
    return info;
  } catch {
    return null;
  }
}

export function formatMeshVolume(mm3: number): string {
  if (!isFinite(mm3) || mm3 <= 0) return "";
  const cm3 = mm3 / 1000;
  if (cm3 >= 1) return `${cm3.toFixed(2)} cm³`;
  if (cm3 >= 0.1) return `${cm3.toFixed(2)} cm³`;
  if (mm3 >= 100) return `${mm3.toFixed(1)} mm³`;
  if (mm3 >= 1) return `${mm3.toFixed(1)} mm³`;
  return `${mm3.toFixed(2)} mm³`;
}

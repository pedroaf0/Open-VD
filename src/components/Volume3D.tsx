import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import { makeTextureVolume, type Plane, type Volume } from "@/lib/dicom";
import {
  defaultPlaneStates,
  planeGeometry,
  renderPlane,
  type PlaneState,
  type Vec3,
} from "@/lib/mpr";
import { forcedMeshColor } from "@/lib/meshColors";

export type MeshFile = {
  id: string;
  name: string;
  data: ArrayBuffer;
  ext: "stl" | "ply" | "obj";
  color: string;
  visible: boolean;
  opacity: number;
  coordSystem: "lps" | "ras";
  /** OBJ only: contents of the companion .mtl file */
  mtl?: string;
  /** OBJ only: texture file name (lowercase) -> object URL */
  textures?: Record<string, string>;
};

type Props = {
  volume: Volume | null;
  meshes: MeshFile[];
  threshold: number;
  opacity: number;
  showVolume: boolean;
  showPlanes: Record<Plane, boolean>;
  cross: { x: number; y: number; z: number };
  /** estado (origem + eixos) dos planos de reslice; permite cortes obliquos no 3D */
  planes?: Record<Plane, PlaneState>;
  wc: number;
  ww: number;
  invert: boolean;
};

const vert = /* glsl */ `
out vec3 vOrigin;
out vec3 vDirection;
void main() {
  vec3 camLocal = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
  vOrigin = camLocal + vec3(0.5);
  vDirection = position - camLocal;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const frag = /* glsl */ `
precision highp float;
precision highp sampler3D;
in vec3 vOrigin;
in vec3 vDirection;
out vec4 outColor;
uniform sampler3D uData;
uniform float uThreshold;
uniform float uOpacity;
uniform float uSteps;

vec2 hitBox(vec3 orig, vec3 dir) {
  vec3 inv = 1.0 / dir;
  vec3 tmin = (vec3(0.0) - orig) * inv;
  vec3 tmax = (vec3(1.0) - orig) * inv;
  vec3 t1 = min(tmin, tmax);
  vec3 t2 = max(tmin, tmax);
  return vec2(max(max(t1.x, t1.y), t1.z), min(min(t2.x, t2.y), t2.z));
}

void main() {
  vec3 rayDir = normalize(vDirection);
  vec2 bounds = hitBox(vOrigin, rayDir);
  if (bounds.x > bounds.y) discard;
  bounds.x = max(bounds.x, 0.0);
  float dt = (bounds.y - bounds.x) / uSteps;
  vec3 p = vOrigin + bounds.x * rayDir;
  vec4 acc = vec4(0.0);
  for (float i = 0.0; i < 512.0; i += 1.0) {
    if (i >= uSteps) break;
    float d = texture(uData, p).r;
     if (d > uThreshold) {
      float a = clamp((d - uThreshold) / max(0.001, 1.0 - uThreshold) * uOpacity, 0.0, 1.0);
      vec3 col = vec3(1.0);
      acc.rgb += (1.0 - acc.a) * a * col;
      acc.a += (1.0 - acc.a) * a;
      if (acc.a > 0.97) break;
    }
    p += rayDir * dt;
  }
  if (acc.a < 0.01) discard;
  outColor = acc;
}`;

const v3 = (a: [number, number, number]) => new THREE.Vector3(a[0], a[1], a[2]);

/** Basis of the volume in patient LPS millimetres. */
function volumeBasis(v: Volume) {
  const u = v3(v.rowDir).multiplyScalar(v.sx); // per voxel along x
  const w = v3(v.colDir).multiplyScalar(v.sy); // per voxel along y
  const s = v3(v.sliceDir).multiplyScalar(v.sz); // per voxel along z
  return { origin: v3(v.origin), u, w, s };
}

/** Matrix placing a unit-centred geometry given a proper orthonormal basis + centre. */
function basisMatrix(x: THREE.Vector3, y: THREE.Vector3, z: THREE.Vector3, c: THREE.Vector3) {
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  m.setPosition(c);
  return m;
}

export function Volume3D({
  volume,
  meshes,
  threshold,
  opacity,
  showVolume,
  showPlanes,
  planes,
  wc,
  ww,
  invert,
}: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const matRef = useRef<THREE.ShaderMaterial | null>(null);
  const volMeshRef = useRef<THREE.Mesh | null>(null);
  const rootRef = useRef<THREE.Group | null>(null);
  const lpsRef = useRef<THREE.Group | null>(null);
  const meshGroupRef = useRef<THREE.Group | null>(null);
  const planeGroupRef = useRef<THREE.Group | null>(null);
  const planeRefs = useRef<Record<Plane, THREE.Mesh | null>>({
    axial: null,
    coronal: null,
    sagittal: null,
  });
  const planeOutlineRefs = useRef<Record<Plane, THREE.LineSegments | null>>({
    axial: null,
    coronal: null,
    sagittal: null,
  });
  const canvases = useRef<Record<Plane, HTMLCanvasElement | null>>({
    axial: null,
    coronal: null,
    sagittal: null,
  });

  const planeColors: Record<Plane, number> = {
    axial: 0x63a4ff,
    coronal: 0x47d39c,
    sagittal: 0xffa75a,
  };

  const meshKey = useMemo(() => meshes.map((m) => `${m.id}:${m.coordSystem}`).join("|"), [meshes]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const dir = new THREE.DirectionalLight(0xffffff, 1.4);
    dir.position.set(1, 1, 1);
    scene.add(dir);
    const dir2 = new THREE.DirectionalLight(0xffffff, 0.6);
    dir2.position.set(-1, -1, -0.5);
    scene.add(dir2);

    // root: world space in RAS millimetres, re-centred + normalised for the camera
    const root = new THREE.Group();
    root.matrixAutoUpdate = false;
    scene.add(root);
    rootRef.current = root;

    // LPS -> RAS (rotate 180deg around the S axis)
    const lps = new THREE.Group();
    lps.matrixAutoUpdate = false;
    lps.matrix.makeScale(-1, -1, 1);
    root.add(lps);
    lpsRef.current = lps;

    const planes = new THREE.Group();
    lps.add(planes);
    planeGroupRef.current = planes;

    const meshGroup = new THREE.Group();
    root.add(meshGroup);
    meshGroupRef.current = meshGroup;

    const camera = new THREE.PerspectiveCamera(
      45,
      mount.clientWidth / mount.clientHeight,
      0.01,
      100,
    );
    camera.position.set(0, -2.2, 0.9);
    camera.up.set(0, 0, 1);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    let raf = 0;
    const loop = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    loop();

    const ro = new ResizeObserver(() => {
      if (!mount.clientWidth) return;
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
    });
    ro.observe(mount);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, []);

  // ---- volume rendering ------------------------------------------------
  useEffect(() => {
    const lps = lpsRef.current;
    if (!lps) return;
    if (volMeshRef.current) {
      lps.remove(volMeshRef.current);
      volMeshRef.current.geometry.dispose();
      volMeshRef.current = null;
    }
    if (!volume) return;
    const { data, tx, ty, tz } = makeTextureVolume(volume);
    const tex = new THREE.Data3DTexture(data, tx, ty, tz);
    tex.format = THREE.RedFormat;
    tex.type = THREE.UnsignedByteType;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.unpackAlignment = 1;
    tex.needsUpdate = true;

    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        uData: { value: tex },
        uThreshold: { value: threshold },
        uOpacity: { value: opacity },
        uSteps: { value: 256 },
      },
      vertexShader: vert,
      fragmentShader: frag,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    matRef.current = material;

    const { origin, u, w, s } = volumeBasis(volume);
    const ex = u.clone().multiplyScalar(volume.nx);
    const ey = w.clone().multiplyScalar(volume.ny);
    const ez = s.clone().multiplyScalar(volume.nz);
    const centre = origin
      .clone()
      .add(ex.clone().multiplyScalar(0.5))
      .add(ey.clone().multiplyScalar(0.5))
      .add(ez.clone().multiplyScalar(0.5));

    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(basisMatrix(ex, ey, ez, centre));
    mesh.visible = showVolume;
    mesh.renderOrder = 1;
    mesh.frustumCulled = false;
    lps.add(mesh);
    volMeshRef.current = mesh;

    return () => {
      tex.dispose();
      material.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [volume]);

  useEffect(() => {
    const u = matRef.current?.uniforms;
    if (u) {
      u["uThreshold"]!.value = threshold;
      u["uOpacity"]!.value = opacity;
    }
    if (volMeshRef.current) volMeshRef.current.visible = showVolume;
  }, [threshold, opacity, showVolume]);

  // ---- slice planes in 3D ---------------------------------------------
  useEffect(() => {
    const group = planeGroupRef.current;
    if (!group) return;
    for (const child of [...group.children]) {
      group.remove(child);
      const p = child as THREE.Mesh;
      if (p.geometry) p.geometry.dispose();
      const rawMat = p.material;
      if (Array.isArray(rawMat)) {
        rawMat.forEach((m) => m.dispose());
      } else if (rawMat) {
        const map = (rawMat as THREE.MeshBasicMaterial).map;
        if (map) map.dispose();
        rawMat.dispose();
      }
    }
    planeRefs.current = { axial: null, coronal: null, sagittal: null };
    planeOutlineRefs.current = { axial: null, coronal: null, sagittal: null };
    canvases.current = { axial: null, coronal: null, sagittal: null };
    if (!volume) return;

    (["axial", "coronal", "sagittal"] as Plane[]).forEach((plane) => {
      const canvas = document.createElement("canvas");
      canvas.width = 2;
      canvas.height = 2;
      canvases.current[plane] = canvas;
      const tex = new THREE.CanvasTexture(canvas);
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      // plano opaco: desenha na passada opaca ANTES das malhas transparen
      // e escreve no depth buffer, entao as malhas na frente do corte ocue
      // o plano (metade "do nosso lado" visivel) e a metade de tras fica
      // oculta pelo corte.
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }),
      );
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
      planeRefs.current[plane] = mesh;

      const outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)),
        new THREE.LineBasicMaterial({
          color: planeColors[plane],
          transparent: true,
          opacity: 0.96,
        }),
      );
      outline.matrixAutoUpdate = false;
      outline.visible = false;
      group.add(outline);
      planeOutlineRefs.current[plane] = outline;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [volume]);

  // update plane textures + positions (reslice obliquo: volume fixo, planos moveis)
  useEffect(() => {
    if (!volume) return;
    const states = planes ?? defaultPlaneStates(volume);
    const o = v3(volume.origin);
    const dx = v3(volume.rowDir);
    const dy = v3(volume.colDir);
    const dz = v3(volume.sliceDir);
    /** direcao em mm do espaco do volume -> LPS */
    const mapDir = (d: Vec3) =>
      dx
        .clone()
        .multiplyScalar(d[0])
        .add(dy.clone().multiplyScalar(d[1]))
        .add(dz.clone().multiplyScalar(d[2]));
    const mapPoint = (p: Vec3) => o.clone().add(mapDir(p));

    (["axial", "coronal", "sagittal"] as Plane[]).forEach((plane) => {
      const mesh = planeRefs.current[plane];
      const outline = planeOutlineRefs.current[plane];
      const canvas = canvases.current[plane];
      if (!mesh || !canvas) return;
      const st = states[plane];
      const g = planeGeometry(volume, plane, st);
      const ctx = canvas.getContext("2d");
      if (ctx) {
        const { img } = renderPlane(volume, plane, st, wc, ww, invert);
        if (canvas.width !== img.width || canvas.height !== img.height) {
          canvas.width = img.width;
          canvas.height = img.height;
        }
        ctx.putImageData(img, 0, 0);
        (mesh.material as THREE.MeshBasicMaterial).map!.needsUpdate = true;
      }
      // quad fisico do corte: usa uma base ortonormal global para manter o plano
      // alinhado ao volume e aos STL mesmo quando a orientacao do corte deixa de ser ortogonal.
      const uWorld = mapDir(g.u).normalize();
      const vWorld = mapDir(g.v).normalize();
      const normal = new THREE.Vector3().crossVectors(uWorld, vWorld).normalize();
      const vOrtho = new THREE.Vector3().crossVectors(normal, uWorld).normalize();
      const bu = uWorld.clone().multiplyScalar(g.w * g.pxU);
      const bv = vOrtho.clone().multiplyScalar(-(g.h * g.pxV));
      const c = mapPoint(g.origin);
      const matrix = basisMatrix(bu, bv, normal, c);
      mesh.matrix.copy(matrix);
      if (outline) {
        outline.matrix.copy(matrix);
        outline.visible = showPlanes[plane];
      }
      mesh.visible = showPlanes[plane];
    });
  }, [volume, planes, wc, ww, invert, showPlanes]);

  // ---- meshes (STL / PLY / OBJ+MTL) -----------------------------------
  useEffect(() => {
    const group = meshGroupRef.current;
    if (!group) return;
    for (const child of [...group.children]) {
      group.remove(child);
      child.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          for (const mat of Array.isArray(m.material) ? m.material : [m.material])
            (mat as THREE.Material).dispose();
        }
      });
    }
    for (const item of meshes) {
      let object: THREE.Object3D | null = null;
      const effectiveColor = forcedMeshColor(item.name) ?? item.color;

      if (item.ext === "obj") {
        try {
          const text = new TextDecoder().decode(item.data);
          const loader = new OBJLoader();
          if (item.mtl) {
            const manager = new THREE.LoadingManager();
            manager.setURLModifier((url) => {
              const base = (url.split("/").pop() ?? url).toLowerCase();
              return item.textures?.[base] ?? url;
            });
            const materials = new MTLLoader(manager).parse(item.mtl, "");
            materials.preload();
            loader.setMaterials(materials);
          }
          const parsed = loader.parse(text);
          let any = false;
          parsed.traverse((o) => {
            const m = o as THREE.Mesh;
            if (!m.isMesh) return;
            any = true;
            if (!m.geometry.getAttribute("normal")) m.geometry.computeVertexNormals();
            m.renderOrder = 1;
            for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
              const mm = mat as THREE.MeshPhongMaterial;
              mm.side = THREE.DoubleSide;
              mm.transparent = true;
              mm.opacity = item.opacity ?? 0.95;
              mm.depthWrite = true;
              if (!mm.map) mm.color.set(effectiveColor);
              mm.needsUpdate = true;
            }
          });
          if (any) object = parsed;
        } catch {
          object = null;
        }
      } else {
        let geo: THREE.BufferGeometry;
        try {
          geo =
            item.ext === "ply"
              ? new PLYLoader().parse(item.data)
              : new STLLoader().parse(item.data);
        } catch {
          continue;
        }
        const pos = geo.getAttribute("position");
        if (!pos || !pos.count) continue;
        const hasColors = !!geo.getAttribute("color");
        if (!geo.getAttribute("normal")) geo.computeVertexNormals();
        geo.computeBoundingBox();
        geo.computeBoundingSphere();
        if (!geo.boundingSphere || !Number.isFinite(geo.boundingSphere.radius)) continue;
        object = new THREE.Mesh(
          geo,
          new THREE.MeshStandardMaterial({
            color: hasColors ? 0xffffff : new THREE.Color(effectiveColor),
            vertexColors: hasColors,
            metalness: 0.1,
            roughness: 0.45,
            transparent: true,
            opacity: item.opacity ?? 0.95,
            depthWrite: true,
            side: THREE.DoubleSide,
          }),
        );
      }

      if (!object) continue;
      object.name = item.id;
      // desenha as malhas depois dos planos: com depth write ligado, a metade
      // da malha que esta na frente do corte tampa o plano e a de tras e
      // ocultada pelo proprio corte (vemos o lado do nosso campo de visao).
      object.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.renderOrder = 1;
      });
      if (item.coordSystem === "lps") object.scale.set(-1, -1, 1);
      group.add(object);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meshKey]);

  // colour / visibility without rebuilding geometry
  useEffect(() => {
    const group = meshGroupRef.current;
    if (!group) return;
    for (const item of meshes) {
      const object = group.getObjectByName(item.id);
      if (!object) continue;
      object.visible = item.visible;
      const effectiveColor = forcedMeshColor(item.name) ?? item.color;
      object.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          const m = mat as THREE.MeshStandardMaterial;
          m.opacity = item.opacity;
          m.transparent = true;
          m.depthWrite = true;
          if (!m.vertexColors && !m.map) m.color.set(effectiveColor);
          m.needsUpdate = true;
        }
      });
    }
  }, [meshes]);

  // ---- framing ---------------------------------------------------------
  useEffect(() => {
    const root = rootRef.current;
    const lps = lpsRef.current;
    const group = meshGroupRef.current;
    if (!root || !lps || !group) return;
    root.matrix.identity();
    root.updateMatrixWorld(true);

    const box = new THREE.Box3();
    if (volume) {
      const { origin, u, w, s } = volumeBasis(volume);
      const ex = u.clone().multiplyScalar(volume.nx);
      const ey = w.clone().multiplyScalar(volume.ny);
      const ez = s.clone().multiplyScalar(volume.nz);
      for (let i = 0; i < 8; i++) {
        const p = origin.clone();
        if (i & 1) p.add(ex);
        if (i & 2) p.add(ey);
        if (i & 4) p.add(ez);
        box.expandByPoint(p.applyMatrix4(lps.matrix));
      }
    }
    if (group.children.length) {
      // reference size: the volume when present, otherwise the largest model
      const boxes: THREE.Box3[] = [];
      for (const child of group.children) {
        const b = new THREE.Box3().setFromObject(child);
        if (b.isEmpty()) continue;
        const size = b.getSize(new THREE.Vector3());
        if (![size.x, size.y, size.z, b.min.x, b.min.y, b.min.z].every(Number.isFinite)) continue;
        boxes.push(b);
      }
      const ref = box.isEmpty()
        ? Math.max(0.001, ...boxes.map((b) => b.getSize(new THREE.Vector3()).length()))
        : box.getSize(new THREE.Vector3()).length();
      for (const b of boxes) {
        // skip models whose extent is wildly off (corrupt / different units)
        if (b.getSize(new THREE.Vector3()).length() > ref * 20) continue;
        box.union(b);
      }
    }
    if (box.isEmpty()) return;

    const centre = box.getCenter(new THREE.Vector3());
    const span = Math.max(0.001, box.getSize(new THREE.Vector3()).length());
    const scale = 1.6 / span;
    root.matrix
      .makeTranslation(-centre.x, -centre.y, -centre.z)
      .premultiply(new THREE.Matrix4().makeScale(scale, scale, scale));
    root.updateMatrixWorld(true);
  }, [volume, meshKey]);

  return <div ref={mountRef} className="h-full w-full bg-black" />;
}

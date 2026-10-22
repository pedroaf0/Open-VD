import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
  Gauge,
  Info,
  Minus,
  Plus,
  RotateCcw,
  Sparkles,
  Square,
  Video,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CapturePreviewDialog } from "@/components/CapturePreviewDialog";
import { VideoPreviewDialog } from "@/components/VideoPreviewDialog";
import { makeTextureVolume, type Plane, type Volume } from "@/lib/dicom";
import {
  defaultPlaneStates,
  planeGeometry,
  renderPlane,
  type PlaneState,
  type Vec3,
} from "@/lib/mpr";
import { forcedMeshColor } from "@/lib/meshColors";
import { setRenderMode, useRenderMode, type RenderMode } from "@/lib/renderMode";
import {
  chooseRecordingMimeType,
  formatRecordingDuration,
  recordingFileExtension,
} from "@/lib/videoCapture";
import {
  createStaticDepthTarget,
  createTransparencyUniforms,
  DepthPeeling,
  patchTransparencyMaterial,
  setMaterialFast,
  WeightedOIT,
} from "@/lib/transparency";
import { cn } from "@/lib/utils";

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
  /** pedido de centralização da rotação num modelo (gera novo objeto a cada clique) */
  centerRequest?: { id: string; seq: number } | null;
  /** Padrão do nome do vídeo definido no WP Admin (tokens {data}/{hora}/{timestamp}). */
  recordingNamePattern?: string | undefined;
};

const TIP_STORAGE_KEY = "openvd:transparency-tip-seen:v1";
let tipShownThisSession = false;

const AZIMUTH_STEP = 10;
const ELEVATION_STEP = 5;
const ZOOM_FACTOR = 1.14;
const PRECISE_MIN_FRAME_MS = 110;
const RECORDING_FPS = 30;
const RECORDING_BITRATE = 8_000_000;
const RECORDING_CHUNK_MS = 250;

const RENDER_MODE_META: Array<{
  id: RenderMode;
  icon: LucideIcon;
  badgeClass: string;
}> = [
  {
    id: "balanced",
    icon: Gauge,
    badgeClass: "border-sky-400/30 bg-sky-400/10 text-sky-200",
  },
  {
    id: "precise",
    icon: Sparkles,
    badgeClass: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
  },
  {
    id: "fast",
    icon: Zap,
    badgeClass: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  },
];

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
  centerRequest,
  recordingNamePattern,
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

  const { t } = useTranslation();
  const mode = useRenderMode();
  const [showTip, setShowTip] = useState(false);
  const [warningOpen, setWarningOpen] = useState(false);
  const [controlsCollapsed, setControlsCollapsed] = useState(false);
  const transparencyUniforms = useMemo(() => createTransparencyUniforms(), []);
  const modeRef = useRef<RenderMode>(mode);
  const invalidateRef = useRef<() => void>(() => {});
  const warningRef = useRef<() => void>(() => {});
  const controlsRef = useRef<OrbitControls | null>(null);
  const viewControlRef = useRef<{
    step: (deltaAzimuth: number, deltaElevation: number) => void;
    zoom: (factor: number) => void;
    reset: () => void;
  } | null>(null);
  /** Captura a cena e devolve um data URL PNG (ou null em caso de falha). */
  const captureRef = useRef<() => string | null>(() => null);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [captureUrl, setCaptureUrl] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);

  /** Canvas WebGL do viewport 3D; é a fonte da gravação (não a interface). */
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingStartedAtRef = useRef(0);
  const recordingTimerRef = useRef<number | null>(null);
  const videoUrlRef = useRef<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordedSeconds, setRecordedSeconds] = useState(0);
  const [videoOpen, setVideoOpen] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoMime, setVideoMime] = useState("video/webm");

  // ---- first-run hint -------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled || tipShownThisSession) return;
      try {
        if (window.localStorage.getItem(TIP_STORAGE_KEY) === "1") return;
      } catch {
        /* armazenamento indisponível */
      }
      tipShownThisSession = true;
      setShowTip(true);
    }, 900);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!warningOpen) return;
    const timer = window.setTimeout(() => setWarningOpen(false), 9000);
    return () => window.clearTimeout(timer);
  }, [warningOpen]);

  useEffect(() => {
    warningRef.current = () => setWarningOpen(true);
  }, []);

  const dismissTip = () => {
    setShowTip(false);
    try {
      window.localStorage.setItem(TIP_STORAGE_KEY, "1");
    } catch {
      /* armazenamento indisponível */
    }
  };

  const changeMode = (next: RenderMode) => {
    dismissTip();
    setRenderMode(next);
  };

  const handleCapture = () => {
    const dataUrl = captureRef.current();
    if (!dataUrl) {
      setCaptureError(t("viewer.capture.failed"));
      return;
    }
    setCaptureError(null);
    setCaptureUrl(dataUrl);
    setCaptureOpen(true);
  };

  const clearRecordingTimer = () => {
    if (recordingTimerRef.current !== null) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  };

  const releaseVideoUrl = () => {
    if (videoUrlRef.current) {
      URL.revokeObjectURL(videoUrlRef.current);
      videoUrlRef.current = null;
    }
    setVideoUrl(null);
  };

  const openVideoPreview = (blob: Blob, mime: string) => {
    releaseVideoUrl();
    const url = URL.createObjectURL(blob);
    videoUrlRef.current = url;
    setVideoMime(mime || "video/webm");
    setVideoUrl(url);
    setVideoOpen(true);
  };

  const handleVideoOpenChange = (open: boolean) => {
    setVideoOpen(open);
    if (!open) releaseVideoUrl();
  };

  /** Grava o canvas WebGL do viewport (câmera e cena atuais), sem a interface. */
  const startRecording = () => {
    if (recorderRef.current) return;
    const canvas = canvasRef.current;
    if (
      !canvas ||
      typeof canvas.captureStream !== "function" ||
      typeof MediaRecorder === "undefined"
    ) {
      setCaptureError(t("viewer.recording.unsupported"));
      return;
    }

    let stream: MediaStream | null = null;
    try {
      stream = canvas.captureStream(RECORDING_FPS);
      const selectedMime = chooseRecordingMimeType();
      const options: MediaRecorderOptions = {
        videoBitsPerSecond: RECORDING_BITRATE,
      };
      if (selectedMime) options.mimeType = selectedMime;

      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(stream, options);
      } catch {
        recorder = new MediaRecorder(stream);
      }

      recordingChunksRef.current = [];
      recorderRef.current = recorder;
      recordingStreamRef.current = stream;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordingChunksRef.current.push(event.data);
        }
      };
      recorder.onerror = () => {
        recorder.onstop = null;
        clearRecordingTimer();
        stream?.getTracks().forEach((track) => track.stop());
        recorderRef.current = null;
        recordingStreamRef.current = null;
        recordingChunksRef.current = [];
        setRecording(false);
        setCaptureError(t("viewer.recording.failed"));
      };
      recorder.onstop = () => {
        clearRecordingTimer();
        stream?.getTracks().forEach((track) => track.stop());
        const recordedMime = recorder.mimeType || selectedMime || "video/webm";
        const blob = new Blob(recordingChunksRef.current, { type: recordedMime });
        recordingChunksRef.current = [];
        recorderRef.current = null;
        recordingStreamRef.current = null;
        setRecording(false);
        if (!blob.size) {
          setCaptureError(t("viewer.recording.failed"));
          return;
        }
        setCaptureError(null);
        openVideoPreview(blob, recordedMime);
      };

      recorder.start(RECORDING_CHUNK_MS);
      recordingStartedAtRef.current = performance.now();
      setRecordedSeconds(0);
      setRecording(true);
      setCaptureError(null);
      recordingTimerRef.current = window.setInterval(() => {
        const elapsed = (performance.now() - recordingStartedAtRef.current) / 1000;
        setRecordedSeconds(Math.floor(elapsed));
      }, 250);
    } catch (error) {
      console.warn("Falha ao iniciar a gravação da cena 3D:", error);
      stream?.getTracks().forEach((track) => track.stop());
      recorderRef.current = null;
      recordingStreamRef.current = null;
      recordingChunksRef.current = [];
      setRecording(false);
      setCaptureError(t("viewer.recording.failed"));
    }
  };

  /** Encerra a gravação; o onstop monta o Blob e abre a prévia. */
  const stopRecording = () => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    try {
      recorder.stop();
    } catch (error) {
      console.warn("Falha ao encerrar a gravação da cena 3D:", error);
      clearRecordingTimer();
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
      recorderRef.current = null;
      recordingStreamRef.current = null;
      recordingChunksRef.current = [];
      setRecording(false);
      setCaptureError(t("viewer.recording.failed"));
    }
  };

  useEffect(() => {
    return () => {
      clearRecordingTimer();
      const recorder = recorderRef.current;
      if (recorder) {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        recorder.onerror = null;
        if (recorder.state !== "inactive") {
          try {
            recorder.stop();
          } catch {
            /* já encerrado */
          }
        }
      }
      recorderRef.current = null;
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
      recordingStreamRef.current = null;
      recordingChunksRef.current = [];
      if (videoUrlRef.current) {
        URL.revokeObjectURL(videoUrlRef.current);
        videoUrlRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    modeRef.current = mode;
    const controls = controlsRef.current;
    if (controls) {
      controls.enabled = mode !== "precise";
      if (mode !== "precise") controls.update();
    }
    if (mode !== "precise") setWarningOpen(false);
    invalidateRef.current();
  }, [mode]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);

    const canvas = renderer.domElement;
    canvasRef.current = canvas;
    canvas.tabIndex = 0;
    canvas.style.outline = "none";

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
    controls.enabled = modeRef.current !== "precise";
    controlsRef.current = controls;
    const homePosition = camera.position.clone();
    const homeTarget = controls.target.clone();

    const weightedOit = new WeightedOIT(renderer, transparencyUniforms);
    const depthPeeling = new DepthPeeling(renderer, transparencyUniforms, 8);
    let depthTarget: THREE.WebGLRenderTarget | null = null;
    let configuredMode: RenderMode | null = null;
    let dirty = true;
    let lastPreciseRender = Number.NEGATIVE_INFINITY;

    const collectMeshes = (): THREE.Mesh[] => {
      const result: THREE.Mesh[] = [];
      meshGroupRef.current?.traverse((object) => {
        if (object instanceof THREE.Mesh) result.push(object);
      });
      return result;
    };

    const collectMaterials = (): THREE.Material[] => {
      const result = new Set<THREE.Material>();
      for (const mesh of collectMeshes()) {
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of materials) result.add(material);
      }
      return [...result];
    };

    const hasVisibleMeshes = (): boolean =>
      meshGroupRef.current?.children.some((child) => child.visible) ?? false;

    const configureMaterials = (activeMode: RenderMode) => {
      if (configuredMode === activeMode) return;
      configuredMode = activeMode;
      transparencyUniforms.mode.value = 0;
      transparencyUniforms.peelHasPrev.value = 0;
      transparencyUniforms.peelPrev.value = null;
      if (activeMode === "fast") {
        for (const material of collectMaterials()) setMaterialFast(material);
      }
    };

    /**
     * Renderiza somente os planos de corte num target de profundidade. O
     * shader de OIT/peeling usa essa textura para descartar a metade da malha
     * que está atrás do corte, mantendo a oclusão dos planos.
     */
    const prepareStaticDepth = () => {
      if (!depthTarget) {
        transparencyUniforms.hasStaticDepth.value = 0;
        transparencyUniforms.staticDepth.value = null;
        return;
      }
      const planeMeshes = Object.values(planeRefs.current).filter(
        (mesh): mesh is THREE.Mesh => !!mesh && mesh.visible,
      );
      if (!planeMeshes.length) {
        transparencyUniforms.hasStaticDepth.value = 0;
        transparencyUniforms.staticDepth.value = null;
        return;
      }

      const volumeMesh = volMeshRef.current;
      const savedVolumeVisible = volumeMesh?.visible ?? false;
      if (volumeMesh) volumeMesh.visible = false;

      const outlines = Object.values(planeOutlineRefs.current).filter(
        (outline): outline is THREE.LineSegments => !!outline,
      );
      const outlineVisibility = outlines.map((outline) => outline.visible);
      for (const outline of outlines) outline.visible = false;

      const colorWrites: Array<[THREE.Material, boolean]> = [];
      for (const mesh of planeMeshes) {
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of materials) {
          colorWrites.push([material, material.colorWrite]);
          material.colorWrite = false;
        }
      }

      const savedAutoClear = renderer.autoClear;
      const savedClearColor = renderer.getClearColor(new THREE.Color());
      const savedClearAlpha = renderer.getClearAlpha();

      renderer.autoClear = false;
      renderer.setRenderTarget(depthTarget);
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, true, false);
      renderer.render(scene, camera);

      for (const [material, colorWrite] of colorWrites) material.colorWrite = colorWrite;
      outlines.forEach((outline, index) => {
        outline.visible = outlineVisibility[index] ?? true;
      });
      if (volumeMesh) volumeMesh.visible = savedVolumeVisible;
      renderer.setClearColor(savedClearColor, savedClearAlpha);
      renderer.autoClear = savedAutoClear;
      renderer.setRenderTarget(null);

      transparencyUniforms.staticDepth.value = depthTarget.depthTexture;
      transparencyUniforms.hasStaticDepth.value = 1;
    };

    const renderFrame = () => {
      const activeMode = modeRef.current;
      configureMaterials(activeMode);

      if (activeMode === "fast" || !hasVisibleMeshes()) {
        meshGroup.visible = true;
        renderer.autoClear = true;
        renderer.setRenderTarget(null);
        renderer.render(scene, camera);
        return;
      }

      // Fundo: volume, planos de corte e contornos, sem as malhas.
      meshGroup.visible = false;
      renderer.autoClear = true;
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);

      // Profundidade dos planos para os shaders de transparência.
      prepareStaticDepth();
      meshGroup.visible = true;

      const volumeMesh = volMeshRef.current;
      const savedVolumeVisible = volumeMesh?.visible ?? false;
      const savedPlanesVisible = planes.visible;
      if (volumeMesh) volumeMesh.visible = false;
      planes.visible = false;

      if (activeMode === "balanced") {
        weightedOit.render(scene, camera, collectMaterials());
      } else {
        depthPeeling.render(scene, camera, collectMaterials());
      }

      planes.visible = savedPlanesVisible;
      if (volumeMesh) volumeMesh.visible = savedVolumeVisible;
      meshGroup.visible = true;
    };

    invalidateRef.current = () => {
      dirty = true;
    };

    const stepView = (deltaAzimuth: number, deltaElevation: number) => {
      const target = controls.target;
      const offset = camera.position.clone().sub(target);
      const distance = Math.max(1e-4, offset.length());
      let azimuth = Math.atan2(offset.x, -offset.y);
      let elevation = Math.asin(THREE.MathUtils.clamp(offset.z / distance, -1, 1));
      azimuth += THREE.MathUtils.degToRad(deltaAzimuth);
      elevation = THREE.MathUtils.clamp(
        elevation + THREE.MathUtils.degToRad(deltaElevation),
        -Math.PI * 0.47,
        Math.PI * 0.47,
      );
      const cosElevation = Math.cos(elevation);
      camera.position.set(
        target.x + distance * cosElevation * Math.sin(azimuth),
        target.y - distance * cosElevation * Math.cos(azimuth),
        target.z + distance * Math.sin(elevation),
      );
      camera.lookAt(target);
      controls.update();
      dirty = true;
    };

    const zoomView = (factor: number) => {
      const offset = camera.position.clone().sub(controls.target);
      const distance = THREE.MathUtils.clamp(offset.length() * factor, 0.05, 12);
      offset.setLength(distance);
      camera.position.copy(controls.target).add(offset);
      camera.lookAt(controls.target);
      controls.update();
      dirty = true;
    };

    const resetView = () => {
      camera.position.copy(homePosition);
      controls.target.copy(homeTarget);
      camera.lookAt(homeTarget);
      controls.update();
      dirty = true;
    };

    viewControlRef.current = { step: stepView, zoom: zoomView, reset: resetView };

    /**
     * Captura a cena 3D. O renderer é criado sem `preserveDrawingBuffer`, então
     * o conteúdo do canvas só é confiável dentro do mesmo task do desenho:
     * forçamos um frame completo (mesmo caminho do loop, incluindo OIT/peeling
     * e a composição final) e lemos o canvas de forma síncrona em seguida.
     * Nada é alterado na cena — só um frame extra é renderizado.
     */
    captureRef.current = (): string | null => {
      try {
        if (renderer.getContext().isContextLost()) return null;
        renderFrame();
        return renderer.domElement.toDataURL("image/png");
      } catch (error) {
        console.warn("Falha ao capturar a cena 3D:", error);
        return null;
      }
    };

    const resize = () => {
      const width = mount.clientWidth;
      const height = mount.clientHeight;
      if (!width || !height) return;
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      weightedOit.setSize();
      depthPeeling.setSize();
      depthTarget?.dispose();
      const size = renderer.getDrawingBufferSize(new THREE.Vector2());
      depthTarget = createStaticDepthTarget(
        Math.max(1, Math.floor(size.x)),
        Math.max(1, Math.floor(size.y)),
      );
      transparencyUniforms.hasStaticDepth.value = 0;
      transparencyUniforms.staticDepth.value = null;
      dirty = true;
    };
    resize();

    let raf = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      controls.update();
      const preciseHeavy = modeRef.current === "precise" && hasVisibleMeshes();
      if (preciseHeavy) {
        // Modo preciso: prioriza imagens estáticas. Só redesenha quando algo
        // muda, com um limite modesto de atualizações por segundo.
        if (dirty && now - lastPreciseRender >= PRECISE_MIN_FRAME_MS) {
          dirty = false;
          lastPreciseRender = now;
          renderFrame();
        }
      } else {
        renderFrame();
        dirty = false;
      }
    };
    raf = requestAnimationFrame(loop);

    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    let dragStart: { x: number; y: number } | null = null;
    const onPointerDown = (event: PointerEvent) => {
      canvas.focus({ preventScroll: true });
      if (modeRef.current !== "precise") return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      dragStart = { x: event.clientX, y: event.clientY };
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!dragStart || modeRef.current !== "precise") return;
      if (Math.hypot(event.clientX - dragStart.x, event.clientY - dragStart.y) > 6) {
        dragStart = null;
        warningRef.current();
      }
    };
    const onPointerUp = () => {
      dragStart = null;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (modeRef.current !== "precise" || document.activeElement !== canvas) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      let handled = true;
      switch (event.key) {
        case "ArrowLeft":
          stepView(-AZIMUTH_STEP, 0);
          break;
        case "ArrowRight":
          stepView(AZIMUTH_STEP, 0);
          break;
        case "ArrowUp":
          stepView(0, ELEVATION_STEP);
          break;
        case "ArrowDown":
          stepView(0, -ELEVATION_STEP);
          break;
        case "+":
        case "=":
          zoomView(1 / ZOOM_FACTOR);
          break;
        case "-":
        case "_":
          zoomView(ZOOM_FACTOR);
          break;
        default:
          handled = false;
      }
      if (handled) event.preventDefault();
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      window.removeEventListener("keydown", onKeyDown);
      controls.dispose();
      weightedOit.dispose();
      depthPeeling.dispose();
      depthTarget?.dispose();
      renderer.dispose();
      if (canvas.parentElement === mount) mount.removeChild(canvas);
      controlsRef.current = null;
      viewControlRef.current = null;
      if (canvasRef.current === canvas) canvasRef.current = null;
      captureRef.current = () => null;
      invalidateRef.current = () => {};
    };
  }, [transparencyUniforms]);

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
    invalidateRef.current();

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
    invalidateRef.current();
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
    invalidateRef.current();
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
    invalidateRef.current();
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
              patchTransparencyMaterial(mm, transparencyUniforms);
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
        const material = new THREE.MeshStandardMaterial({
          color: hasColors ? 0xffffff : new THREE.Color(effectiveColor),
          vertexColors: hasColors,
          metalness: 0.1,
          roughness: 0.45,
          transparent: true,
          opacity: item.opacity ?? 0.95,
          depthWrite: true,
          side: THREE.DoubleSide,
        });
        patchTransparencyMaterial(material, transparencyUniforms);
        object = new THREE.Mesh(geo, material);
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
    invalidateRef.current();
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
          if (!m.vertexColors && !m.map) m.color.set(effectiveColor);
        }
      });
    }
    invalidateRef.current();
  }, [meshes]);

  // ---- centralizar a rotação num modelo solicitado ---------------------
  useEffect(() => {
    if (!centerRequest) return;
    const group = meshGroupRef.current;
    const controls = controlsRef.current;
    if (!group || !controls) return;
    const object = group.getObjectByName(centerRequest.id);
    if (!object) return;
    group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;
    controls.target.copy(box.getCenter(new THREE.Vector3()));
    controls.update();
    invalidateRef.current();
  }, [centerRequest]);

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
    invalidateRef.current();
  }, [volume, meshKey]);

  const modeName = t(`viewer.renderMode.modes.${mode}.name`);
  const controlButton =
    "flex h-7 w-7 items-center justify-center rounded-md border border-white/10 bg-white/5 text-white/85 transition hover:bg-white/15 active:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400";

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      <div ref={mountRef} className="absolute inset-0" />
      <div className="pointer-events-none absolute inset-0 z-10">
        <div className="pointer-events-auto absolute right-2 top-2 flex items-center gap-1.5">
          <button
            type="button"
            aria-label={t("viewer.capture.button")}
            title={t("viewer.capture.button")}
            onClick={handleCapture}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-white/15 bg-black/60 text-white/85 shadow-lg backdrop-blur-md transition hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
          >
            <Camera className="h-3.5 w-3.5 text-sky-300" />
          </button>
          <button
            type="button"
            aria-label={recording ? t("viewer.recording.stop") : t("viewer.recording.start")}
            title={recording ? t("viewer.recording.stop") : t("viewer.recording.start")}
            onClick={recording ? stopRecording : startRecording}
            className={cn(
              "flex h-7 items-center justify-center rounded-md border border-white/15 bg-black/60 text-white/85 shadow-lg backdrop-blur-md transition hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400",
              recording ? "gap-1.5 px-2 text-[10px] font-semibold" : "w-7",
            )}
          >
            {recording ? (
              <Square className="h-3 w-3 fill-red-400 text-red-400" />
            ) : (
              <Video className="h-3.5 w-3.5 text-sky-300" />
            )}
            {recording && <span className="whitespace-nowrap">{t("viewer.recording.stop")}</span>}
          </button>
          <DropdownMenu
            onOpenChange={(open) => {
              if (open) dismissTip();
            }}
          >
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={t("viewer.renderMode.button")}
                title={t("viewer.renderMode.button")}
                className="flex items-center gap-1.5 rounded-md border border-white/15 bg-black/60 px-2 py-1.5 text-[10px] font-medium text-white/85 shadow-lg backdrop-blur-md transition hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
              >
                <Gauge className="h-3.5 w-3.5 text-sky-300" />
                <span className="hidden text-white/55 sm:inline">
                  {t("viewer.renderMode.label")}
                </span>
                <span className="max-w-36 truncate text-white/95">{modeName}</span>
                <ChevronDown className="h-3 w-3 opacity-60" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={6} className="w-[19rem] p-1.5">
              <DropdownMenuLabel className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                {t("viewer.renderMode.title")}
              </DropdownMenuLabel>
              {RENDER_MODE_META.map((meta) => {
                const Icon = meta.icon;
                const active = mode === meta.id;
                return (
                  <DropdownMenuItem
                    key={meta.id}
                    onSelect={() => changeMode(meta.id)}
                    className="flex cursor-pointer items-start gap-2.5 px-2 py-2 focus:bg-white/10"
                  >
                    <Icon
                      className={cn(
                        "mt-0.5 h-4 w-4 shrink-0",
                        active ? "text-sky-300" : "text-white/45",
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold">
                          {t(`viewer.renderMode.modes.${meta.id}.name`)}
                        </span>
                        <span
                          className={cn(
                            "rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
                            meta.badgeClass,
                          )}
                        >
                          {t(`viewer.renderMode.modes.${meta.id}.badge`)}
                        </span>
                        {active && <Check className="ml-auto h-3.5 w-3.5 text-sky-300" />}
                      </span>
                      <span className="mt-0.5 block text-[10.5px] leading-snug text-muted-foreground">
                        {t(`viewer.renderMode.modes.${meta.id}.desc`)}
                      </span>
                    </span>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {recording && (
          <div
            role="status"
            aria-live="polite"
            aria-label={t("viewer.recording.indicator")}
            className="pointer-events-none absolute bottom-2 left-2 z-30 flex items-center gap-2 rounded-full bg-red-600 px-2.5 py-1.5 text-white shadow-lg"
          >
            <span aria-hidden className="relative flex h-2.5 w-2.5 items-center justify-center">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-60" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" />
            </span>
            <span className="text-[9px] font-bold uppercase tracking-wider">
              {t("viewer.recording.indicator")}
            </span>
            <span className="font-mono text-[11px] font-semibold leading-none tabular-nums">
              {formatRecordingDuration(recordedSeconds)}
            </span>
          </div>
        )}

        {captureError && (
          <div className="pointer-events-auto absolute right-2 top-14 z-40 w-[min(19rem,calc(100%-1rem))] rounded-lg border border-destructive/40 bg-zinc-950/95 p-2.5 text-destructive shadow-2xl backdrop-blur-md">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1 text-[11px] leading-relaxed">{captureError}</span>
              <button
                type="button"
                onClick={() => setCaptureError(null)}
                aria-label={t("viewer.common.close")}
                className="rounded p-0.5 text-white/50 transition hover:bg-white/10 hover:text-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}

        {showTip && (
          <div className="pointer-events-auto absolute right-2 top-14 z-20 w-[min(19rem,calc(100%-1rem))] rounded-lg border border-white/15 bg-zinc-950/95 p-3 text-white shadow-2xl backdrop-blur-md">
            <div className="flex items-start gap-2">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold">{t("viewer.renderMode.tipTitle")}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-white/70">
                  {t("viewer.renderMode.tipBody")}
                </p>
                <button
                  type="button"
                  onClick={dismissTip}
                  className="mt-2 rounded-md bg-white/10 px-2 py-1 text-[10px] font-semibold text-white transition hover:bg-white/20"
                >
                  {t("viewer.renderMode.tipDismiss")}
                </button>
              </div>
              <button
                type="button"
                onClick={dismissTip}
                aria-label={t("viewer.renderMode.closeTip")}
                className="rounded p-0.5 text-white/50 transition hover:bg-white/10 hover:text-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}

        {warningOpen && mode === "precise" && (
          <div className="pointer-events-auto absolute left-1/2 top-12 z-30 w-[min(30rem,calc(100%-1rem))] -translate-x-1/2 rounded-lg border border-amber-400/40 bg-zinc-950/95 p-3 text-amber-50 shadow-2xl backdrop-blur-md">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold">{t("viewer.renderMode.dragBlockedTitle")}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-amber-100/80">
                  {t("viewer.renderMode.dragBlocked")}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => changeMode("balanced")}
                    className="rounded-md bg-amber-300 px-2 py-1 text-[10px] font-semibold text-zinc-950 transition hover:bg-amber-200"
                  >
                    {t("viewer.renderMode.switchBalanced")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setWarningOpen(false)}
                    className="rounded-md border border-white/15 px-2 py-1 text-[10px] font-medium text-white/80 transition hover:bg-white/10"
                  >
                    {t("viewer.common.close")}
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setWarningOpen(false)}
                aria-label={t("viewer.common.close")}
                className="rounded p-0.5 text-white/50 transition hover:bg-white/10 hover:text-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}

        {mode === "precise" && (
          <div
            className={cn(
              "pointer-events-auto absolute left-2 z-20 select-none",
              recording ? "bottom-14" : "bottom-2",
            )}
          >
            {controlsCollapsed ? (
              <button
                type="button"
                className={cn(
                  controlButton,
                  "h-8 w-8 rounded-lg bg-black/60 shadow-lg backdrop-blur-md",
                )}
                aria-label={t("viewer.renderMode.showControls")}
                title={t("viewer.renderMode.showControls")}
                onClick={() => setControlsCollapsed(false)}
              >
                <ChevronUp className="h-4 w-4" />
              </button>
            ) : (
              <div className="rounded-xl border border-white/10 bg-black/60 p-1.5 backdrop-blur-md">
                <div className="mb-1 flex items-center justify-between gap-2 pl-1 pr-0.5">
                  <span className="text-[9px] font-semibold uppercase tracking-wide text-white/45">
                    {t("viewer.renderMode.dpadLabel")}
                  </span>
                  <button
                    type="button"
                    className="flex h-5 w-5 items-center justify-center rounded text-white/50 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                    aria-label={t("viewer.renderMode.hideControls")}
                    title={t("viewer.renderMode.hideControls")}
                    onClick={() => setControlsCollapsed(true)}
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="flex items-end gap-1.5">
                  <div className="grid grid-cols-3 grid-rows-3 gap-1">
                    <span />
                    <button
                      type="button"
                      className={controlButton}
                      aria-label={t("viewer.renderMode.rotateUp")}
                      title={t("viewer.renderMode.rotateUp")}
                      onClick={() => viewControlRef.current?.step(0, ELEVATION_STEP)}
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <span />
                    <button
                      type="button"
                      className={controlButton}
                      aria-label={t("viewer.renderMode.rotateLeft")}
                      title={t("viewer.renderMode.rotateLeft")}
                      onClick={() => viewControlRef.current?.step(-AZIMUTH_STEP, 0)}
                    >
                      <ArrowLeft className="h-3.5 w-3.5" />
                    </button>
                    <span aria-hidden className="flex items-center justify-center">
                      <span className="h-1 w-1 rounded-full bg-white/30" />
                    </span>
                    <button
                      type="button"
                      className={controlButton}
                      aria-label={t("viewer.renderMode.rotateRight")}
                      title={t("viewer.renderMode.rotateRight")}
                      onClick={() => viewControlRef.current?.step(AZIMUTH_STEP, 0)}
                    >
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                    <span />
                    <button
                      type="button"
                      className={controlButton}
                      aria-label={t("viewer.renderMode.rotateDown")}
                      title={t("viewer.renderMode.rotateDown")}
                      onClick={() => viewControlRef.current?.step(0, -ELEVATION_STEP)}
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                    <span />
                  </div>
                  <div className="flex flex-col gap-1">
                    <button
                      type="button"
                      className={controlButton}
                      aria-label={t("viewer.renderMode.zoomIn")}
                      title={t("viewer.renderMode.zoomIn")}
                      onClick={() => viewControlRef.current?.zoom(1 / ZOOM_FACTOR)}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      className={controlButton}
                      aria-label={t("viewer.renderMode.zoomOut")}
                      title={t("viewer.renderMode.zoomOut")}
                      onClick={() => viewControlRef.current?.zoom(ZOOM_FACTOR)}
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      className={controlButton}
                      aria-label={t("viewer.renderMode.reset")}
                      title={t("viewer.renderMode.reset")}
                      onClick={() => viewControlRef.current?.reset()}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <p className="mt-1 max-w-[9.5rem] text-center text-[9px] leading-tight text-white/45">
                  {t("viewer.renderMode.stepHint")}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      <CapturePreviewDialog
        open={captureOpen}
        onOpenChange={setCaptureOpen}
        imageUrl={captureUrl}
        fileNamePrefix="openvd-3d"
        title={t("viewer.capture.previewTitle")}
        description={t("viewer.capture.previewDesc")}
        labels={{
          copy: t("viewer.capture.copy"),
          copied: t("viewer.capture.copied"),
          copyUnsupported: t("viewer.capture.copyUnsupported"),
          copyFailed: t("viewer.capture.copyFailed"),
          download: t("viewer.capture.download"),
        }}
      />

      <VideoPreviewDialog
        open={videoOpen}
        onOpenChange={handleVideoOpenChange}
        videoUrl={videoUrl}
        fileNamePattern={recordingNamePattern}
        fileExtension={recordingFileExtension(videoMime)}
        title={t("viewer.recording.previewTitle")}
        description={t("viewer.recording.previewDesc")}
        downloadLabel={t("viewer.recording.download")}
        closeLabel={t("viewer.common.close")}
      />
    </div>
  );
}

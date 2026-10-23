/**
 * Harness temporario de medicao: compara a navegacao do MPR na versao atual
 * (com captura) contra a versao anterior (HEAD, sem captura).
 * Nao faz parte do app; usado apenas para diagnostico local.
 */
import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import "@/styles.css";
import { initI18n } from "@/i18n";
import { SliceView } from "@/components/SliceView";
import { SliceView as SliceViewBaseline } from "@/components/SliceViewBaseline";
import type { Plane, Volume } from "@/lib/dicom";
import { defaultPlaneStates, type PlaneState } from "@/lib/mpr";

initI18n();

const NX = 512;
const NY = 512;
const NZ = 160;
const volume: Volume = (() => {
  const data = new Int16Array(NX * NY * NZ);
  let i = 0;
  for (let z = 0; z < NZ; z++) {
    for (let y = 0; y < NY; y++) {
      for (let x = 0; x < NX; x++) {
        data[i++] = ((((x * 3 + y * 5 + z * 7) & 1023) - 512) * 2) | 0;
      }
    }
  }
  return {
    nx: NX,
    ny: NY,
    nz: NZ,
    sx: 0.7,
    sy: 0.7,
    sz: 1,
    data,
    min: -1024,
    max: 1022,
    windowCenter: 0,
    windowWidth: 2046,
    patientName: "Perf",
    studyDescription: "Perf",
    modality: "CT",
    origin: [0, 0, 0],
    rowDir: [1, 0, 0],
    colDir: [0, 1, 0],
    sliceDir: [0, 0, 1],
  };
})();

const variant =
  new URLSearchParams(window.location.search).get("variant") === "baseline"
    ? "baseline"
    : "current";
const Slice = variant === "baseline" ? SliceViewBaseline : SliceView;

const ACCENTS: Record<Plane, string> = {
  axial: "#38bdf8",
  coronal: "#c084fc",
  sagittal: "#34d399",
};

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

let lastPut = 0;
const originalPut = CanvasRenderingContext2D.prototype.putImageData;
CanvasRenderingContext2D.prototype.putImageData = function (
  imageData: ImageData,
  dx: number,
  dy: number,
  dirtyX?: number,
  dirtyY?: number,
  dirtyWidth?: number,
  dirtyHeight?: number,
) {
  if (this.canvas.closest?.('[data-perf="axial"]')) lastPut = performance.now();
  return originalPut.call(
    this,
    imageData,
    dx,
    dy,
    dirtyX ?? 0,
    dirtyY ?? 0,
    dirtyWidth ?? imageData.width,
    dirtyHeight ?? imageData.height,
  );
};

function stats(values: number[]) {
  const s = [...values].sort((a, b) => a - b);
  const q = (p: number) =>
    s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))] ?? 0;
  return {
    n: s.length,
    median: Number(q(0.5).toFixed(2)),
    mean: Number((s.reduce((a, b) => a + b, 0) / Math.max(1, s.length)).toFixed(2)),
    p95: Number(q(0.95).toFixed(2)),
    max: Number((s[s.length - 1] ?? 0).toFixed(2)),
  };
}

async function waitForCanvas(): Promise<HTMLCanvasElement> {
  for (let i = 0; i < 200; i++) {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-perf="axial"] canvas');
    if (canvas && canvas.width > 1 && canvas.height > 1) return canvas;
    await delay(50);
  }
  throw new Error("canvas nao ficou pronto");
}

async function step(canvas: HTMLCanvasElement, deltaY: number): Promise<number> {
  await nextFrame();
  lastPut = 0;
  const t0 = performance.now();
  canvas.dispatchEvent(new WheelEvent("wheel", { deltaY, bubbles: true, cancelable: true }));
  const deadline = t0 + 3000;
  while (lastPut === 0) {
    if (performance.now() > deadline) throw new Error("putImageData nao ocorreu");
    await nextFrame();
  }
  return lastPut - t0;
}

// eslint-disable-next-line react-refresh/only-export-components -- harness local de performance
function App() {
  const [states, setStates] = useState<Record<Plane, PlaneState>>(() => defaultPlaneStates(volume));
  const [wc, setWc] = useState(volume.windowCenter);
  const [ww, setWw] = useState(volume.windowWidth);

  const onStates = useCallback(
    (update: (s: Record<Plane, PlaneState>) => Record<Plane, PlaneState>) => setStates(update),
    [],
  );
  const onWindow = useCallback((a: number, b: number) => {
    setWc(a);
    setWw(b);
  }, []);
  const noop = useCallback(() => {}, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const canvas = await waitForCanvas();
        await delay(800);

        for (let i = 0; i < 15; i++) {
          await step(canvas, i % 2 === 0 ? 1 : -1);
        }
        await delay(250);

        const samples: number[] = [];
        const frameDeltas: number[] = [];
        const longTasks: number[] = [];

        let observer: PerformanceObserver | null = null;
        try {
          observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) longTasks.push(entry.duration);
          });
          observer.observe({ type: "longtask" });
        } catch {
          observer = null;
        }

        let running = true;
        let lastFrame = performance.now();
        const frameLoop = (t: number) => {
          frameDeltas.push(t - lastFrame);
          lastFrame = t;
          if (running) requestAnimationFrame(frameLoop);
        };
        requestAnimationFrame(frameLoop);

        for (let i = 0; i < 80; i++) {
          samples.push(await step(canvas, i % 2 === 0 ? 1 : -1));
          if (i % 10 === 9) await delay(30);
        }

        running = false;
        observer?.disconnect();

        if (cancelled) return;
        const results = {
          variant,
          canvas: `${canvas.width}x${canvas.height}`,
          volume: `${NX}x${NY}x${NZ}`,
          latencyMs: stats(samples),
          frameMs: stats(frameDeltas.slice(5)),
          longTasks: {
            count: longTasks.length,
            max: Number(Math.max(0, ...longTasks).toFixed(2)),
            total: Number(longTasks.reduce((a, b) => a + b, 0).toFixed(2)),
          },
        };
        (window as Window & { __perfResults?: unknown }).__perfResults = results;
        const el = document.getElementById("stats");
        if (el) el.textContent = JSON.stringify(results, null, 2);
        document.title = "PERF_DONE";
      } catch (error) {
        (window as Window & { __perfResults?: unknown }).__perfResults = {
          variant,
          error: String(error),
        };
        document.title = "PERF_ERROR";
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const common = {
    volume,
    wc,
    ww,
    onWindow,
    invert: false,
    states,
    onStates,
    accents: ACCENTS,
    onResetPlane: noop,
    annotations: [] as never[],
    annotating: false,
    tool: "select" as const,
    annActive: null,
    onCreateAnnotation: noop,
    showLines: true,
    onToggleLines: noop,
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gridTemplateRows: "1fr 1fr",
        gap: 4,
        height: "100vh",
        width: "100vw",
        padding: 4,
        boxSizing: "border-box",
        background: "#09090b",
        overflow: "hidden",
      }}
    >
      <div data-perf="axial" style={{ minWidth: 0, minHeight: 0, display: "flex" }}>
        <Slice {...common} plane="axial" label="Axial" accent="var(--axial)" />
      </div>
      <div data-perf="coronal" style={{ minWidth: 0, minHeight: 0, display: "flex" }}>
        <Slice {...common} plane="coronal" label="Coronal" accent="var(--coronal)" />
      </div>
      <div data-perf="sagittal" style={{ minWidth: 0, minHeight: 0, display: "flex" }}>
        <Slice {...common} plane="sagittal" label="Sagital" accent="var(--sagittal)" />
      </div>
      <div
        id="stats"
        style={{
          padding: 12,
          color: "#7dd3fc",
          fontFamily: "monospace",
          fontSize: 12,
          whiteSpace: "pre-wrap",
          overflow: "auto",
          background: "#111",
        }}
      >
        medindo ({variant})...
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { chooseRecordingMimeType } from "@/lib/videoCapture";

/** Erros possíveis ao iniciar/gravar o painel. A tradução fica no componente. */
export type PanelRecordingError = "unsupported" | "failed" | "microphone";

/** Opções de início; sem `audio`, o comportamento é o mesmo de antes. */
export type PanelRecordingStartOptions = {
  audio?: boolean;
};

const RECORDING_FPS = 30;
const RECORDING_BITRATE = 8_000_000;
const RECORDING_AUDIO_BITRATE = 128_000;
const RECORDING_CHUNK_MS = 250;
/** Revalida o overlay vetorial (linhas de referência/anotações) sem serializar a cada frame. */
const OVERLAY_REFRESH_MS = 200;
const MAX_OUTPUT_WIDTH = 1920;
const MAX_OUTPUT_HEIGHT = 1920;
/** Viewports marcados pelo ViewportGrid (axiais, coronais, sagitais e 3D). */
const VIEWPORT_SELECTOR = "[data-recording-viewport]";

type OverlayEntry = {
  image: HTMLImageElement | null;
  loading: boolean;
  lastRequest: number;
};

interface PanelRecorder {
  recording: boolean;
  seconds: number;
  error: PanelRecordingError | null;
  previewOpen: boolean;
  videoUrl: string | null;
  videoMime: string;
  start: (options?: PanelRecordingStartOptions) => Promise<void>;
  stop: () => void;
  clearError: () => void;
  setPreviewOpen: (open: boolean) => void;
}

/** Dimensões pares (exigidas por alguns codecs) limitadas a uma saída Full HD. */
function outputSize(width: number, height: number): { width: number; height: number } {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  let outWidth = Math.max(2, Math.round(width * dpr));
  let outHeight = Math.max(2, Math.round(height * dpr));
  const fit = Math.min(1, MAX_OUTPUT_WIDTH / outWidth, MAX_OUTPUT_HEIGHT / outHeight);
  outWidth = Math.max(2, Math.round((outWidth * fit) / 2) * 2);
  outHeight = Math.max(2, Math.round((outHeight * fit) / 2) * 2);
  return { width: outWidth, height: outHeight };
}

/**
 * Serializa o SVG do SliceView em um Blob. O SVG usa atributos de
 * apresentação (fill/stroke), então o documento isolado mantém o desenho.
 */
function svgToBlob(svg: SVGSVGElement): Blob {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const width = Math.max(1, Math.round(svg.clientWidth || svg.viewBox.baseVal.width || 1));
  const height = Math.max(1, Math.round(svg.clientHeight || svg.viewBox.baseVal.height || 1));
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  const markup = new XMLSerializer().serializeToString(clone);
  return new Blob([markup], { type: "image/svg+xml;charset=utf-8" });
}

/**
 * Grava o painel de visualização inteiro (as quatro janelas, ou a janela
 * expandida) compondo os canvases dos viewports em um canvas 2D próprio.
 * A interface não entra no vídeo, apenas o conteúdo clínico.
 */
export function usePanelRecorder(
  containerRef: RefObject<HTMLElement | null>,
  render3dRef?: RefObject<(() => void) | null>,
): PanelRecorder {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<PanelRecordingError | null>(null);
  const [previewOpen, setPreviewOpenState] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoMime, setVideoMime] = useState("video/webm");

  const recorderRef = useRef<MediaRecorder | null>(null);
  const startingRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const rafRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const videoUrlRef = useRef<string | null>(null);
  const overlayCacheRef = useRef<Map<SVGSVGElement, OverlayEntry>>(new Map());

  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const cancelFrame = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
  }, []);

  const releaseVideoUrl = useCallback(() => {
    if (videoUrlRef.current) {
      URL.revokeObjectURL(videoUrlRef.current);
      videoUrlRef.current = null;
    }
    setVideoUrl(null);
  }, []);

  const setPreviewOpen = useCallback(
    (open: boolean) => {
      setPreviewOpenState(open);
      if (!open) releaseVideoUrl();
    },
    [releaseVideoUrl],
  );

  const start = useCallback(
    async (startOptions?: PanelRecordingStartOptions) => {
      if (recorderRef.current || startingRef.current) return;
      const container = containerRef.current;
      if (!container) {
        setError("failed");
        return;
      }

      const canCapture =
        typeof HTMLCanvasElement !== "undefined" &&
        typeof HTMLCanvasElement.prototype.captureStream === "function";
      if (!canCapture || typeof MediaRecorder === "undefined") {
        setError("unsupported");
        return;
      }

      const rect = container.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) {
        setError("failed");
        return;
      }

      const size = outputSize(rect.width, rect.height);
      const output = document.createElement("canvas");
      output.width = size.width;
      output.height = size.height;
      const ctx = output.getContext("2d", { alpha: false });
      if (!ctx) {
        setError("failed");
        return;
      }

      const overlays = overlayCacheRef.current;
      overlays.clear();

      const drawOverlay = (svg: SVGSVGElement, now: number): void => {
        let entry = overlays.get(svg);
        if (!entry) {
          entry = { image: null, loading: false, lastRequest: 0 };
          overlays.set(svg, entry);
        }
        if (!entry.loading && now - entry.lastRequest >= OVERLAY_REFRESH_MS) {
          entry.loading = true;
          entry.lastRequest = now;
          try {
            const url = URL.createObjectURL(svgToBlob(svg));
            const current = entry;
            const image = new Image();
            image.onload = () => {
              current.image = image;
              current.loading = false;
              URL.revokeObjectURL(url);
            };
            image.onerror = () => {
              current.loading = false;
              URL.revokeObjectURL(url);
            };
            image.src = url;
          } catch (overlayError) {
            entry.loading = false;
            console.warn("Falha ao preparar o overlay da gravação:", overlayError);
          }
        }
        if (entry.image) {
          const svgRect = svg.getBoundingClientRect();
          if (svgRect.width >= 1 && svgRect.height >= 1) {
            ctx.drawImage(entry.image, svgRect.left, svgRect.top, svgRect.width, svgRect.height);
          }
        }
      };

      const drawFrame = (now: number): void => {
        const live = containerRef.current;
        if (!live || !live.isConnected) return;
        const liveWidth = live.clientWidth;
        const liveHeight = live.clientHeight;
        if (liveWidth < 2 || liveHeight < 2) return;

        // Garante que o canvas WebGL tenha um frame válido no mesmo task antes
        // de ser lido; sem isso o buffer pode ter sido limpo pela composição.
        render3dRef?.current?.();

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = "#05070a";
        ctx.fillRect(0, 0, size.width, size.height);

        // Mantém a proporção do painel dentro da resolução escolhida no início.
        const fit = Math.min(size.width / liveWidth, size.height / liveHeight);
        const offsetX = (size.width - liveWidth * fit) / 2;
        const offsetY = (size.height - liveHeight * fit) / 2;
        const liveRect = live.getBoundingClientRect();

        // Converte coordenadas do documento para o canvas: o retângulo do painel
        // vira a origem e o conteúdo é escalado uma única vez.
        ctx.setTransform(
          fit,
          0,
          0,
          fit,
          offsetX - liveRect.left * fit,
          offsetY - liveRect.top * fit,
        );

        const frames = live.querySelectorAll<HTMLElement>(VIEWPORT_SELECTOR);
        for (const frame of frames) {
          const frameRect = frame.getBoundingClientRect();
          if (frameRect.width < 2 || frameRect.height < 2) continue;

          ctx.fillStyle = "#080b10";
          ctx.fillRect(frameRect.left, frameRect.top, frameRect.width, frameRect.height);

          const header = frame.querySelector<HTMLElement>(".viewport-header");
          const headerHeight = Math.min(
            frameRect.height * 0.4,
            header?.getBoundingClientRect().height ?? 24,
          );
          ctx.fillStyle = "#0b1016";
          ctx.fillRect(frameRect.left, frameRect.top, frameRect.width, headerHeight);

          const label = frame.querySelector<HTMLElement>(".plane-label");
          const text = label?.textContent?.trim();
          if (label && text) {
            ctx.fillStyle = getComputedStyle(label).color;
            ctx.font = '600 10px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
            ctx.textBaseline = "middle";
            ctx.fillText(text, frameRect.left + 7, frameRect.top + headerHeight / 2 + 0.5);
          }

          ctx.fillStyle = "rgba(255,255,255,0.08)";
          ctx.fillRect(frameRect.left, frameRect.top + headerHeight, frameRect.width, 1);

          ctx.save();
          ctx.beginPath();
          ctx.rect(
            frameRect.left,
            frameRect.top + headerHeight,
            frameRect.width,
            Math.max(0, frameRect.height - headerHeight),
          );
          ctx.clip();

          // Os canvases já refletem pan/zoom e a imagem nativa de cada corte.
          const canvases = frame.querySelectorAll<HTMLCanvasElement>("canvas");
          for (const canvas of canvases) {
            if (!canvas.width || !canvas.height) continue;
            const canvasRect = canvas.getBoundingClientRect();
            if (canvasRect.width < 1 || canvasRect.height < 1) continue;
            try {
              ctx.drawImage(
                canvas,
                canvasRect.left,
                canvasRect.top,
                canvasRect.width,
                canvasRect.height,
              );
            } catch {
              /* canvas WebGL ainda sem frame válido */
            }
          }

          const overlay = frame.querySelector<SVGSVGElement>("[data-recording-overlay]");
          if (overlay) drawOverlay(overlay, now);

          ctx.restore();

          ctx.strokeStyle = "rgba(148,163,184,0.16)";
          ctx.lineWidth = 1;
          ctx.strokeRect(
            frameRect.left + 0.5,
            frameRect.top + 0.5,
            frameRect.width - 1,
            frameRect.height - 1,
          );
        }
      };

      let stream: MediaStream | null = null;
      let microphoneStream: MediaStream | null = null;
      let recorder: MediaRecorder | null = null;
      let selectedMime: string | null = null;

      startingRef.current = true;
      try {
        if (startOptions?.audio) {
          if (!navigator.mediaDevices?.getUserMedia) {
            setError("microphone");
            return;
          }
          try {
            // Chamado diretamente no clique do diálogo para preservar o gesto do
            // usuário exigido pelos navegadores ao pedir permissão de microfone.
            microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          } catch (microphoneError) {
            console.warn("Falha ao acessar o microfone:", microphoneError);
            setError("microphone");
            return;
          }

          // O componente pode ter sido desmontado enquanto a permissão era exibida.
          if (!containerRef.current) {
            microphoneStream.getTracks().forEach((track) => track.stop());
            microphoneStream = null;
            return;
          }

          if (!microphoneStream.getAudioTracks().length) {
            microphoneStream.getTracks().forEach((track) => track.stop());
            microphoneStream = null;
            setError("microphone");
            return;
          }
        }

        selectedMime = chooseRecordingMimeType(Boolean(microphoneStream));
        drawFrame(performance.now());
        stream = output.captureStream(RECORDING_FPS);
        if (microphoneStream) {
          for (const track of microphoneStream.getAudioTracks()) stream.addTrack(track);
        }

        const options: MediaRecorderOptions = { videoBitsPerSecond: RECORDING_BITRATE };
        if (microphoneStream) options.audioBitsPerSecond = RECORDING_AUDIO_BITRATE;
        if (selectedMime) options.mimeType = selectedMime;
        try {
          recorder = new MediaRecorder(stream, options);
        } catch {
          recorder = new MediaRecorder(stream);
        }

        const activeRecorder = recorder;
        chunksRef.current = [];
        recorderRef.current = activeRecorder;
        streamRef.current = stream;

        activeRecorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
        };
        activeRecorder.onerror = () => {
          activeRecorder.onstop = null;
          setRecording(false);
          stopTimer();
          cancelFrame();
          stream?.getTracks().forEach((track) => track.stop());
          microphoneStream?.getTracks().forEach((track) => track.stop());
          recorderRef.current = null;
          streamRef.current = null;
          chunksRef.current = [];
          overlays.clear();
          setError("failed");
        };
        activeRecorder.onstop = () => {
          setRecording(false);
          stopTimer();
          cancelFrame();
          stream?.getTracks().forEach((track) => track.stop());
          microphoneStream?.getTracks().forEach((track) => track.stop());
          recorderRef.current = null;
          streamRef.current = null;
          overlays.clear();

          const recordedMime = activeRecorder.mimeType || selectedMime || "video/webm";
          const blob = new Blob(chunksRef.current, { type: recordedMime });
          chunksRef.current = [];
          if (!blob.size) {
            setError("failed");
            return;
          }

          releaseVideoUrl();
          const url = URL.createObjectURL(blob);
          videoUrlRef.current = url;
          setVideoMime(recordedMime);
          setVideoUrl(url);
          setPreviewOpenState(true);
        };

        activeRecorder.start(RECORDING_CHUNK_MS);
        startedAtRef.current = performance.now();
        setSeconds(0);
        setRecording(true);
        setError(null);
        setPreviewOpenState(false);
        releaseVideoUrl();

        let lastDrawAt = Number.NEGATIVE_INFINITY;
        const loop = (now: number) => {
          if (now - lastDrawAt >= 1000 / RECORDING_FPS - 1) {
            lastDrawAt = now;
            try {
              drawFrame(now);
            } catch (drawError) {
              console.warn("Falha ao compor um frame da gravação do painel:", drawError);
            }
          }
          rafRef.current = requestAnimationFrame(loop);
        };
        rafRef.current = requestAnimationFrame(loop);

        timerRef.current = window.setInterval(() => {
          const elapsed = (performance.now() - startedAtRef.current) / 1000;
          setSeconds(Math.floor(elapsed));
        }, 250);
      } catch (captureError) {
        console.warn("Falha ao iniciar a gravação do painel:", captureError);
        stopTimer();
        cancelFrame();
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
        stream?.getTracks().forEach((track) => track.stop());
        microphoneStream?.getTracks().forEach((track) => track.stop());
        recorderRef.current = null;
        streamRef.current = null;
        chunksRef.current = [];
        overlays.clear();
        setRecording(false);
        setError("failed");
      } finally {
        startingRef.current = false;
      }
    },
    [cancelFrame, containerRef, releaseVideoUrl, render3dRef, stopTimer],
  );

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    try {
      recorder.stop();
    } catch (stopError) {
      console.warn("Falha ao encerrar a gravação do painel:", stopError);
      stopTimer();
      cancelFrame();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      recorderRef.current = null;
      streamRef.current = null;
      chunksRef.current = [];
      overlayCacheRef.current.clear();
      setRecording(false);
      setError("failed");
    }
  }, [cancelFrame, stopTimer]);

  const clearError = useCallback(() => setError(null), []);

  useEffect(() => {
    const overlays = overlayCacheRef.current;
    return () => {
      stopTimer();
      cancelFrame();
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
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      chunksRef.current = [];
      overlays.clear();
      if (videoUrlRef.current) {
        URL.revokeObjectURL(videoUrlRef.current);
        videoUrlRef.current = null;
      }
    };
  }, [cancelFrame, stopTimer]);

  return {
    recording,
    seconds,
    error,
    previewOpen,
    videoUrl,
    videoMime,
    start,
    stop,
    clearError,
    setPreviewOpen,
  };
}

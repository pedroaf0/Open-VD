/** Utilitários compartilhados de gravação do viewport 3D. */

/** Padrão usado quando o admin não definiu um nome para o vídeo. */
export const DEFAULT_RECORDING_NAME_PATTERN = "openvd-3d-recording-{timestamp}";

/**
 * Codecs em ordem de preferência: MP4/H.264 primeiro (mais compatível com
 * players e editores) e WebM/VP9/VP8 como fallback para navegadores que não
 * gravam MP4, como o Firefox.
 */
const RECORDING_MIME_CANDIDATES = [
  "video/mp4;codecs=avc1.42E01E",
  "video/mp4;codecs=avc1",
  "video/mp4",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
] as const;

/** Escolhe o primeiro MIME suportado pelo MediaRecorder (ou null se nenhum). */
export function chooseRecordingMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const mime of RECORDING_MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(mime)) return mime;
    } catch {
      /* isTypeSupported pode lançar em implementações antigas */
    }
  }
  return null;
}

/** Extensão de arquivo correspondente ao MIME gravado. */
export function recordingFileExtension(mime: string): "webm" | "mp4" {
  return /mp4/i.test(mime) ? "mp4" : "webm";
}

/** Formata segundos como MM:SS (ou H:MM:SS depois de uma hora). */
export function formatRecordingDuration(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Remove caracteres inválidos sem perder acentos nem os marcadores {data}/{hora}. */
function sanitizeRecordingName(value: string): string {
  return value
    .replace(/[^\p{L}\p{N}\p{M} _{}().-]+/gu, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^[.\s_-]+|[.\s_-]+$/g, "")
    .slice(0, 120);
}

/**
 * Monta o nome final do vídeo a partir do padrão definido no WP Admin.
 *
 * Marcadores aceitos: {data} (AAAAMMDD), {hora} (HHMMSS) e {timestamp}
 * (AAAAMMDD-HHMMSS). Se o padrão não incluir data e hora, o carimbo é
 * acrescentado automaticamente para evitar nomes repetidos.
 */
export function recordingFileName(
  pattern: string | null | undefined,
  fileExtension: "webm" | "mp4",
  date = new Date(),
): string {
  const raw = (pattern ?? "").trim() || DEFAULT_RECORDING_NAME_PATTERN;
  const template = raw.replace(/\.(?:mp4|webm)\s*$/i, "").trim() || DEFAULT_RECORDING_NAME_PATTERN;
  const datePart = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const timePart = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  const timestamp = `${datePart}-${timePart}`;

  const hasTimestamp = /\{timestamp\}/i.test(template);
  const hasDate = /\{data\}/i.test(template);
  const hasTime = /\{hora\}/i.test(template);

  let name = template
    .replace(/\{timestamp\}/gi, timestamp)
    .replace(/\{data\}/gi, datePart)
    .replace(/\{hora\}/gi, timePart);

  // Garante um carimbo completo mesmo quando o admin usa só um dos marcadores.
  if (!hasTimestamp) {
    if (!hasDate && !hasTime) name = `${name}-${timestamp}`;
    else if (!hasTime) name = `${name}-${timePart}`;
    else if (!hasDate) name = `${name}-${datePart}`;
  }

  name = sanitizeRecordingName(name);
  if (!name) {
    name = DEFAULT_RECORDING_NAME_PATTERN.replace("{timestamp}", timestamp);
  }
  return `${name}.${fileExtension}`;
}

/** Baixa uma URL (data ou blob) como arquivo com o nome informado. */
export function downloadUrlAsFile(url: string, fileName: string): void {
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/** Utilitários compartilhados de captura de imagem (3D e MPR). */

export type CopyImageResult = "copied" | "unsupported" | "error";

/** Converte um data URL de imagem em Blob. */
export function dataUrlToBlob(dataUrl: string): Blob | null {
  const match = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(dataUrl);
  if (!match) return null;
  let raw: string;
  try {
    raw = match[2] ? atob(match[3] ?? "") : decodeURIComponent(match[3] ?? "");
  } catch {
    return null;
  }
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return new Blob([bytes as unknown as BlobPart], { type: match[1] || "image/png" });
}

/** Data/hora local para nome de arquivo: AAAAMMDD-HHMMSS. */
export function captureTimestamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(
    date.getHours(),
  )}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/**
 * Copia uma imagem (data URL) para a área de transferência.
 * Retorna "unsupported" quando o navegador ou o contexto não permite.
 */
export async function copyImageToClipboard(dataUrl: string): Promise<CopyImageResult> {
  if (typeof window === "undefined") return "unsupported";
  if (
    !window.isSecureContext ||
    typeof ClipboardItem === "undefined" ||
    !navigator.clipboard?.write
  ) {
    return "unsupported";
  }
  const blob = dataUrlToBlob(dataUrl);
  if (!blob) return "error";
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return "copied";
  } catch {
    return "error";
  }
}

/** Baixa um data URL como PNG com o nome informado. */
export function downloadPngDataUrl(dataUrl: string, fileName: string): void {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

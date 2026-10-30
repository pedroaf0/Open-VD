/** Utilitários de compartilhamento nativo (Web Share API com arquivos). */

/** `true` quando o navegador expõe a Web Share API com arquivos. */
export function canUseFileShare(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    typeof navigator.canShare === "function"
  );
}

/**
 * Empacota um Blob em `File` e devolve `null` quando o navegador não aceita
 * compartilhar esse arquivo (API indisponível ou tipo recusado).
 *
 * A validação precisa acontecer com um `File` concreto: `canShare` depende das
 * propriedades do arquivo, não só da presença da API.
 */
export function shareableFile(
  blob: Blob,
  fileName: string,
  type?: string | undefined,
): File | null {
  if (!canUseFileShare()) return null;
  try {
    const file = new File([blob], fileName, { type: type || blob.type });
    return navigator.canShare({ files: [file] }) ? file : null;
  } catch {
    return null;
  }
}

export type ShareFileResult = "shared" | "cancelled" | "error";

/** Abre a folha de compartilhamento do sistema; cancelar não é falha. */
export async function shareFile(file: File, title?: string): Promise<ShareFileResult> {
  if (!canUseFileShare()) return "error";
  try {
    await navigator.share(title ? { files: [file], title } : { files: [file] });
    return "shared";
  } catch (error) {
    const reason =
      typeof error === "object" && error !== null ? (error as { name?: unknown }) : null;
    return reason?.name === "AbortError" ? "cancelled" : "error";
  }
}

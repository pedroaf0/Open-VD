import { useEffect, useState } from "react";
import { Download, Share2, Gem } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { shareFile, shareableFile } from "@/lib/share";
import { downloadUrlAsFile, recordingFileName } from "@/lib/videoCapture";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  videoUrl: string | null;
  /** Padrão definido no admin; tokens de data/hora são resolvidos no download. */
  fileNamePattern?: string | undefined;
  fileExtension: "webm" | "mp4";
  title: string;
  description?: string;
  downloadLabel: string;
  shareLabel: string;
  shareFailedLabel: string;
  closeLabel: string;
  /** URL de assinatura (template com {{callback}}) — se definida e usuário não for assinante. */
  subscriptionUrl?: string | undefined;
  /** Se o usuário atual é assinante (true) ou não (false). */
  isSubscriber?: boolean | undefined;
  /** Rótulo do botão "Remover marca d'água". */
  removeWatermarkLabel?: string | undefined;
};

const SHARE_MIME: Record<"webm" | "mp4", string> = {
  mp4: "video/mp4",
  webm: "video/webm",
};

/**
 * Modal de prévia, download e compartilhamento dos vídeos gravados no painel
 * de visualização.
 */
export function VideoPreviewDialog({
  open,
  onOpenChange,
  videoUrl,
  fileNamePattern,
  fileExtension,
  title,
  description,
  downloadLabel,
  shareLabel,
  shareFailedLabel,
  closeLabel,
  subscriptionUrl,
  isSubscriber,
  removeWatermarkLabel,
}: Props) {
  const [shareTarget, setShareTarget] = useState<File | null>(null);
  const [shareFailed, setShareFailed] = useState(false);

  const showWatermarkButton = subscriptionUrl && !isSubscriber;

  // A Web Share API com arquivos só pode ser validada com um File concreto,
  // então o vídeo é empacotado quando o modal abre. Sem suporte, o botão some.
  useEffect(() => {
    setShareTarget(null);
    setShareFailed(false);
    if (!open || !videoUrl) return;
    if (typeof navigator === "undefined") return;

    let cancelled = false;
    const prepareShareFile = async () => {
      try {
        const blob = await (await fetch(videoUrl)).blob();
        if (cancelled) return;
        setShareTarget(
          shareableFile(
            blob,
            recordingFileName(fileNamePattern, fileExtension),
            SHARE_MIME[fileExtension],
          ),
        );
      } catch {
        if (!cancelled) setShareTarget(null);
      }
    };
    void prepareShareFile();
    return () => {
      cancelled = true;
    };
  }, [open, videoUrl, fileNamePattern, fileExtension]);

  const handleDownload = () => {
    if (!videoUrl) return;
    downloadUrlAsFile(videoUrl, recordingFileName(fileNamePattern, fileExtension));
  };

  const handleShare = async () => {
    if (!shareTarget) return;
    setShareFailed(false);
    setShareFailed((await shareFile(shareTarget, title)) === "error");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {videoUrl && (
          <video
            key={videoUrl}
            src={videoUrl}
            controls
            playsInline
            preload="metadata"
            aria-label={title}
            className="mx-auto max-h-[60vh] w-full rounded-md border border-white/10 bg-black"
          />
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-primary gap-1.5 text-xs" onClick={handleDownload}>
            <Download className="h-3.5 w-3.5" />
            {downloadLabel}
          </button>
          {shareTarget && (
            <button
              type="button"
              className="btn-chip gap-1.5 text-xs"
              onClick={() => void handleShare()}
            >
              <Share2 className="h-3.5 w-3.5" />
              {shareLabel}
            </button>
          )}
          {showWatermarkButton && (
            <a
              className="btn-chip gap-1.5 text-xs text-primary hover:text-primary-foreground"
              href={subscriptionUrl}
              target="_blank"
              rel="noreferrer"
              title={removeWatermarkLabel}
            >
              <Gem className="h-3.5 w-3.5" />
              {removeWatermarkLabel}
            </a>
          )}
          <button
            type="button"
            className="btn-chip gap-1.5 text-xs"
            onClick={() => onOpenChange(false)}
          >
            {closeLabel}
          </button>
          {shareFailed && (
            <span className="text-[11px] text-destructive" role="alert">
              {shareFailedLabel}
            </span>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useState } from "react";
import { Copy, Download, Share2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  captureTimestamp,
  copyImageToClipboard,
  dataUrlToBlob,
  downloadPngDataUrl,
} from "@/lib/imageCapture";
import { shareFile, shareableFile } from "@/lib/share";

type CopyStatus = "idle" | "copied" | "unsupported" | "error";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imageUrl: string | null;
  /** Prefixo do arquivo; um carimbo de data/hora é acrescentado no download. */
  fileNamePrefix: string;
  title: string;
  description?: string;
  labels: {
    copy: string;
    copied: string;
    copyUnsupported: string;
    copyFailed: string;
    download: string;
    share: string;
    shareFailed: string;
  };
};

/** Modal compartilhado de prévia, cópia, compartilhamento e download das capturas de imagem. */
export function CapturePreviewDialog({
  open,
  onOpenChange,
  imageUrl,
  fileNamePrefix,
  title,
  description,
  labels,
}: Props) {
  const [status, setStatus] = useState<CopyStatus>("idle");
  const [shareTarget, setShareTarget] = useState<File | null>(null);
  const [shareFailed, setShareFailed] = useState(false);

  useEffect(() => {
    if (!open) setStatus("idle");
  }, [open]);

  useEffect(() => {
    setStatus("idle");
  }, [imageUrl]);

  // Só oferece o compartilhamento quando o navegador aceita o arquivo; a
  // validação usa o PNG real, então tipos recusados já não exibem o botão.
  useEffect(() => {
    setShareTarget(null);
    setShareFailed(false);
    if (!open || !imageUrl) return;
    const blob = dataUrlToBlob(imageUrl);
    if (!blob) return;
    setShareTarget(shareableFile(blob, `${fileNamePrefix}-${captureTimestamp()}.png`));
  }, [open, imageUrl, fileNamePrefix]);

  const handleCopy = async () => {
    if (!imageUrl) return;
    setStatus(await copyImageToClipboard(imageUrl));
  };

  const handleDownload = () => {
    if (!imageUrl) return;
    downloadPngDataUrl(imageUrl, `${fileNamePrefix}-${captureTimestamp()}.png`);
  };

  const handleShare = async () => {
    if (!shareTarget) return;
    setShareFailed(false);
    setShareFailed((await shareFile(shareTarget, title)) === "error");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {imageUrl && (
          <img
            src={imageUrl}
            alt={title}
            className="mx-auto max-h-[60vh] w-auto max-w-full rounded-md border border-white/10 bg-black"
          />
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-primary gap-1.5 text-xs"
            onClick={() => void handleCopy()}
          >
            <Copy className="h-3.5 w-3.5" />
            {labels.copy}
          </button>
          <button type="button" className="btn-chip gap-1.5 text-xs" onClick={handleDownload}>
            <Download className="h-3.5 w-3.5" />
            {labels.download}
          </button>
          {shareTarget && (
            <button
              type="button"
              className="btn-chip gap-1.5 text-xs"
              onClick={() => void handleShare()}
            >
              <Share2 className="h-3.5 w-3.5" />
              {labels.share}
            </button>
          )}
          {status === "copied" && (
            <span className="text-[11px] font-medium text-emerald-400">{labels.copied}</span>
          )}
          {status === "unsupported" && (
            <span className="text-[11px] text-amber-300">{labels.copyUnsupported}</span>
          )}
          {status === "error" && (
            <span className="text-[11px] text-destructive">{labels.copyFailed}</span>
          )}
          {shareFailed && (
            <span className="text-[11px] text-destructive" role="alert">
              {labels.shareFailed}
            </span>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

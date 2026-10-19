import { useEffect, useState } from "react";
import { Copy, Download } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { captureTimestamp, copyImageToClipboard, downloadPngDataUrl } from "@/lib/imageCapture";

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
  };
};

/** Modal compartilhado de prévia, cópia e download das capturas de imagem. */
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

  useEffect(() => {
    if (!open) setStatus("idle");
  }, [open]);

  useEffect(() => {
    setStatus("idle");
  }, [imageUrl]);

  const handleCopy = async () => {
    if (!imageUrl) return;
    setStatus(await copyImageToClipboard(imageUrl));
  };

  const handleDownload = () => {
    if (!imageUrl) return;
    downloadPngDataUrl(imageUrl, `${fileNamePrefix}-${captureTimestamp()}.png`);
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
          {status === "copied" && (
            <span className="text-[11px] font-medium text-emerald-400">{labels.copied}</span>
          )}
          {status === "unsupported" && (
            <span className="text-[11px] text-amber-300">{labels.copyUnsupported}</span>
          )}
          {status === "error" && (
            <span className="text-[11px] text-destructive">{labels.copyFailed}</span>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

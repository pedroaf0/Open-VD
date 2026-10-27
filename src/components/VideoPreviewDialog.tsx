import { Download } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  closeLabel: string;
};

/** Modal de prévia e download dos vídeos gravados no painel de visualização. */
export function VideoPreviewDialog({
  open,
  onOpenChange,
  videoUrl,
  fileNamePattern,
  fileExtension,
  title,
  description,
  downloadLabel,
  closeLabel,
}: Props) {
  const handleDownload = () => {
    if (!videoUrl) return;
    downloadUrlAsFile(videoUrl, recordingFileName(fileNamePattern, fileExtension));
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
          <button
            type="button"
            className="btn-chip gap-1.5 text-xs"
            onClick={() => onOpenChange(false)}
          >
            {closeLabel}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

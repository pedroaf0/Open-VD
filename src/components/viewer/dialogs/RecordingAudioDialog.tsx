import { useTranslation } from "react-i18next";
import { Mic, Video } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Pergunta se a gravação do painel deve incluir o áudio do microfone. */
export function RecordingAudioDialog({
  open,
  onOpenChange,
  onStartWithoutAudio,
  onStartWithAudio,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStartWithoutAudio: () => void;
  onStartWithAudio: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("viewer.recording.audioTitle")}</DialogTitle>
          <DialogDescription>{t("viewer.recording.audioDesc")}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <button
            type="button"
            className="btn-ghost w-full sm:w-auto"
            onClick={() => onOpenChange(false)}
          >
            {t("viewer.common.cancel")}
          </button>
          <button
            type="button"
            className="btn-outline w-full gap-1.5 sm:w-auto"
            onClick={onStartWithoutAudio}
          >
            <Video className="h-3.5 w-3.5" aria-hidden="true" />
            {t("viewer.recording.audioWithout")}
          </button>
          <button
            type="button"
            className="btn-primary w-full gap-1.5 sm:w-auto"
            onClick={onStartWithAudio}
          >
            <Mic className="h-3.5 w-3.5" aria-hidden="true" />
            {t("viewer.recording.audioWith")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

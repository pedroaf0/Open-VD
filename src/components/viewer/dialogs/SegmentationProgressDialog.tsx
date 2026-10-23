import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SEG_FAKE_TOTAL_S } from "@/components/viewer/constants";

/** Diálogo de progresso simulado enquanto a segmentação roda no servidor. */
export function SegmentationProgressDialog({
  modal,
  pct,
  onClose,
}: {
  modal: { title: string; startAt: number } | null;
  pct: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={!!modal}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("viewer.segmentation.modalTitle")}</DialogTitle>
          <DialogDescription>
            {modal?.title
              ? t("viewer.segmentation.modalScene", { title: modal.title })
              : t("viewer.segmentation.modalDesc")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="h-2 w-full overflow-hidden rounded-full bg-panel-2">
            <div
              className="h-full bg-primary transition-all duration-500"
              style={{ width: `${Math.min(100, pct)}%` }}
            />
          </div>
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>{Math.min(100, pct).toFixed(1)}%</span>
            <span>
              {(() => {
                if (!modal) return "";
                const elapsed = Math.floor((Date.now() - modal.startAt) / 1000);
                const remain = Math.max(0, SEG_FAKE_TOTAL_S - elapsed);
                const m = Math.floor(remain / 60);
                const s = remain % 60;
                return t("viewer.segmentation.modalEta", {
                  time: `${m}:${String(s).padStart(2, "0")}`,
                });
              })()}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{t("viewer.segmentation.modalLeave")}</p>
          <p className="text-xs text-muted-foreground">{t("viewer.segmentation.modalEmail")}</p>
        </div>
        <DialogFooter>
          <button className="btn-ghost" onClick={onClose}>
            {t("viewer.segmentation.modalBackground")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

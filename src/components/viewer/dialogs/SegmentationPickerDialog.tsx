import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SceneSummary, SegmentationType } from "@/lib/wp";
import type { SegmentationPickerState } from "@/components/viewer/types";

/** Diálogo para escolher qual tipo de segmentação executar em uma cena. */
export function SegmentationPickerDialog({
  picker,
  types,
  credits,
  busy,
  getStatus,
  onClose,
  onChoose,
}: {
  picker: SegmentationPickerState | null;
  types: SegmentationType[];
  credits: number;
  busy: boolean;
  getStatus: (summary: SceneSummary | null, typeId: string) => string | null;
  onClose: () => void;
  onChoose: (summary: SceneSummary, typeId: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={!!picker}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("viewer.segmentation.pickerTitle")}</DialogTitle>
          <DialogDescription>{t("viewer.segmentation.pickerDesc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
          {types.map((segType) => {
            const st = picker?.summary ? getStatus(picker.summary, segType.id) : null;
            const done = st && st !== "FAILED";
            const failed = st === "FAILED";
            const running = st && st !== "COMPLETED" && st !== "FAILED";
            const canAfford = segType.cost === 0 || credits >= segType.cost;
            const disabled = !!done || !!running || busy || !canAfford;
            const costLabel =
              segType.cost === 0
                ? t("viewer.segmentation.free")
                : t("viewer.segmentation.credits", { count: segType.cost });
            return (
              <div key={segType.id} className="rounded border border-border p-3 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold">{segType.name}</span>
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-panel-2">
                    {costLabel}
                  </span>
                </div>
                {segType.description && (
                  <div
                    className="text-[11px] leading-relaxed text-muted-foreground max-w-none break-words [&_p]:my-1 [&_ul]:ml-4 [&_ul]:list-disc [&_ol]:ml-4 [&_ol]:list-decimal [&_a]:text-primary [&_a]:underline [&_strong]:font-bold [&_em]:italic [&_h1]:text-sm [&_h2]:text-sm [&_h3]:text-xs"
                    dangerouslySetInnerHTML={{ __html: segType.description }}
                  />
                )}
                {st && (
                  <p className="text-[11px] font-mono">
                    {st === "COMPLETED" ? (
                      <span className="text-green-500">
                        ✓ {t("viewer.segmentation.completedWord")}
                      </span>
                    ) : st === "FAILED" ? (
                      <span className="text-destructive">
                        ✕ {t("viewer.segmentation.failedWord")}
                      </span>
                    ) : (
                      <span className="text-yellow-500">⏳ {st}</span>
                    )}
                  </p>
                )}
                <button
                  className="btn-primary w-full mt-2"
                  disabled={disabled}
                  title={
                    !canAfford
                      ? t("viewer.segmentation.notEnoughCredits")
                      : done
                        ? t("viewer.segmentation.alreadySegmentedTitle")
                        : running
                          ? t("viewer.segmentation.inProgress")
                          : undefined
                  }
                  onClick={() => {
                    if (!picker) return;
                    const s = picker.summary ?? {
                      key: picker.key,
                      title: picker.title,
                      fileCount: 0,
                      bytes: 0,
                      created: new Date().toISOString(),
                      segmentationUsed: false,
                      segmentationStatus: null,
                      segmentations: {},
                    };
                    onChoose(s, segType.id);
                  }}
                >
                  {failed
                    ? t("viewer.segmentation.retry")
                    : done
                      ? t("viewer.segmentation.alreadySegmented")
                      : running
                        ? t("viewer.segmentation.inProgress")
                        : t("viewer.segmentation.segmentWithNameCost", {
                            name: segType.name,
                            cost: costLabel,
                          })}
                </button>
                {!canAfford && (
                  <p className="text-[10px] text-destructive">
                    {t("viewer.segmentation.noCredits")}
                  </p>
                )}
              </div>
            );
          })}
        </div>
        <DialogFooter>
          <button className="btn-ghost" onClick={onClose}>
            {t("viewer.common.close")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

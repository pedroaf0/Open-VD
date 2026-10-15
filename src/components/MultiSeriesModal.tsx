import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, FileArchive, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { DicomSeriesGroup } from "@/lib/dicom";

function sanitizeName(s: string): string {
  return (
    s
      .replace(/[^a-zA-Z0-9-_ ]/g, "")
      .trim()
      .slice(0, 60) || "serie"
  );
}

async function downloadSeriesZip(group: DicomSeriesGroup) {
  const entries: Record<string, Uint8Array> = {};
  for (const f of group.files) {
    let key = f.name;
    let n = 1;
    while (entries[key]) key = `${f.name} (${++n})`;
    entries[key] = new Uint8Array(await f.arrayBuffer());
  }
  const { zipSync } = await import("fflate");
  const zipped = zipSync(entries);
  const blob = new Blob([zipped as unknown as BlobPart], { type: "application/zip" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${sanitizeName(group.displayName)}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}

export function MultiSeriesModal({
  open,
  onOpenChange,
  groups,
  openedName,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  groups: DicomSeriesGroup[];
  openedName: string;
}) {
  const { t } = useTranslation();
  const [busyKey, setBusyKey] = useState<string | null>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileArchive className="h-4 w-4" /> {t("ui.multiSeriesModal.title")}
          </DialogTitle>
          <DialogDescription>
            {t("ui.multiSeriesModal.description", { name: openedName })}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[45vh] space-y-1.5 overflow-y-auto pr-1">
          {groups.map((g) => (
            <div
              key={g.key}
              className="flex items-center gap-2 rounded border border-border bg-panel px-2 py-1.5"
            >
              <FileArchive className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">
                  {g.displayName}{" "}
                  {g.key === groups[0]?.key ? t("ui.multiSeriesModal.openedTag") : ""}
                </p>
                <p className="font-mono text-[10px] text-muted-foreground">
                  {g.modality || "—"} · {t("ui.multiSeriesModal.filesCount", { count: g.count })}{" "}
                  {g.seriesNumber
                    ? t("ui.multiSeriesModal.seriesNumber", { num: g.seriesNumber })
                    : ""}
                </p>
              </div>
              <button
                className="btn-chip shrink-0"
                disabled={busyKey === g.key}
                onClick={async () => {
                  setBusyKey(g.key);
                  try {
                    await downloadSeriesZip(g);
                  } finally {
                    setBusyKey(null);
                  }
                }}
              >
                {busyKey === g.key ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Download className="h-3 w-3" />
                )}
                {t("ui.multiSeriesModal.downloadZip")}
              </button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

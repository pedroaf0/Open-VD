import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import type { ExpandInput } from "@/lib/zip";
import type { StorageInfo } from "@/lib/wp";

/** Modal de criação/atualização de cena compartilhada. */
export function ShareDialog({
  open,
  sceneKey,
  sceneName,
  onSceneNameChange,
  busy,
  progress,
  sourceFiles,
  uploadedNames,
  hasSourceUrl,
  storage,
  storageBlocked,
  onClose,
  onPublish,
}: {
  open: boolean;
  sceneKey: string | null;
  sceneName: string;
  onSceneNameChange: (value: string) => void;
  busy: boolean;
  progress: { done: number; total: number } | null;
  sourceFiles: ExpandInput[];
  uploadedNames: Set<string>;
  hasSourceUrl: boolean;
  storage: StorageInfo | null;
  storageBlocked: boolean;
  onClose: () => void;
  onPublish: () => void;
}) {
  const { t } = useTranslation();
  if (!open) return null;

  const pending = sourceFiles.filter((f) => !uploadedNames.has(f.name)).length;
  const summary = sceneKey
    ? pending
      ? t("viewer.share.pendingFiles", { count: pending })
      : t("viewer.share.existsUpdate")
    : (() => {
        if (hasSourceUrl && pending === 0) return t("viewer.share.urlOnly");
        if (hasSourceUrl && pending > 0) return t("viewer.share.urlMixed", { count: pending });
        return t("viewer.share.uploadFiles", { count: pending });
      })();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={() => !busy && onClose()}
    >
      <div
        className="card-panel w-full max-w-sm space-y-3 p-4"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t("viewer.share.title")}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold">{t("viewer.share.title")}</h2>
          <button
            className="icon-btn-sm"
            onClick={onClose}
            disabled={busy}
            aria-label={t("viewer.common.close")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <label className="block space-y-1">
          <span className="data-mono text-[10px] text-muted-foreground">
            {t("viewer.share.nameLabel")}
          </span>
          <input
            value={sceneName}
            onChange={(e) => onSceneNameChange(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs"
            placeholder={t("viewer.share.namePlaceholder")}
          />
        </label>
        <p className="text-[11px] text-muted-foreground">{summary}</p>
        {storageBlocked && (
          <p className="text-[11px] text-destructive">
            {storage?.blocked ? t("viewer.share.storageBlocked") : t("viewer.share.storageFull")}
          </p>
        )}
        {progress && (
          <div className="space-y-1">
            <div className="h-1.5 w-full overflow-hidden rounded bg-panel-2">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }}
              />
            </div>
            <p className="data-mono text-[10px] text-muted-foreground">
              {progress.done}/{progress.total}
            </p>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button className="btn-chip" onClick={onClose} disabled={busy}>
            {t("viewer.common.cancel")}
          </button>
          <button className="btn-primary" onClick={onPublish} disabled={busy || storageBlocked}>
            {busy
              ? t("viewer.status.uploading")
              : sceneKey
                ? t("viewer.share.saveAndGenerate")
                : t("viewer.share.sendAndGenerate")}
          </button>
        </div>
      </div>
    </div>
  );
}

import { useTranslation } from "react-i18next";
import { Box, FileUp, FolderUp, Link2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { UploadIcon, type UploadIconHandle } from "@/components/UploadIcon";

interface EmptyStateProps {
  isDraggingFile: boolean;
  canUpload: boolean;
  canLoadPublicly: boolean;
  allowDirectDicom: boolean;
  allowUrlLoading: boolean;
  error: string | null;
  // Refs for file inputs
  dicomInput: React.RefObject<HTMLInputElement | null>;
  dicomFolderInput: React.RefObject<HTMLInputElement | null>;
  stlInput: React.RefObject<HTMLInputElement | null>;
  uploadIconRef: React.RefObject<UploadIconHandle | null>;
  // Handlers
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => Promise<void>;
  onOpenUrl: () => void;
  onLogin: () => void;
}

/** Drop zone exibida quando não há volume, status nem modelos carregados. */
export function EmptyState({
  isDraggingFile,
  canUpload,
  canLoadPublicly,
  allowDirectDicom,
  allowUrlLoading,
  error,
  dicomInput,
  dicomFolderInput,
  stlInput,
  uploadIconRef,
  onDragOver,
  onDrop,
  onOpenUrl,
  onLogin,
}: EmptyStateProps) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        "flex h-full items-center justify-center rounded-lg border border-dashed p-4 transition-colors duration-200",
        isDraggingFile ? "border-primary bg-card/80" : "border-border",
      )}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className="flex max-w-md flex-col items-center text-center">
        <UploadIcon
          ref={uploadIconRef}
          size={48}
          className="mb-4 cursor-pointer text-muted-foreground/70 transition-colors hover:text-foreground"
          onMouseEnter={() => uploadIconRef.current?.startAnimation()}
          onMouseLeave={() => uploadIconRef.current?.stopAnimation()}
          aria-hidden
        />
        <h2 className="font-display text-xl font-bold">
          {canUpload || canLoadPublicly ? t("viewer.empty.loadStudy") : t("viewer.empty.noScene")}
        </h2>
        <p className="mt-2 text-xs text-muted-foreground">
          {canUpload || canLoadPublicly
            ? allowDirectDicom
              ? t("viewer.empty.loadStudyHintDirect")
              : t("viewer.empty.loadStudyHint")
            : t("viewer.empty.loginHint")}
        </p>
        {(canUpload || canLoadPublicly) && (
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            {allowDirectDicom && (
              <button className="btn-primary gap-1.5" onClick={() => dicomInput.current?.click()}>
                <FileUp className="h-3.5 w-3.5" />
                {t("viewer.header.openDicom")}
              </button>
            )}
            {allowDirectDicom && (
              <button
                className="btn-ghost gap-1.5"
                onClick={() => dicomFolderInput.current?.click()}
              >
                <FolderUp className="h-3.5 w-3.5" />
                {t("viewer.header.openDicomFolder")}
              </button>
            )}
            {(allowUrlLoading || allowDirectDicom) && (
              <button
                className={allowDirectDicom ? "btn-ghost gap-1.5" : "btn-primary gap-1.5"}
                onClick={onOpenUrl}
              >
                <Link2 className="h-3.5 w-3.5" />
                {t("viewer.header.openByUrl")}
              </button>
            )}
            <button className="btn-ghost" onClick={() => stlInput.current?.click()}>
              <Box className="h-3.5 w-3.5" />
              STL / PLY / OBJ
            </button>
          </div>
        )}
        {!canUpload && !canLoadPublicly && (
          <button className="btn-primary mt-4" onClick={onLogin}>
            {t("viewer.empty.login")}
          </button>
        )}
        {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
      </div>
    </div>
  );
}

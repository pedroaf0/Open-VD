import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Diálogo de ajuda quando o download por URL falha (link privado, formato, etc.). */
export function UrlErrorDialog({
  open,
  onOpenChange,
  detail,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detail: string | null;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("viewer.urlError.title")}</DialogTitle>
          <DialogDescription>{t("viewer.urlError.description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              <strong>{t("viewer.urlError.publicLinkLabel")}</strong>{" "}
              {t("viewer.urlError.publicLinkText")}
            </li>
            <li>
              <strong>{t("viewer.urlError.zipLabel")}</strong> {t("viewer.urlError.zipText")}
            </li>
          </ol>
          <p className="text-xs text-muted-foreground">{t("viewer.urlError.hint")}</p>
          {detail && (
            <details className="rounded border border-border bg-panel p-2">
              <summary className="cursor-pointer text-xs font-semibold">
                {t("viewer.urlError.details")}
              </summary>
              <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-all text-[11px]">
                {detail}
              </pre>
            </details>
          )}
        </div>
        <DialogFooter>
          <button className="btn-primary" onClick={() => onOpenChange(false)}>
            {t("viewer.urlError.understood")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

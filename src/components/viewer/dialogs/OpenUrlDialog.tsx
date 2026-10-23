import { useTranslation } from "react-i18next";
import { Link2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/** Diálogo para abrir um estudo a partir de uma URL (Drive/OneDrive/ZIP). */
export function OpenUrlDialog({
  open,
  onOpenChange,
  value,
  onValueChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: (url: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("viewer.header.openByUrl")}</DialogTitle>
          <DialogDescription>
            {t("viewer.urlDialog.descBefore")} <strong>.zip</strong>{" "}
            {t("viewer.urlDialog.descAfter")}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(value);
          }}
        >
          <Input
            autoFocus
            type="url"
            inputMode="url"
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            placeholder={t("viewer.urlDialog.placeholder")}
            aria-label={t("viewer.urlDialog.fileUrlAria")}
          />
          <p className="text-[11px] text-muted-foreground">{t("viewer.urlDialog.publicHint")}</p>
          <DialogFooter>
            <button type="button" className="btn-ghost" onClick={() => onOpenChange(false)}>
              {t("viewer.common.cancel")}
            </button>
            <button type="submit" className="btn-primary" disabled={!value.trim()}>
              <Link2 className="h-3.5 w-3.5" />
              {t("viewer.urlDialog.submit")}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

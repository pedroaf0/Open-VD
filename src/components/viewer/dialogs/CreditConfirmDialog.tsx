import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Confirmação do consumo de um crédito para autorizar uma URL. */
export function CreditConfirmDialog({
  open,
  credits,
  onOpenChange,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  credits: number;
  onOpenChange: (open: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("viewer.credit.title")}</DialogTitle>
          <DialogDescription>
            {t("viewer.credit.descIntro")} <strong>{t("viewer.credit.oneCredit")}</strong>.
            <br />
            {t("viewer.credit.balanceLabel")}{" "}
            <strong>{t("viewer.credit.balance", { count: credits })}</strong>.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <button className="btn-ghost" onClick={onCancel}>
            {t("viewer.common.cancel")}
          </button>
          <button className="btn-primary" onClick={onConfirm}>
            {t("viewer.credit.confirm")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

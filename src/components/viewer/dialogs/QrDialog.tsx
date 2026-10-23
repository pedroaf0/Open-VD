import { useTranslation } from "react-i18next";
import { QRCode } from "react-qr-code";
import { X } from "lucide-react";

/** Modal com o QR code do link público da cena. */
export function QrDialog({
  open,
  share,
  onClose,
}: {
  open: boolean;
  share: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  if (!open || !share) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="card-panel flex w-full max-w-sm flex-col items-center gap-3 p-5"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t("viewer.share.qrAria")}
      >
        <div className="flex w-full items-center justify-between">
          <span className="group-title">{t("viewer.share.qrTitle")}</span>
          <button className="icon-btn-sm" onClick={onClose} aria-label={t("viewer.common.close")}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="rounded-lg border border-border bg-white p-3">
          <QRCode value={share} size={220} />
        </div>
        <p className="data-mono w-full truncate text-[10px] text-muted-foreground">{share}</p>
        <button className="btn-primary w-full" onClick={onClose}>
          {t("viewer.common.close")}
        </button>
      </div>
    </div>
  );
}

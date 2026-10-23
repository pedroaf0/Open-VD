import { useTranslation } from "react-i18next";
import { QrCode } from "lucide-react";

/** Barra com o link público da cena e atalhos de copiar/QR. */
export function ShareLinkBar({
  share,
  onClose,
  onShowQr,
}: {
  share: string | null;
  onClose: () => void;
  onShowQr: () => void;
}) {
  const { t } = useTranslation();
  if (!share) return null;
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-panel px-3 py-2 text-[11px]">
      <span className="data-mono text-muted-foreground">{t("viewer.share.linkLabel")}</span>
      <input
        readOnly
        value={share}
        onFocus={(e) => e.currentTarget.select()}
        className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px]"
      />
      <button className="btn-chip" onClick={() => navigator.clipboard?.writeText(share)}>
        {t("viewer.common.copy")}
      </button>
      <button
        className="btn-chip"
        onClick={onShowQr}
        title={t("viewer.share.showQr")}
        aria-label={t("viewer.share.showQr")}
      >
        <QrCode className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">QR</span>
      </button>
      <button className="btn-chip" onClick={onClose}>
        {t("viewer.common.close")}
      </button>
    </div>
  );
}

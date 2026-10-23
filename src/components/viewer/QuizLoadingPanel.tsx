import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import type { DownloadProgress } from "@/components/viewer/types";

const formatMb = (bytes: number) =>
  bytes <= 0
    ? "0 KB"
    : bytes < 1048576
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1048576).toFixed(1)} MB`;

const formatSpeed = (bps: number) =>
  bps <= 0
    ? ""
    : bps < 1048576
      ? `${(bps / 1024).toFixed(1)} KB/s`
      : `${(bps / 1048576).toFixed(2)} MB/s`;

const formatEta = (seconds: number) => {
  if (seconds < 60) {
    return i18n.t("viewer.quiz.etaSeconds", { value: Math.max(1, Math.round(seconds)) });
  }
  const m = Math.floor(seconds / 60);
  const s = Math.ceil(seconds % 60);
  return m >= 60
    ? i18n.t("viewer.quiz.etaHours", {
        hours: Math.floor(m / 60),
        minutes: String(m % 60).padStart(2, "0"),
      })
    : i18n.t("viewer.quiz.etaMinutes", { minutes: m, seconds: String(s).padStart(2, "0") });
};

/** Painel exibido enquanto uma cena compartilhada carrega: progresso no topo + iframe de espera (opcional). */
export function QuizLoadingPanel({
  status,
  progress,
  quizUrl,
  quizText,
}: {
  status: string;
  progress: DownloadProgress | null;
  quizUrl: string;
  quizText: string;
}) {
  const { t } = useTranslation();
  const totalBytes = progress && progress.totalBytes > 0 ? progress.totalBytes : 0;
  const pct = progress
    ? totalBytes > 0
      ? Math.min(100, Math.round((progress.receivedBytes / totalBytes) * 100))
      : Math.round((progress.done / Math.max(1, progress.total)) * 100)
    : 0;
  const text = quizText.trim() || t("viewer.quiz.defaultText");
  const url = quizUrl.trim();
  const speed = progress && progress.speedBps > 0 ? formatSpeed(progress.speedBps) : "";
  const eta =
    progress && totalBytes > 0 && progress.speedBps > 0
      ? formatEta((totalBytes - progress.receivedBytes) / progress.speedBps)
      : "";
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2">
      <section className="card-panel shrink-0 space-y-2 p-3">
        <div className="flex items-baseline justify-between gap-3">
          <p className="data-mono text-xs text-primary">{status}</p>
          {progress && (
            <span className="data-mono text-[10px] text-muted-foreground">
              {totalBytes > 0
                ? `${formatMb(progress.receivedBytes)} / ${formatMb(totalBytes)}`
                : `${progress.done}/${progress.total}`}{" "}
              · {pct}%
            </span>
          )}
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-panel-2">
          {progress ? (
            <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
          ) : (
            <div className="h-full w-1/3 animate-pulse rounded-full bg-primary/60" />
          )}
        </div>
        {progress && progress.receivedBytes > 0 && (
          <p className="data-mono text-[11px] text-muted-foreground">
            {t("viewer.quiz.transferred", { value: formatMb(progress.receivedBytes) })}
            {speed ? <> · {speed}</> : null}
            {eta ? <> · {eta}</> : null}
          </p>
        )}
        <p className="text-xs text-muted-foreground">{text}</p>
      </section>
      {url && (
        <iframe
          src={url}
          title={text}
          className="min-h-0 w-full flex-1 rounded-lg border border-border bg-background"
          allowFullScreen
        />
      )}
    </div>
  );
}

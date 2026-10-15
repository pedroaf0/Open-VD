import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Download } from "lucide-react";
import { formatBytes, pctUsed } from "@/lib/format";
import { useInstallPrompt } from "@/lib/pwa";
import { markSceneAccessed, shareUrl, type SceneSummary, type UserPanel } from "@/lib/wp";
import { SceneDownloadModal } from "@/components/SceneDownloadModal";

function StatCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 rounded-lg border border-border bg-panel p-3">
      <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      {children}
    </section>
  );
}

/**
 * Perfil do usuário logado: dashboard com cenas, cenas acessadas
 * recentemente, armazenamento, créditos e instalação do PWA.
 */
export function ProfileView({
  displayName,
  userPanel,
  recentScenes,
  error,
  shopUrl,
  segBusy,
  panelBusy,
  segCost = 1,
  onRefresh,
  onDeleteScene,
  onSegmentScene,
  onCreateScene,
}: {
  displayName?: string;
  userPanel: UserPanel | null;
  recentScenes: SceneSummary[];
  error?: string | null;
  shopUrl?: string;
  segBusy: string | null;
  panelBusy: boolean;
  segCost?: number;
  onRefresh: () => void;
  onDeleteScene: (s: SceneSummary) => void;
  onSegmentScene: (s: SceneSummary) => void;
  onCreateScene: () => void;
}) {
  const { t } = useTranslation();
  const { canInstall, installed, install } = useInstallPrompt();
  const [dlScene, setDlScene] = useState<SceneSummary | null>(null);
  const storage = userPanel?.storage ?? null;
  const credits = userPanel?.credits ?? 0;
  const scenes = userPanel?.scenes ?? [];
  const ownKeys = new Set(scenes.map((s) => s.key));
  const recents = recentScenes.filter((r) => !ownKeys.has(r.key));

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-lg font-extrabold">{t("ui.profileView.title")}</h2>
          <p className="text-[11px] text-muted-foreground">
            {displayName
              ? t("ui.profileView.greeting", { name: displayName })
              : t("ui.profileView.accountPanel")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canInstall && (
            <button
              className="btn-chip"
              onClick={() => void install()}
              title={t("ui.profileView.installTitle")}
            >
              {t("ui.profileView.installApp")}
            </button>
          )}
          {installed && (
            <span
              className="rounded border border-border px-2 py-0.5 font-mono text-[10px] text-muted-foreground"
              title={t("ui.profileView.installedTitle")}
            >
              {t("ui.profileView.installedApp")}
            </span>
          )}
          <button className="btn-chip" onClick={onRefresh}>
            {t("ui.profileView.refresh")}
          </button>
        </div>
      </div>

      {error && (
        <p className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
          {error}
        </p>
      )}

      <button className="btn-primary w-full" onClick={onCreateScene}>
        {t("ui.profileView.createScene")}
      </button>

      <div className="grid gap-3 sm:grid-cols-3">
        {storage && storage.limitBytes > 0 && storage.availableBytes < 5 * 1024 * 1024 && (
          <StatCard label={t("ui.profileView.storage")}>
            {!storage && <p className="text-[11px] text-muted-foreground">—</p>}
            {storage && (
              <>
                <p className="font-mono text-xs">
                  {formatBytes(storage.usedBytes)}
                  <span className="text-muted-foreground">
                    {" "}
                    / {formatBytes(storage.limitBytes)}
                  </span>
                </p>
                <div className="h-2 w-full overflow-hidden rounded bg-panel-2">
                  <div
                    className={`h-full transition-all ${storage.blocked ? "bg-destructive" : "bg-primary"}`}
                    style={{ width: `${pctUsed(storage)}%` }}
                  />
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {storage.blocked
                    ? t("ui.profileView.storageBlocked")
                    : t("ui.profileView.storageAvailable", {
                        value: formatBytes(storage.availableBytes),
                      })}
                </p>
                {userPanel?.storagePlans && userPanel.storagePlans.length > 0 && (
                  <p className="font-mono text-[10px] text-muted-foreground">
                    {t("ui.profileView.plansActive", { count: userPanel.storagePlans.length })} ·{" "}
                    {(() => {
                      const next = Math.min(...userPanel.storagePlans.map((p) => p.expiresAt));
                      const days = Math.max(0, Math.ceil((next - Date.now()) / 86400000));
                      return t("ui.profileView.nextRenewal", { count: days });
                    })()}
                  </p>
                )}
                {shopUrl && (storage.blocked || pctUsed(storage) >= 80) && (
                  <a
                    className="btn-chip block w-full text-center"
                    href={shopUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("ui.profileView.buyStorage")}
                  </a>
                )}
              </>
            )}
          </StatCard>
        )}

        {credits > 0 && (
          <StatCard label={t("ui.profileView.credits")}>
            <p className="font-display text-3xl font-extrabold text-primary">{credits}</p>
            {shopUrl && (
              <a
                className="btn-chip block w-full text-center"
                href={shopUrl}
                target="_blank"
                rel="noreferrer"
              >
                {t("ui.profileView.buyCredits")}
              </a>
            )}
          </StatCard>
        )}

        <StatCard label={t("ui.profileView.myScenes")}>
          <p className="font-display text-3xl font-extrabold">{scenes.length}</p>
          <p className="text-[10px] text-muted-foreground">
            {recents.length > 0
              ? t("ui.profileView.recentCount", { count: recents.length })
              : t("ui.profileView.noRecent")}
          </p>
        </StatCard>
      </div>

      {/* Minhas cenas */}
      <section className="space-y-2">
        <h3 className="font-display text-sm font-bold">{t("ui.profileView.myScenes")}</h3>
        {!userPanel && !error && (
          <p className="text-[11px] text-muted-foreground">{t("ui.profileView.loading")}</p>
        )}
        {userPanel && scenes.length === 0 && (
          <p className="text-[11px] text-muted-foreground">{t("ui.profileView.noScenes")}</p>
        )}
        {scenes.map((s) => {
          const segMap = s.segmentations ?? {};
          const segUsed = !!s.segmentationUsed || Object.keys(segMap).length > 0;
          const segStatus = s.segmentationStatus ?? null;
          return (
            <div
              key={s.key}
              className="flex items-center gap-2 rounded border border-border bg-panel p-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold">{s.title}</p>
                <p className="font-mono text-[10px] text-muted-foreground">
                  {s.fileCount > 0 ? t("ui.profileView.filesCount", { count: s.fileCount }) : ""}
                  {s.fileCount > 0 && s.bytes > 0 ? `· ${formatBytes(s.bytes)}` : ""}
                  {s.created ? ` · ${new Date(s.created).toLocaleDateString()}` : ""}
                </p>
                {segUsed && (
                  <p className="font-mono text-[10px] flex flex-wrap gap-1">
                    {Object.keys(segMap).length > 0 ? (
                      Object.entries(segMap).map(([tid, st]) => (
                        <span
                          key={tid}
                          className={
                            st === "COMPLETED"
                              ? "text-green-500"
                              : st === "FAILED"
                                ? "text-destructive"
                                : "text-yellow-500"
                          }
                        >
                          {tid}: {st === "COMPLETED" ? "✓" : st === "FAILED" ? "✕" : "⏳"} {st}
                        </span>
                      ))
                    ) : segStatus === "COMPLETED" ? (
                      <span className="text-green-500">{t("ui.profileView.segmented")}</span>
                    ) : segStatus === "FAILED" ? (
                      <span className="text-destructive">{t("ui.profileView.segmentFailed")}</span>
                    ) : (
                      <span className="text-yellow-500">
                        {t("ui.profileView.segmentPending", { status: segStatus || "IN_QUEUE" })}
                      </span>
                    )}
                  </p>
                )}
              </div>
              <button
                className="btn-chip"
                disabled={panelBusy || segBusy !== null}
                title={t("ui.profileView.segmentChooseTitle")}
                onClick={() => onSegmentScene(s)}
              >
                {segBusy === s.key ? t("ui.profileView.sending") : t("ui.profileView.segment")}
              </button>
              <button
                className="btn-chip gap-1"
                onClick={() => setDlScene(s)}
                title={t("ui.profileView.downloadSceneTitle")}
              >
                <Download className="h-3 w-3" /> {t("ui.profileView.download")}
              </button>
              <a
                className="btn-chip"
                href={shareUrl(s.key)}
                target="_blank"
                rel="noreferrer"
                onClick={() => void markSceneAccessed(s.key).catch(() => {})}
              >
                {t("ui.profileView.open")}
              </a>
              <button className="btn-chip" disabled={panelBusy} onClick={() => onDeleteScene(s)}>
                {t("ui.profileView.delete")}
              </button>
            </div>
          );
        })}
      </section>

      {recents.length > 0 && (
        <section className="space-y-2">
          <h3 className="font-display text-sm font-bold">{t("ui.profileView.recentlyAccessed")}</h3>
          {recents.map((s) => (
            <div
              key={s.key}
              className="flex items-center gap-2 rounded border border-border/60 bg-panel/60 p-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold">
                  {s.title || s.key}
                  {!s.isOwn && (
                    <span className="ml-1.5 rounded bg-panel px-1 py-0.5 font-mono text-[9px] uppercase text-muted-foreground">
                      {t("ui.profileView.shared")}
                    </span>
                  )}
                </p>
                <p className="font-mono text-[10px] text-muted-foreground">
                  {t("ui.profileView.filesCount", { count: s.fileCount })}
                  {s.accessedAt
                    ? t("ui.profileView.accessedOn", {
                        date: new Date(s.accessedAt * 1000).toLocaleDateString(),
                      })
                    : ""}
                </p>
              </div>
              <button
                className="btn-chip gap-1"
                onClick={() => setDlScene(s)}
                title={t("ui.profileView.downloadSceneTitle")}
              >
                <Download className="h-3 w-3" /> {t("ui.profileView.download")}
              </button>
              <a
                className="btn-chip"
                href={shareUrl(s.key)}
                target="_blank"
                rel="noreferrer"
                onClick={() => void markSceneAccessed(s.key).catch(() => {})}
              >
                {t("ui.profileView.open")}
              </a>
            </div>
          ))}
        </section>
      )}
      <SceneDownloadModal
        open={!!dlScene}
        onOpenChange={(v) => !v && setDlScene(null)}
        scene={dlScene}
      />
    </div>
  );
}

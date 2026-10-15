import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import {
  clearDebugLog,
  getDebugLog,
  subscribeDebugLog,
  DEBUG_OVERLAY_ENABLED,
  type DebugLogEntry,
} from "@/lib/debuglog";

const LEVEL_COLOR: Record<DebugLogEntry["level"], string> = {
  log: "text-slate-200",
  info: "text-sky-300",
  warn: "text-amber-300",
  error: "text-red-400",
};

function useDebugLogs(): readonly DebugLogEntry[] {
  const [logs, setLogs] = useState<readonly DebugLogEntry[]>(() => getDebugLog());
  useEffect(() => subscribeDebugLog(() => setLogs(getDebugLog())), []);
  return logs;
}

/**
 * Floating debug button + full-screen log panel, rendered on top of the
 * application via a portal to `document.body`. Used to inspect what is
 * happening (notably ZIP decompression on iOS Safari) directly on the phone.
 */
export function DebugOverlay() {
  const logs = useDebugLogs();
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();

  if (!DEBUG_OVERLAY_ENABLED) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        title={t("ui.debugPanel.logsTitle")}
        aria-label={t("ui.debugPanel.openLogs")}
        className="fixed bottom-3 right-3 z-[998] flex h-9 min-w-9 items-center justify-center gap-1 rounded-full bg-slate-800/90 px-2 text-xs font-bold text-white shadow-lg active:bg-slate-700"
        style={{ fontFamily: "monospace" }}
      >
        {logs.some((l) => l.level === "error" || l.level === "warn") ? "⚠" : "🐞"}
        <span className="hidden sm:inline">{t("ui.debugPanel.debugLabel")}</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[999] flex flex-col bg-black/85 p-2">
          <div className="flex items-center gap-2 pb-2">
            <h2 className="flex-1 text-sm font-semibold text-white">
              {t("ui.debugPanel.debugLog")}
            </h2>
            <button
              onClick={() => {
                const text = logs
                  .map((l) => `[${l.ts}] ${l.level.toUpperCase()} ${l.msg}`)
                  .join("\n");
                void navigator.clipboard.writeText(text).catch(() => {});
              }}
              className="rounded bg-slate-700 px-2 py-1 text-xs text-white active:bg-slate-600"
            >
              {t("ui.debugPanel.copy")}
            </button>
            <button
              onClick={clearDebugLog}
              className="rounded bg-slate-700 px-2 py-1 text-xs text-white active:bg-slate-600"
            >
              {t("ui.debugPanel.clear")}
            </button>
            <button
              onClick={() => setOpen(false)}
              className="rounded bg-slate-700 px-2 py-1 text-xs text-white active:bg-slate-600"
            >
              {t("ui.debugPanel.close")}
            </button>
          </div>
          <div className="flex-1 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-900 p-2 font-mono text-[11px] leading-snug">
            {logs.length === 0 ? (
              <span className="text-slate-400">({t("ui.debugPanel.noEntries")})</span>
            ) : (
              logs.map((l) => (
                <div key={l.id} className={LEVEL_COLOR[l.level]}>
                  [{l.ts}] {l.level.toUpperCase()} {l.msg}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}

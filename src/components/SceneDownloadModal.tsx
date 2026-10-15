import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, FileDown, Loader2, Package } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatBytes } from "@/lib/format";
import { type SceneFile, type SceneSummary } from "@/lib/wp";

function proxiedDownloadUrl(originalUrl: string): string {
  try {
    const proxy = window.V_DICOM?.downloadUrl;
    if (!proxy) return originalUrl;
    const host = new URL(originalUrl).hostname.toLowerCase();
    const isGoogle =
      host === "drive.google.com" ||
      host === "docs.google.com" ||
      host === "drive.usercontent.google.com";
    const isOneDrive =
      host === "1drv.ms" ||
      host === "onedrive.live.com" ||
      host === "onedrive.com" ||
      host.endsWith(".onedrive.live.com");
    if ((isGoogle || isOneDrive) && proxy) return `${proxy}?url=${encodeURIComponent(originalUrl)}`;
  } catch {
    /* URL inválida: mantém o endereço original */
  }
  return originalUrl;
}

function fileNameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop() || "";
    if (last) {
      try {
        const dec = decodeURIComponent(last);
        if (dec && dec.length < 120) return dec;
      } catch {
        /* não é percent-encoded: usa o nome bruto */
      }
      return last;
    }
  } catch {
    /* URL inválida: cai no fallback por split */
  }
  try {
    const raw = url.split(/[/?#]/).filter(Boolean).pop() || "arquivo";
    return decodeURIComponent(raw);
  } catch {
    return "arquivo";
  }
}

async function triggerSingleDownload(file: SceneFile) {
  const res = await fetch(proxiedDownloadUrl(file.url));
  if (!res.ok) throw new Error(`Falha HTTP ${res.status}`);
  const blob = await res.blob();
  let name = file.name;
  try {
    const cd = res.headers.get("content-disposition");
    const m = cd?.match(/filename\*?="?([^";\n]+)"?/i)?.[1];
    if (m) {
      const dec = decodeURIComponent(m.replace(/^UTF-8''/i, "").replace(/^"|"$/g, ""));
      if (dec) name = dec;
    }
  } catch {
    /* sem content-disposition: mantém o nome do arquivo */
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}

async function downloadAllAsZip(files: SceneFile[], zipName: string) {
  const entries: Record<string, Uint8Array> = {};
  for (const f of files) {
    const r = await fetch(proxiedDownloadUrl(f.url));
    if (!r.ok) continue;
    let name = f.name;
    try {
      const cd = r.headers.get("content-disposition");
      const m = cd?.match(/filename\*?="?([^";\n]+)"?/i)?.[1];
      if (m) {
        const dec = decodeURIComponent(m.replace(/^UTF-8''/i, "").replace(/^"|"$/g, ""));
        if (dec) name = dec;
      }
    } catch {
      /* sem content-disposition: mantém o nome do arquivo */
    }
    let key = name;
    let n = 1;
    while (entries[key]) key = `${name} (${++n})`;
    entries[key] = new Uint8Array(await r.arrayBuffer());
  }
  const { zipSync } = await import("fflate");
  const zipped = zipSync(entries);
  const blob = new Blob([zipped as unknown as BlobPart], { type: "application/zip" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = zipName.endsWith(".zip") ? zipName : `${zipName}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}

function useSceneFiles(sceneKey: string | null, open: boolean) {
  const [files, setFiles] = useState<SceneFile[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!open || !sceneKey) return;
    let alive = true;
    setLoading(true);
    setErr(null);
    setFiles(null);
    (async () => {
      try {
        const { fetchScene } = await import("@/lib/wp");
        const scene = await fetchScene(sceneKey);
        const list: SceneFile[] = [...(scene.files ?? [])];
        const urls: string[] = scene.urls ?? scene.settings?.urls ?? [];
        const seen = new Set(list.map((f) => f.url));
        for (const u of urls) {
          if (!u || seen.has(u)) continue;
          const name = fileNameFromUrl(u);
          const kind: SceneFile["kind"] = /\.(stl|ply|obj|mtl|png|jpe?g)$/i.test(name)
            ? "mesh"
            : "dicom";
          list.push({ name, url: u, kind });
          seen.add(u);
        }
        const legacyUrl = scene.settings?.url;
        if (legacyUrl && !seen.has(legacyUrl)) {
          const name = fileNameFromUrl(legacyUrl);
          const kind: SceneFile["kind"] = /\.(stl|ply|obj|mtl|png|jpe?g)$/i.test(name)
            ? "mesh"
            : "dicom";
          list.push({ name, url: legacyUrl, kind });
        }
        if (!alive) return;
        setFiles(list);
      } catch (e) {
        if (!alive) return;
        setErr(e instanceof Error ? e.message : "ui.sceneDownloadModal.loadFailed");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, sceneKey]);
  return { files, loading, err };
}

export function SceneDownloadModal({
  open,
  onOpenChange,
  scene,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  scene: SceneSummary | { key: string; title: string } | null;
}) {
  const { t } = useTranslation();
  const { files, loading, err } = useSceneFiles(scene?.key ?? null, open);
  const [busyAll, setBusyAll] = useState(false);
  const [busyOne, setBusyOne] = useState<string | null>(null);
  const safeTitle =
    (scene?.title?.trim() || scene?.key || "cena").replace(/[^a-zA-Z0-9-_ ]/g, "").slice(0, 60) ||
    "cena";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-4 w-4" /> {t("ui.sceneDownloadModal.title")}
          </DialogTitle>
          <DialogDescription className="truncate">
            {scene?.title || scene?.key || ""}
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> {t("ui.sceneDownloadModal.loading")}
          </div>
        )}
        {err && (
          <p className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {err.startsWith("ui.") ? t(err) : err}
          </p>
        )}

        {!loading && !err && files && (
          <>
            {files.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">
                {t("ui.sceneDownloadModal.noFiles")}
              </p>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">
                    {files.length}{" "}
                    {t("ui.sceneDownloadModal.filesCountSuffix", { count: files.length })} ·{" "}
                    {formatBytes(files.reduce((a, f) => a + (f.size ?? 0), 0))}
                  </span>
                  <button
                    className="btn-primary gap-1.5 text-xs"
                    disabled={busyAll}
                    onClick={async () => {
                      setBusyAll(true);
                      try {
                        await downloadAllAsZip(files, safeTitle);
                      } finally {
                        setBusyAll(false);
                      }
                    }}
                  >
                    {busyAll ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Download className="h-3.5 w-3.5" />
                    )}
                    {t("ui.sceneDownloadModal.downloadAllZip")}
                  </button>
                </div>
                <div className="max-h-[45vh] space-y-1.5 overflow-y-auto pr-1">
                  {files.map((f) => (
                    <div
                      key={f.url}
                      className="flex items-center gap-2 rounded border border-border bg-panel px-2 py-1.5"
                    >
                      <FileDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium">{f.name}</p>
                        <p className="font-mono text-[10px] text-muted-foreground">
                          {f.kind} · {f.size ? formatBytes(f.size) : "—"}
                        </p>
                      </div>
                      <button
                        className="btn-chip shrink-0"
                        disabled={busyOne === f.url || busyAll}
                        onClick={async () => {
                          setBusyOne(f.url);
                          try {
                            await triggerSingleDownload(f);
                          } catch (e) {
                            console.warn(e);
                          } finally {
                            setBusyOne(null);
                          }
                        }}
                      >
                        {busyOne === f.url ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Download className="h-3 w-3" />
                        )}
                        {t("ui.sceneDownloadModal.download")}
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

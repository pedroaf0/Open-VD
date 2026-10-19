import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  FileDown,
  Loader2,
  Package,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatBytes } from "@/lib/format";
import { groupMeshesByName } from "@/lib/meshGroups";
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
  meshVisibility,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  scene: SceneSummary | { key: string; title: string } | null;
  /**
   * Estado real de visibilidade dos modelos na cena 3D (nome do arquivo →
   * visível). Ausente quando não há cena aberta (ex.: download pelo perfil),
   * caso em que a listagem mantém o comportamento original.
   */
  meshVisibility?: ReadonlyMap<string, boolean> | null;
}) {
  const { t } = useTranslation();
  const { files, loading, err } = useSceneFiles(scene?.key ?? null, open);
  const [busyAll, setBusyAll] = useState(false);
  const [busyOne, setBusyOne] = useState<string | null>(null);
  const [busyGroup, setBusyGroup] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  /**
   * Prioriza os STL visíveis na cena: geometrias (stl/ply/obj) visíveis vêm
   * primeiro, as ocultas numa seção abaixo e os demais arquivos seguem o
   * agrupamento por nome de sempre. A visibilidade vem do estado real da cena
   * (nunca de nome, número de dente ou ordem de carregamento).
   */
  const { visibleMeshes, hiddenMeshes, groups } = useMemo(() => {
    const all = files ?? [];
    if (!meshVisibility) {
      return {
        visibleMeshes: [] as SceneFile[],
        hiddenMeshes: [] as SceneFile[],
        groups: groupMeshesByName(all),
      };
    }
    const visibleMeshes: SceneFile[] = [];
    const hiddenMeshes: SceneFile[] = [];
    const rest: SceneFile[] = [];
    for (const f of all) {
      if (!/\.(stl|ply|obj)$/i.test(f.name)) {
        rest.push(f);
        continue;
      }
      if (meshVisibility.get(f.name) === true) visibleMeshes.push(f);
      else hiddenMeshes.push(f);
    }
    return { visibleMeshes, hiddenMeshes, groups: groupMeshesByName(rest) };
  }, [files, meshVisibility]);

  const safeTitle =
    (scene?.title?.trim() || scene?.key || "cena").replace(/[^a-zA-Z0-9-_ ]/g, "").slice(0, 60) ||
    "cena";

  const renderFile = (f: SceneFile, visible = false) => (
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
      {visible && (
        <span
          className="shrink-0 text-muted-foreground"
          role="img"
          aria-label={t("ui.sceneDownloadModal.visibleBadge")}
          title={t("ui.sceneDownloadModal.visibleBadge")}
        >
          <Eye className="h-3 w-3" />
        </span>
      )}
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
  );

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
                  {visibleMeshes.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1">
                        <Eye className="h-3 w-3 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {t("ui.sceneDownloadModal.visibleSection")}
                        </span>
                        <span className="data-mono text-[9px] text-muted-foreground">
                          {visibleMeshes.length}
                        </span>
                      </div>
                      <div className="space-y-1.5">
                        {visibleMeshes.map((f) => renderFile(f, true))}
                      </div>
                    </div>
                  )}
                  {hiddenMeshes.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1">
                        <EyeOff className="h-3 w-3 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {t("ui.sceneDownloadModal.hiddenSection")}
                        </span>
                        <span className="data-mono text-[9px] text-muted-foreground">
                          {hiddenMeshes.length}
                        </span>
                      </div>
                      <div className="space-y-1.5">
                        {hiddenMeshes.map((f) => renderFile(f, false))}
                      </div>
                    </div>
                  )}
                  {groups.map((group) => {
                    if (!group.label) {
                      return (
                        <div key="__ungrouped" className="space-y-1.5">
                          {group.items.map((f) => renderFile(f))}
                        </div>
                      );
                    }
                    const isCollapsed = collapsed[group.key] ?? false;
                    return (
                      <div key={group.key} className="space-y-1.5">
                        <div className="flex items-center gap-1">
                          <button
                            className="icon-btn-sm"
                            onClick={() =>
                              setCollapsed((c) => ({ ...c, [group.key]: !isCollapsed }))
                            }
                            title={
                              isCollapsed
                                ? t("viewer.meshes.expandGroup")
                                : t("viewer.meshes.collapseGroup")
                            }
                            aria-expanded={!isCollapsed}
                            aria-label={
                              isCollapsed
                                ? t("viewer.meshes.expandGroup")
                                : t("viewer.meshes.collapseGroup")
                            }
                          >
                            {isCollapsed ? (
                              <ChevronRight className="h-3 w-3" />
                            ) : (
                              <ChevronDown className="h-3 w-3" />
                            )}
                          </button>
                          <span className="min-w-0 flex-1 truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                            {group.label}
                          </span>
                          <span className="data-mono text-[9px] text-muted-foreground">
                            {group.items.length}
                          </span>
                          <button
                            className="icon-btn-sm"
                            disabled={busyAll || busyGroup !== null || busyOne !== null}
                            onClick={async () => {
                              setBusyGroup(group.key);
                              try {
                                await downloadAllAsZip(group.items, `${safeTitle}-${group.label}`);
                              } finally {
                                setBusyGroup(null);
                              }
                            }}
                            title={t("ui.sceneDownloadModal.downloadGroupZip", {
                              name: group.label,
                            })}
                            aria-label={t("ui.sceneDownloadModal.downloadGroupZip", {
                              name: group.label,
                            })}
                          >
                            {busyGroup === group.key ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Package className="h-3 w-3" />
                            )}
                          </button>
                        </div>
                        {!isCollapsed && (
                          <div className="space-y-1.5 pl-2">
                            {group.items.map((f) => renderFile(f))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

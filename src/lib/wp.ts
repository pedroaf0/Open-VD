/**
 * Runtime bridge between the React viewer and the WordPress plugin.
 *
 * When the app runs inside WordPress, the plugin prints a global
 * `window.V_DICOM` object with the REST base, a nonce and the current
 * scene key. Outside WordPress (standalone) the app keeps
 * working as a purely local viewer.
 */

import { useState, useEffect } from "react";
import i18n from "@/i18n";
import { expandArchives, isZipBuffer, type ExpandProgress, type ExpandInput } from "@/lib/zip";
import type { Annotation } from "@/lib/annotations";

export type SegmentationType = {
  id: string;
  name: string;
  description: string;
  cost: number;
  enabled?: boolean;
};

export type WpConfig = {
  restUrl: string;
  nonce: string;
  canUpload: boolean;
  sceneKey: string | null;
  homeUrl: string;
  viewerUrl: string;
  shareTemplate?: string;
  brand?: {
    name?: string;
    logo?: string;
    quizUrl?: string;
    quizText?: string;
  };
  /** URL da loja WooCommerce, quando o plugin está ativo no site. */
  shopUrl?: string;
  /** URL da página de login do WordPress (com retorno ao visualizador). */
  loginUrl?: string;
  /** Limite de upload do PHP em bytes (0 = desconhecido). */
  uploadLimit?: number;
  /** URL do proxy para links cross-origin (Google Drive, OneDrive). */
  downloadUrl?: string;
  /** Whether URL authorization (credit consumption) is enforced by admin. */
  urlAuthEnabled?: boolean;
  /** Cost in credits to run segmentation (admin config). */
  segmentationCost?: number;
  segmentationTypes?: SegmentationType[];
  /** WordPress site locale (`get_locale()`), used as the viewer language. */
  locale?: string;
};

export type SceneFile = {
  name: string;
  url: string;
  kind: "dicom" | "mesh";
  size?: number;
};

export type MeshSetting = {
  name: string;
  color: string;
  visible: boolean;
  opacity: number;
  coordSystem?: "lps" | "ras";
};

export type SceneSettings = {
  wc: number;
  ww: number;
  invert: boolean;
  cross: { x: number; y: number; z: number };
  /** matriz de rotacao 3x3 (row-major) da reorientacao multiplanar (legado) */
  orient?: number[];
  /** origem + eixos de cada plano de reslice (MPR obliquo) */
  planes?: Record<
    "axial" | "coronal" | "sagittal",
    { origin: number[]; u: number[]; v: number[]; n: number[] }
  >;
  threshold: number;
  opacity: number;
  showVolume: boolean;
  showPlanes: { axial: boolean; coronal: boolean; sagittal: boolean };
  meshRas?: boolean;
  meshes: MeshSetting[];
  /** URLs de onde a cena foi carregada (arquivos não são armazenados no servidor) - array para múltiplas origens */
  urls: string[];
  /** URL legado (única string) - mantido para compatibilidade com cenas antigas */
  url?: string;
};

export type Scene = {
  key: string;
  title: string;
  settings: Partial<SceneSettings> | null;
  files: SceneFile[];
  urls: string[];
  annotations: Annotation[];
};

export type SceneSummary = {
  key: string;
  title: string;
  fileCount: number;
  bytes: number;
  created: string;
  segmentationUsed?: boolean;
  segmentationStatus?: string | null;
  segmentations?: Record<string, string>;
  isOwn?: boolean;
  accessedAt?: number;
};

export type StorageInfo = {
  limitBytes: number;
  usedBytes: number;
  availableBytes: number;
  blocked: boolean;
};

/** Plano de armazenamento comprado (expiração independente por plano). */
export type StoragePlan = {
  mb: number;
  months: number;
  grantedAt: number;
  expiresAt: number;
};

export type UserPanel = {
  isLoggedIn: boolean;
  displayName: string;
  isAdmin: boolean;
  credits: number;
  storage: StorageInfo;
  scenes: SceneSummary[];
  storagePlans?: StoragePlan[];
};

export type AuthorizeUrlResponse = {
  authorized: boolean;
  already_authorized?: boolean;
  will_consume_credit?: boolean;
  credits_available?: number;
  credits_after?: number;
  credits_used_total?: number;
  storage_available?: number;
  has_credit?: boolean;
  shop_url?: string;
  current_credits?: number;
  message?: string;
};

type RawWpConfig = Partial<WpConfig> & {
  /** Flag que indica uma config criptografada pelo plugin. */
  e?: number;
  iv?: string;
  d?: string;
};

declare global {
  interface Window {
    V_DICOM?: RawWpConfig;
    /**
     * WordPress site locale, printed in clear text by the plugin because the
     * rest of the config is encrypted (and therefore only available later).
     */
    V_DICOM_LOCALE?: string;
  }
}

let _wpReady: Promise<void> | null = null;

export function wpConfig(): WpConfig | null {
  if (typeof window === "undefined") return null;
  const raw = window.V_DICOM;
  if (raw && raw.e === 1 && !raw.restUrl && !_wpReady) {
    _wpReady = decryptWindowConfig();
  }
  if (!raw || !raw.restUrl) return null;
  const cfg: WpConfig = {
    restUrl: raw.restUrl.replace(/\/$/, ""),
    nonce: raw.nonce ?? "",
    canUpload: !!raw.canUpload,
    sceneKey: raw.sceneKey || null,
    homeUrl: raw.homeUrl ?? "",
    viewerUrl: raw.viewerUrl ?? "",
    shareTemplate: raw.shareTemplate ?? "",
  };
  if (raw.locale) {
    cfg.locale = raw.locale;
  }
  if (raw.brand) {
    cfg.brand = {
      name: raw.brand.name ?? "",
      logo: raw.brand.logo ?? "",
      quizUrl: raw.brand.quizUrl ?? "",
      quizText: raw.brand.quizText ?? "",
    };
  }
  if (raw.shopUrl) {
    cfg.shopUrl = raw.shopUrl;
  }
  if (raw.loginUrl) {
    cfg.loginUrl = raw.loginUrl;
  }
  if (typeof raw.uploadLimit === "number" && raw.uploadLimit > 0) {
    cfg.uploadLimit = raw.uploadLimit;
  }
  if (raw.downloadUrl) {
    cfg.downloadUrl = raw.downloadUrl;
  }
  if (typeof raw.urlAuthEnabled === "boolean") {
    cfg.urlAuthEnabled = raw.urlAuthEnabled;
  }
  if (typeof raw.segmentationCost === "number") {
    cfg.segmentationCost = Math.max(0, Math.floor(raw.segmentationCost));
  }
  if (Array.isArray(raw.segmentationTypes)) {
    cfg.segmentationTypes = (raw.segmentationTypes as unknown[])
      .filter(
        (
          t,
        ): t is {
          id: string;
          name: string;
          description?: unknown;
          cost?: unknown;
          enabled?: unknown;
        } =>
          !!t &&
          typeof t === "object" &&
          typeof (t as { id?: unknown }).id === "string" &&
          typeof (t as { name?: unknown }).name === "string",
      )
      .map((t) => ({
        id: t.id,
        name: t.name,
        description: String(t.description ?? ""),
        cost: Math.max(0, Math.floor(Number(t.cost ?? 0))),
        enabled: t.enabled !== false,
      }));
  }
  return cfg;
}

function sha256Bytes(s: string): Promise<Uint8Array> {
  return crypto.subtle
    .digest("SHA-256", new TextEncoder().encode(s))
    .then((b) => new Uint8Array(b));
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function aesCbcDecrypt(
  cipher: Uint8Array,
  keyBytes: Uint8Array,
  iv: Uint8Array,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes as BufferSource,
    { name: "AES-CBC" },
    false,
    ["decrypt"],
  );
  const plain = await crypto.subtle.decrypt(
    { name: "AES-CBC", iv: iv as BufferSource },
    key,
    cipher as BufferSource,
  );
  return new Uint8Array(plain);
}

async function decryptWindowConfig(): Promise<void> {
  const raw = window.V_DICOM;
  if (!raw || raw.e !== 1 || !raw.iv || !raw.d) return;
  try {
    const host = window.location.hostname;
    const key = await sha256Bytes(host);
    const iv = base64ToBytes(raw.iv);
    const cipher = base64ToBytes(raw.d);
    const plain = await aesCbcDecrypt(cipher, key, iv);
    const parsed = JSON.parse(new TextDecoder().decode(plain)) as Partial<RawWpConfig>;
    Object.assign(raw, parsed);
  } catch (err) {
    console.error("Falha ao descriptografar V_DICOM:", err);
  }
}

export async function initWpConfig(): Promise<void> {
  if (typeof window !== "undefined") await decryptWindowConfig();
}

export async function wpConfigAsync(): Promise<WpConfig | null> {
  await initWpConfig();
  return wpConfig();
}

export function useWpConfig(): WpConfig | null {
  const [cfg, setCfg] = useState<WpConfig | null>(null);
  useEffect(() => {
    initWpConfig().then(() => setCfg(wpConfig()));
  }, []);
  return cfg;
}

/** Scene key coming from the URL (?scene=xxx or /key/) or from the WP config. */
export function currentSceneKey(): string | null {
  if (typeof window === "undefined") return null;
  // First check query string (?scene=xxx)
  const fromUrl = new URLSearchParams(window.location.search).get("scene");
  if (fromUrl) return fromUrl;
  // Then check pathname: structure is always /base/key where key is optional
  // e.g. /v-dicom/ = new scene, /v-dicom/abc123/ = scene abc123
  const segments = window.location.pathname.replace(/^\//, "").split("/").filter(Boolean);
  const raw = window.V_DICOM;
  if (raw && raw.e === 1 && !raw.restUrl && !_wpReady) {
    _wpReady = decryptWindowConfig();
  }
  // The key is the segment after the base path (segment index 1, index 0 is the base)
  // If only 1 segment (just base), it's a new empty scene -> return null
  if (segments.length >= 2) {
    // Skip the base path segment (segments[0]) and return the key (segments[1])
    return segments[1] || null;
  }
  // If only base path or empty, it's a new scene - but also check WP config as fallback
  return raw?.sceneKey || null;
}

export function shareUrl(key: string): string {
  const cfg = wpConfig();
  if (cfg?.shareTemplate) return cfg.shareTemplate.replace("ZZKEYZZ", encodeURIComponent(key));
  const base =
    cfg?.viewerUrl || (typeof window !== "undefined" ? window.location.href.split("?")[0]! : "");
  return `${base}${base.includes("?") ? "&" : "?"}scene=${encodeURIComponent(key)}`;
}

function headers(cfg: WpConfig, json = false): HeadersInit {
  const h: Record<string, string> = {};
  if (cfg.nonce) h["X-WP-Nonce"] = cfg.nonce;
  if (json) h["Content-Type"] = "application/json";
  return h;
}

async function ok<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text();
    throw new Error(i18n.t("lib.wp.httpError", { status: res.status, detail: body.slice(0, 300) }));
  }
  return (await res.json()) as T;
}

export async function fetchScene(key: string): Promise<Scene> {
  const cfg = wpConfig();
  const base = cfg?.restUrl ?? "/wp-json/v-dicom/v1";
  const res = await fetch(
    `${base}/scenes/${encodeURIComponent(key)}`,
    cfg ? { headers: headers(cfg) } : {},
  );
  const raw = await ok<{
    key: string;
    title: string;
    settings: Partial<SceneSettings>;
    files: SceneFile[];
    urls?: string[];
    annotations?: Annotation[];
  }>(res);
  // Converte url único (legado) para array urls - garante que urls sempre é string[]
  const urlsList: string[] = raw.urls || (raw.settings?.url ? [raw.settings.url] : []);
  return {
    key: key,
    title: raw.title || "",
    settings: raw.settings
      ? {
          ...raw.settings,
          // Garantir que urls é sempre um array string
          urls: urlsList.length > 0 ? urlsList : raw.settings?.urls || [],
        }
      : null,
    files: raw.files,
    urls: urlsList,
    annotations: raw.annotations ?? [],
  };
}

/**
 * Solicita a autorização de uma URL de origem externa (Google Drive, OneDrive).
 * Consome 1 crédito na primeira autorização; acessos subsequentes são gratuitos.
 * Lança um erro com a URL da loja quando o usuário não tem créditos.
 *
 * O fluxo de dois passos (dry_run → confirmação → consumo) permite que a UI
 * mostre um modal de confirmação antes de realmente consumir um crédito.
 */
export async function authorizeUrl(
  url: string,
  onConfirmCredit?: (resp: AuthorizeUrlResponse) => Promise<boolean>,
): Promise<AuthorizeUrlResponse> {
  const cfg = wpConfig();
  if (!cfg) throw new Error(i18n.t("lib.wp.authorizeUnavailable"));

  // Passo 1: dry-run — verifica se a URL já está autorizada e se há créditos,
  // sem consumir nada.
  const res = await fetch(`${cfg.restUrl}/authorized-url`, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      ...headers(cfg, true),
    },
    body: JSON.stringify({ url, dry_run: true }),
  });
  if (!res.ok) {
    throw new Error(i18n.t("lib.wp.httpError", { status: res.status, detail: await res.text() }));
  }
  const data = (await res.json()) as AuthorizeUrlResponse;

  if (!data.authorized) {
    const shopUrl = data.shop_url || cfg.shopUrl || "";
    const msg = data.message || i18n.t("lib.wp.urlNotAuthorized");
    throw new AuthorizeUrlError(msg, shopUrl, data.current_credits ?? 0);
  }

  // Se já está autorizada, não há crédito para confirmar — retorna direto.
  if (data.already_authorized) {
    return data;
  }

  // Passo 2: a URL não está autorizada e será consumido 1 crédito.
  // Pergunta ao usuário antes de confirmar.
  if (onConfirmCredit) {
    const confirmed = await onConfirmCredit(data);
    if (!confirmed) {
      throw new AuthorizeUrlError(
        i18n.t("lib.wp.authCancelled"),
        "",
        data.current_credits ?? data.credits_available ?? 0,
      );
    }
  } else {
    // Sem callback de confirmação, pergunta via window.confirm.
    const confirmed = window.confirm(
      i18n.t("lib.wp.confirmAuthorize", {
        credits: data.current_credits ?? data.credits_available ?? "?",
      }),
    );
    if (!confirmed) {
      throw new AuthorizeUrlError(i18n.t("lib.wp.authCancelled"), "", 0);
    }
  }

  // Passo 3: confirma — consome o crédito e autoriza a URL.
  const res2 = await fetch(`${cfg.restUrl}/authorized-url`, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      ...headers(cfg, true),
    },
    body: JSON.stringify({ url, dry_run: false }),
  });
  if (!res2.ok) {
    throw new Error(i18n.t("lib.wp.httpError", { status: res2.status, detail: await res2.text() }));
  }
  const data2 = (await res2.json()) as AuthorizeUrlResponse;

  if (!data2.authorized) {
    const shopUrl = data2.shop_url || cfg.shopUrl || "";
    throw new AuthorizeUrlError(
      data2.message || i18n.t("lib.wp.authorizeFailed"),
      shopUrl,
      data2.current_credits ?? 0,
    );
  }

  return data2;
}

/** Thrown when a URL cannot be authorized because the user has no credits. */
export class AuthorizeUrlError extends Error {
  constructor(
    message: string,
    public readonly shopUrl: string,
    public readonly currentCredits: number,
  ) {
    super(message);
    this.name = "AuthorizeUrlError";
  }
}

/** Storage usage + the list of the current user's scenes. */
export async function fetchUserPanel(): Promise<UserPanel> {
  const cfg = wpConfig();
  if (!cfg) throw new Error(i18n.t("lib.wp.scenePanelUnavailable"));
  const res = await fetch(`${cfg.restUrl}/me`, { headers: headers(cfg) });
  return ok<UserPanel>(res);
}

export async function deleteScene(key: string): Promise<{ ok: true }> {
  const cfg = wpConfig();
  if (!cfg) throw new Error(i18n.t("lib.wp.deleteScenesUnavailable"));
  const res = await fetch(`${cfg.restUrl}/scenes/${encodeURIComponent(key)}`, {
    method: "DELETE",
    credentials: "same-origin",
    headers: headers(cfg),
  });
  return ok<{ ok: true }>(res);
}

export async function createScene(title: string): Promise<{ key: string; id: number }> {
  const cfg = wpConfig();
  if (!cfg) throw new Error(i18n.t("lib.wp.saveScenesUnavailable"));
  const res = await fetch(`${cfg.restUrl}/scenes`, {
    method: "POST",
    credentials: "same-origin",
    headers: headers(cfg, true),
    body: JSON.stringify({ title }),
  });
  return ok<{ key: string; id: number }>(res);
}

/** Step 1 — open an upload session (a folder) before any file is sent. */
export async function startUpload(): Promise<{ token: string }> {
  const cfg = wpConfig();
  if (!cfg) throw new Error(i18n.t("lib.wp.shareUnavailable"));
  const res = await fetch(`${cfg.restUrl}/uploads`, {
    method: "POST",
    credentials: "same-origin",
    headers: headers(cfg, true),
    body: "{}",
  });
  return ok<{ token: string }>(res);
}

/** Step 2 — send one file and get back its public link. */
export async function uploadToSession(token: string, file: File): Promise<SceneFile> {
  const cfg = wpConfig();
  if (!cfg) throw new Error(i18n.t("lib.wp.uploadUnavailable"));
  const form = new FormData();
  form.append("file", file, file.name);
  const res = await fetch(`${cfg.restUrl}/uploads/${encodeURIComponent(token)}/files`, {
    method: "POST",
    credentials: "same-origin",
    headers: headers(cfg),
    body: form,
  });
  return ok<SceneFile>(res);
}

/**
 * Envia um arquivo para a sessão, dividindo em chunks se ele passar do limite
 * de upload do servidor. Cada chunk é enviado como um arquivo separado com
 * o nome `nome.NofMpart`; o servidor junta tudo quando o último chega.
 */
export async function uploadToSessionSmart(token: string, file: File): Promise<SceneFile> {
  const cfg = wpConfig();
  if (!cfg) throw new Error(i18n.t("lib.wp.uploadUnavailable"));

  const max = cfg.uploadLimit && cfg.uploadLimit > 0 ? cfg.uploadLimit : 0;
  // Só divide se soubermos o limite E o arquivo passar dele (com margem de 1 MB).
  if (!max || file.size <= max) {
    return uploadToSession(token, file);
  }

  // Margem para o nome `.NofMpart` e overhead multipart.
  const chunk = Math.max(1024 * 1024, max - 1024 * 1024);
  const parts = Math.ceil(file.size / chunk);
  const baseName = file.name;
  const finalName = file.name;

  let resolved: SceneFile | undefined;

  for (let i = 1; i <= parts; i++) {
    const start = (i - 1) * chunk;
    const end = Math.min(file.size, i * chunk);
    const blob = file.slice(start, end);
    const partFile = new File([blob], `${baseName}.${i}of${parts}part`, {
      type: "application/octet-stream",
    });

    const form = new FormData();
    form.append("file", partFile, partFile.name);
    const res = await fetch(`${cfg.restUrl}/uploads/${encodeURIComponent(token)}/files`, {
      method: "POST",
      credentials: "same-origin",
      headers: headers(cfg),
      body: form,
    });
    const data = await ok<SceneFile & { chunk?: boolean; finalName?: string }>(res);

    if (i === parts || data.chunk !== true) {
      resolved = {
        name: data.finalName || finalName,
        url: data.url,
        kind: data.kind,
        size: data.size ?? 0,
      };
    }
  }

  if (!resolved) {
    throw new Error(i18n.t("lib.wp.splitUploadFailed"));
  }
  return resolved;
}

/** Step 3 — create the scene with every link, the settings and a custom name. */
export async function createSceneWithFiles(params: {
  token: string;
  title: string;
  files: SceneFile[];
  settings: SceneSettings;
  annotations?: Annotation[];
}): Promise<{ key: string; id: number }> {
  const cfg = wpConfig();
  if (!cfg) throw new Error(i18n.t("lib.wp.saveScenesUnavailable"));
  const res = await fetch(`${cfg.restUrl}/scenes`, {
    method: "POST",
    credentials: "same-origin",
    headers: headers(cfg, true),
    body: JSON.stringify(params),
  });
  return ok<{ key: string; id: number }>(res);
}

export async function uploadSceneFile(key: string, file: File): Promise<SceneFile> {
  const cfg = wpConfig();
  if (!cfg) throw new Error(i18n.t("lib.wp.uploadUnavailable"));
  const max = cfg.uploadLimit && cfg.uploadLimit > 0 ? cfg.uploadLimit : 0;

  // Se passar do limite, usa o mesmo fluxo de chunks do session upload,
  // só que apontando para o endpoint de cena existente.
  if (max && file.size > max) {
    return uploadSceneFileChunked(key, file);
  }

  const form = new FormData();
  form.append("file", file, file.name);
  const res = await fetch(`${cfg.restUrl}/scenes/${encodeURIComponent(key)}/files`, {
    method: "POST",
    credentials: "same-origin",
    headers: headers(cfg),
    body: form,
  });
  return ok<SceneFile>(res);
}

async function uploadSceneFileChunked(key: string, file: File): Promise<SceneFile> {
  const cfg = wpConfig();
  if (!cfg) throw new Error(i18n.t("lib.wp.uploadUnavailable"));
  const max = cfg.uploadLimit && cfg.uploadLimit > 0 ? cfg.uploadLimit : 0;
  const chunk = Math.max(1024 * 1024, max - 1024 * 1024);
  const parts = Math.ceil(file.size / chunk);
  const baseName = file.name;
  const finalName = file.name;

  let resolved: SceneFile | undefined;

  for (let i = 1; i <= parts; i++) {
    const start = (i - 1) * chunk;
    const end = Math.min(file.size, i * chunk);
    const partFile = new File([file.slice(start, end)], `${baseName}.${i}of${parts}part`, {
      type: "application/octet-stream",
    });
    const form = new FormData();
    form.append("file", partFile, partFile.name);
    const res = await fetch(`${cfg.restUrl}/scenes/${encodeURIComponent(key)}/files`, {
      method: "POST",
      credentials: "same-origin",
      headers: headers(cfg),
      body: form,
    });
    const data = await ok<SceneFile & { chunk?: boolean; finalName?: string }>(res);
    if (i === parts || data.chunk !== true) {
      resolved = {
        name: data.finalName || finalName,
        url: data.url,
        kind: data.kind,
        size: data.size ?? 0,
      };
    }
  }
  if (!resolved) throw new Error(i18n.t("lib.wp.splitUploadFailed"));
  return resolved;
}

export async function saveSceneSettings(
  key: string,
  settings: SceneSettings,
  title?: string,
  annotations?: Annotation[],
): Promise<{ ok: true }> {
  const cfg = wpConfig();
  if (!cfg) throw new Error(i18n.t("lib.wp.saveScenesUnavailable"));
  const res = await fetch(`${cfg.restUrl}/scenes/${encodeURIComponent(key)}/settings`, {
    method: "POST",
    credentials: "same-origin",
    headers: headers(cfg, true),
    body: JSON.stringify({ settings, title, annotations }),
  });
  return ok<{ ok: true }>(res);
}

/** Inicia a segmentação automática de uma cena (consome créditos do tipo). */
export async function runSegmentation(
  key: string,
  typeId?: string,
): Promise<{ job_id: string; status: string; type?: string }> {
  const cfg = wpConfig();
  if (!cfg) throw new Error(i18n.t("lib.wp.segmentationUnavailable"));
  const res = await fetch(`${cfg.restUrl}/scenes/${encodeURIComponent(key)}/run`, {
    method: "POST",
    credentials: "same-origin",
    headers: headers(cfg, true),
    body: JSON.stringify(typeId ? { type: typeId, type_id: typeId } : {}),
  });
  return ok<{ job_id: string; status: string; type?: string }>(res);
}

/** Consulta o status do job de segmentação no RunPod. */
export async function fetchSegmentationStatus(
  key: string,
  typeId?: string,
): Promise<{ status: string; type?: string; segmentations?: Record<string, string> }> {
  const cfg = wpConfig();
  if (!cfg) throw new Error(i18n.t("lib.wp.segmentationUnavailable"));
  const qs = typeId ? `?type=${encodeURIComponent(typeId)}` : "";
  const res = await fetch(
    `${cfg.restUrl}/scenes/${encodeURIComponent(key)}/segmentation-status${qs}`,
    {
      headers: headers(cfg),
    },
  );
  return ok<{ status: string; type?: string; segmentations?: Record<string, string> }>(res);
}

/** Envia o PNG de uma anotação para a pasta da cena/sessão e devolve a URL. */
export async function uploadAnnotationPng(
  dest: { token: string } | { sceneKey: string },
  blob: Blob,
  id: string,
): Promise<{ url: string }> {
  const cfg = wpConfig();
  if (!cfg) throw new Error(i18n.t("lib.wp.saveAnnotationsUnavailable"));
  const path =
    "token" in dest
      ? `/uploads/${encodeURIComponent(dest.token)}/annotations`
      : `/scenes/${encodeURIComponent(dest.sceneKey)}/annotations`;
  const form = new FormData();
  form.append("file", blob, `anno-${id}.png`);
  const res = await fetch(`${cfg.restUrl}${path}`, {
    method: "POST",
    credentials: "same-origin",
    headers: headers(cfg),
    body: form,
  });
  return ok<{ url: string }>(res);
}

/** Marca uma cena como acessada pelo usuário atual. */
export async function markSceneAccessed(key: string): Promise<{ success: boolean }> {
  const cfg = wpConfig();
  if (!cfg) throw new Error(i18n.t("lib.wp.markAccessUnavailable"));
  const res = await fetch(`${cfg.restUrl}/scenes/${encodeURIComponent(key)}/access`, {
    method: "POST",
    credentials: "same-origin",
    headers: headers(cfg),
  });
  return ok<{ success: boolean }>(res);
}

/** Obtém cenas acessadas recentemente pelo usuário. */
export async function fetchRecentScenes(): Promise<SceneSummary[]> {
  const cfg = wpConfig();
  if (!cfg) throw new Error(i18n.t("lib.wp.recentScenesUnavailable"));
  const res = await fetch(`${cfg.restUrl}/me/recent-scenes`, {
    headers: headers(cfg),
  });
  return ok<SceneSummary[]>(res);
}

/** Progresso do download de uma cena: bytes transferidos, total e velocidade. */
export type SceneDownloadProgress = {
  /** Itens processados até agora (arquivos baixados). */
  done: number;
  /** Total de itens da fase atual. */
  total: number;
  /** Rótulo curto para a interface. */
  label: string;
  /** Bytes já transferidos no download. */
  receivedBytes: number;
  /** Total de bytes a transferir (0 se o tamanho for desconhecido). */
  totalBytes: number;
  /** Velocidade média dos últimos 5 segundos em bytes/segundo. */
  speedBps: number;
};

/**
 * Download every file of a scene and turn it into Files (after decompressing
 * any ZIP). Internally we keep each downloaded file's bytes as `{ name, data }`
 * instead of a huge `File`, because re-reading `File.arrayBuffer()` of a few
 * hundred MB fails on iOS (NotReadableError/NotFoundError).
 */
export async function downloadSceneFiles(
  scene: Scene,
  onProgress?: (p: SceneDownloadProgress) => void,
): Promise<File[]> {
  // Bytes de cada arquivo mantidos em memória como `{ name, data }` — só viram
  // `File` os arquivos realmente pequenos (já descompactados) mais adiante.
  const files: ExpandInput[] = [];
  const total = scene.files.length;
  let receivedBytes = 0;
  const knownBytes = scene.files.reduce((acc, f) => acc + (f.size && f.size > 0 ? f.size : 0), 0);

  // Velocidade calculada em uma janela fixa de 5 segundos (mais estável).
  const WINDOW_MS = 5000;
  let windowBytes = 0;
  let windowStart = performance.now();
  let speedBps = 0;
  const report = (done: number, label: string) => {
    const now = performance.now();
    const elapsed = (now - windowStart) / 1000;
    if (elapsed >= WINDOW_MS / 1000) {
      // Fecha a janela de 5s e a média vira a velocidade exibida.
      speedBps = windowBytes / Math.max(0.001, elapsed);
      windowBytes = 0;
      windowStart = now;
    }
    onProgress?.({
      done,
      total,
      label,
      receivedBytes,
      totalBytes: knownBytes,
      speedBps,
    });
  };

  for (let i = 0; i < total; i++) {
    const f = scene.files[i]!;
    report(i, i18n.t("lib.wp.downloadingSceneFiles"));
    const res = await fetch(f.url);
    if (!res.ok) continue;
    // Acumula cópias estáveis de cada chunk da stream (o buffer interno do WebKit
    // é reutilizado/liberado assim que o reader avança).
    const parts: Uint8Array[] = [];
    if (res.body) {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value && value.byteLength > 0) {
          parts.push(new Uint8Array(value));
          receivedBytes += value.byteLength;
          windowBytes += value.byteLength;
          report(i + 1, i18n.t("lib.wp.downloadingSceneFiles"));
        }
      }
    } else {
      const buf = await res.arrayBuffer();
      parts.push(new Uint8Array(buf));
      receivedBytes += buf.byteLength;
      windowBytes += buf.byteLength;
    }
    report(i + 1, i18n.t("lib.wp.downloadingSceneFiles"));

    // IMPORTANTE (Safari iOS): montar um `File` a partir de MUITOS BlobParts
    // (centenas de chunks pequenos) pode gerar um File "fantasma" no iPhone,
    // cujo `arrayBuffer()` lança NotReadableError/NotFoundError mais tarde.
    // Concatenamos tudo num ÚNICO Uint8Array contíguo e criamos o File com um
    // único part — comportamento robusto no WebKit.
    const totalBytes = parts.reduce((acc, p) => acc + p.byteLength, 0);
    const full = new Uint8Array(totalBytes);
    let off = 0;
    for (const p of parts) {
      full.set(p, off);
      off += p.byteLength;
    }
    console.info(
      `[dl-debug] download "${f.name}": ${parts.length} parte(s) -> bytes ${full.byteLength} em memória (sem File/arrayBuffer)`,
    );
    // Guardamos os bytes em memória — NÃO criamos um `File` aqui, para evitar o
    // `File.arrayBuffer()` de ~300 MB que falha no iOS.
    files.push({ name: f.name, data: full });
  }

  const emit = (p: ExpandProgress) =>
    onProgress?.({
      done: p.done,
      total: p.total,
      label: p.label,
      receivedBytes,
      totalBytes: knownBytes,
      speedBps,
    });

  const rawFiles = files.slice();
  console.info(
    `[debug] downloadSceneFiles: baixou ${rawFiles.length} arquivo(s) ->`,
    rawFiles.map((f) => `${f.name} (${"data" in f ? f.data.length : f.size} bytes)`),
  );
  // Expand any ZIP files (decompression is streamed, one entry at a time).
  let expanded = await expandArchives(files, emit);
  console.info(`[debug] expandArchives (1ª passada) -> ${expanded.length} arquivo(s)`);
  // Fallback de re-tentativa: se nada saiu da descompactação, tenta de novo
  // forçando o decoder puro em JS (fflate), mais resistente.
  if (expanded.length === 0 && rawFiles.some((f) => /\.zip$/i.test(f.name))) {
    console.warn("Descompactação não produziu arquivos; tentando fallback forçado.");
    expanded = await expandArchives(files, emit, { forceJs: true });
    console.info(`[debug] expandArchives (forçada) -> ${expanded.length} arquivo(s)`);
  }
  return expanded;
}

/**
 * Baixa os bytes de uma URL e expande qualquer ZIP — exatamente como o download
 * de cena (`downloadSceneFiles`): streaming com porcentagem, bytes em memória
 * (sem `File.arrayBuffer()` gigante, que falha no iOS) e re-tentativa `forceJs`.
 * Devolve os arquivos já descompactados (Files, normalmente DICOMs/STLs).
 *
 * Cross-origin links (Google Drive, OneDrive, etc.) são roteados para o proxy
 * do plugin (download.php) para contornar restrições de CORS/Referrer-Policy.
 */
export type UrlProgress = {
  label: string;
  done: number;
  total: number;
  receivedBytes: number;
  totalBytes: number;
  speedBps: number;
};

export async function fetchUrlFiles(
  url: string,
  onProgress?: (label: string) => void,
  onConfirmCredit?: (resp: AuthorizeUrlResponse) => Promise<boolean>,
  onBytes?: (p: UrlProgress) => void,
): Promise<File[]> {
  // Detecta serviços que requerem proxy (Google Drive, OneDrive)
  const host = url ? new URL(url).hostname.toLowerCase() : "";
  const isGoogle =
    host === "drive.google.com" ||
    host === "docs.google.com" ||
    host === "drive.usercontent.google.com";
  const isOneDrive =
    host === "1drv.ms" ||
    host === "onedrive.live.com" ||
    host === "onedrive.com" ||
    host.endsWith(".onedrive.live.com");

  const cfg = wpConfig();
  const proxyUrl = cfg?.downloadUrl;
  const useProxy = (isGoogle || isOneDrive) && !!proxyUrl;

  // Garante que a URL está autorizada antes de passar pelo proxy.
  // A autorização consome 1 crédito na primeira vez; downloads subsequentes são gratuitos.
  // Se o admin desativou a exigência de autorização, pula a etapa.
  if (useProxy && cfg?.urlAuthEnabled !== false) {
    onProgress?.(i18n.t("lib.wp.checkingUrlAuth"));
    try {
      await authorizeUrl(url, onConfirmCredit);
    } catch (e) {
      if (e instanceof AuthorizeUrlError) {
        throw e; // Propaga para que a UI redirecione para a loja
      }
      // Se o proxy retornar 403 (fallback), tenta autorizar novamente
      throw new AuthorizeUrlError(i18n.t("lib.wp.authorizeCheckFailed"), cfg?.shopUrl || "", 0);
    }
  }

  const targetUrl = useProxy
    ? `${proxyUrl}?url=${encodeURIComponent(url)}&_wpnonce=${encodeURIComponent(cfg?.nonce ?? "")}`
    : url;

  const res = await fetch(targetUrl);
  if (!res.ok) throw new Error(i18n.t("lib.wp.downloadFailed", { status: res.status }));
  const total = Number(res.headers.get("content-length")) || 0;
  // O nome real costuma vir no header Content-Disposition (a URL pode terminar
  // em query string, ex.: "...?e=T63Oik" — então o último segmento não é o nome).
  let name = "";
  try {
    name =
      res.headers
        .get("content-disposition")
        ?.match(/filename="?([^";\n]+)"?/i)?.[1]
        ?.trim() ?? "";
  } catch {
    /* ignora */
  }
  if (!name) {
    const rawName = url.split(/[/?#]/).filter(Boolean).pop() ?? i18n.t("lib.wp.fallbackFileName");
    try {
      name = decodeURIComponent(rawName);
    } catch {
      name = rawName;
    }
  }

  const parts: Uint8Array[] = [];
  let received = 0;
  const report = () => {
    onProgress?.(
      total > 0
        ? i18n.t("lib.wp.downloadingUrlFilePct", {
            percent: Math.min(100, Math.round((received / total) * 100)),
          })
        : i18n.t("lib.wp.downloadingUrlFileMb", { mb: (received / 1048576).toFixed(1) }),
    );
    onBytes?.({
      label: "URL",
      done: 1,
      total: 1,
      receivedBytes: received,
      totalBytes: total,
      speedBps: total > 0 ? received / 1 : 0,
    });
  };
  if (res.body) {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.byteLength > 0) {
        parts.push(new Uint8Array(value));
        received += value.byteLength;
        report();
      }
    }
  } else {
    const ab = await res.arrayBuffer();
    parts.push(new Uint8Array(ab));
    received += ab.byteLength;
  }
  report();
  const data = new Uint8Array(received);
  let off = 0;
  for (const p of parts) {
    data.set(p, off);
    off += p.byteLength;
  }
  console.info(`[dl-url] baixado "${name}": ${data.length} bytes`);

  const emit = (p: ExpandProgress) => onProgress?.(`${p.label} ${p.done}/${p.total}`);
  let expanded = await expandArchives([{ name, data }], emit);
  console.info(`[dl-url] expand (1ª passada) -> ${expanded.length} arquivo(s)`);
  if (expanded.length === 0 && isZipBuffer(data)) {
    console.warn("[dl-url] nada expandido; tentando descompactação forçada.");
    expanded = await expandArchives([{ name, data }], emit, { forceJs: true });
    console.info(`[dl-url] expand (forçada) -> ${expanded.length} arquivo(s)`);
  }
  return expanded;
}

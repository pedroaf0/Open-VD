import { useSyncExternalStore } from "react";

export const RENDER_MODES = ["balanced", "precise", "fast"] as const;

export type RenderMode = (typeof RENDER_MODES)[number];

export const DEFAULT_RENDER_MODE: RenderMode = "balanced";

const STORAGE_KEY = "openvd:transparency-mode:v1";

const listeners = new Set<() => void>();

let currentMode: RenderMode = DEFAULT_RENDER_MODE;
let initialized = false;

function isRenderMode(value: unknown): value is RenderMode {
  return typeof value === "string" && (RENDER_MODES as readonly string[]).includes(value);
}

function readStoredMode(): RenderMode {
  if (typeof window === "undefined") return DEFAULT_RENDER_MODE;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isRenderMode(stored) ? stored : DEFAULT_RENDER_MODE;
  } catch {
    return DEFAULT_RENDER_MODE;
  }
}

function ensureInitialized(): void {
  if (initialized || typeof window === "undefined") return;
  currentMode = readStoredMode();
  initialized = true;
}

export function getRenderMode(): RenderMode {
  ensureInitialized();
  return currentMode;
}

export function setRenderMode(mode: RenderMode): void {
  if (!isRenderMode(mode)) return;
  ensureInitialized();
  if (mode === currentMode) return;
  currentMode = mode;
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* armazenamento indisponível: mantém a escolha apenas na sessão */
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getServerSnapshot(): RenderMode {
  return DEFAULT_RENDER_MODE;
}

/** Modo de renderização compartilhado por todas as vistas 3D do aplicativo. */
export function useRenderMode(): RenderMode {
  return useSyncExternalStore(subscribe, getRenderMode, getServerSnapshot);
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) return;
    currentMode = readStoredMode();
    initialized = true;
    for (const listener of listeners) listener();
  });
}

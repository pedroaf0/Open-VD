/**
 * i18next setup shared by the standalone app and the WordPress embed.
 *
 * Translation resources are JSON files under `locales/<language>/`, assembled
 * from every `*.json` area file (e.g. `common.json`, `viewer.json`,
 * `lib.json`). Each file becomes a top-level key, so `viewer.json` ships the
 * `viewer.*` keys.
 *
 * Language resolution order (client side):
 *   1. explicit choice saved in localStorage
 *   2. browser languages (`navigator.language(s)`)
 *   3. WordPress locale (`window.V_DICOM_LOCALE`) when embedded
 *   4. default language (pt-BR)
 *
 * Server-side rendering always uses the default language; the client applies
 * the detected language right after hydration (see `__root.tsx`).
 */
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  SUPPORTED_LANGUAGES,
  htmlLang,
  normalizeLanguage,
  type Language,
} from "./languages";

type Resources = Record<string, { translation: Record<string, unknown> }>;

const modules = import.meta.glob("./locales/*/*.json", { eager: true }) as Record<
  string,
  { default: Record<string, unknown> }
>;

function buildResources(): Resources {
  const resources: Resources = {};
  for (const [path, mod] of Object.entries(modules)) {
    const match = /\/locales\/([^/]+)\/([^/]+)\.json$/.exec(path);
    if (!match) continue;
    const [, language, area] = match;
    if (!language || !area) continue;
    const bucket = (resources[language] ??= { translation: {} });
    bucket.translation[area] = mod.default;
  }
  return resources;
}

i18n.use(initReactI18next).init({
  resources: buildResources(),
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  supportedLngs: SUPPORTED_LANGUAGES,
  // Keep the exact codes ("pt-BR" stays "pt-BR").
  load: "currentOnly",
  cleanCode: false,
  interpolation: { escapeValue: false },
  returnNull: false,
});

const detector = new LanguageDetector();
detector.init({ order: ["navigator"], caches: [] });

function readStoredLanguage(): Language | null {
  try {
    return normalizeLanguage(window.localStorage.getItem(LANGUAGE_STORAGE_KEY));
  } catch {
    return null;
  }
}

function storeLanguage(lng: Language): void {
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, lng);
  } catch {
    /* storage disabled (private mode) — keep the in-memory choice only */
  }
}

/** Best language for the current environment; `window` is not touched on the server. */
export function detectLanguage(): Language {
  if (typeof window === "undefined") return DEFAULT_LANGUAGE;

  // 1. Explicit choice made through the language selector.
  const stored = readStoredLanguage();
  if (stored) return stored;

  // 2. Browser languages.
  const detected = detector.detect() as string | string[] | undefined;
  const tags = Array.isArray(detected) ? detected : detected ? [detected] : [];
  for (const tag of tags) {
    const match = normalizeLanguage(tag);
    if (match) return match;
  }

  // 3. WordPress locale, when the viewer runs inside WordPress. It is printed
  //    unencrypted (the rest of the config is encrypted at load time), so it
  //    is readable before the first render.
  const fromWordPress =
    normalizeLanguage(window.V_DICOM_LOCALE) ?? normalizeLanguage(window.V_DICOM?.locale);
  if (fromWordPress) return fromWordPress;

  return DEFAULT_LANGUAGE;
}

/** Applies a language to i18n and to `<html lang>`. */
export function applyLanguage(lng: Language, options?: { persist?: boolean }): Language {
  if (i18n.language !== lng) {
    void i18n.changeLanguage(lng);
  }
  if (options?.persist !== false) storeLanguage(lng);
  if (typeof document !== "undefined") {
    document.documentElement.lang = htmlLang(lng);
  }
  return lng;
}

let initialized = false;

/**
 * Idempotent client-side bootstrap: detects the language and activates it.
 * Safe to call before the first React render (WordPress embed) or from an
 * effect (SSR app).
 */
export function initI18n(): Language {
  if (initialized || typeof window === "undefined") {
    return (i18n.language as Language) ?? DEFAULT_LANGUAGE;
  }
  initialized = true;
  return applyLanguage(detectLanguage(), { persist: false });
}

export default i18n;

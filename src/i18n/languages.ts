/** Supported UI languages. Portuguese (Brazil) is the source language. */
export const DEFAULT_LANGUAGE = "pt-BR";

export type Language = "pt-BR" | "en" | "es";

export type LanguageOption = {
  code: Language;
  /** Endonym: always shown in the language itself. */
  label: string;
  flag: string;
};

export const LANGUAGES: LanguageOption[] = [
  { code: "pt-BR", label: "Português (Brasil)", flag: "🇧🇷" },
  { code: "en", label: "English", flag: "🇺🇸" },
  { code: "es", label: "Español", flag: "🇪🇸" },
];

export const SUPPORTED_LANGUAGES = LANGUAGES.map((l) => l.code);

export const LANGUAGE_STORAGE_KEY = "v-dicom.lang";

/**
 * Maps any locale tag (browser `navigator.language`, WordPress `get_locale()`,
 * e.g. `pt_BR`, `pt-PT`, `en-US`, `es-419`) to a supported language.
 */
export function normalizeLanguage(tag: unknown): Language | null {
  if (typeof tag !== "string" || !tag.trim()) return null;
  const lower = tag.trim().toLowerCase().replace(/_/g, "-");
  if (lower === "pt-br" || lower === "pt" || lower.startsWith("pt-")) return "pt-BR";
  if (lower === "en" || lower.startsWith("en-")) return "en";
  if (lower === "es" || lower.startsWith("es-")) return "es";
  return null;
}

const HTML_LANG: Record<Language, string> = {
  "pt-BR": "pt-BR",
  en: "en",
  es: "es",
};

export function htmlLang(lng: Language): string {
  return HTML_LANG[lng];
}

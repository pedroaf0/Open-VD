import { useTranslation } from "react-i18next";
import { Check, Languages } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { applyLanguage } from "@/i18n";
import { LANGUAGES, type Language } from "@/i18n/languages";

/**
 * Language picker. The current language follows the browser / WordPress
 * locale until the user picks one explicitly (then it is remembered).
 */
export function LanguageSwitcher({ className }: { className?: string }) {
  const { t, i18n } = useTranslation();
  const current = i18n.language;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={className ?? "icon-btn"}
          aria-label={t("common.language.title")}
          title={t("common.language.title")}
        >
          <Languages className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="group-title">{t("common.language.label")}</DropdownMenuLabel>
        {LANGUAGES.map((lng) => (
          <DropdownMenuItem
            key={lng.code}
            onSelect={() => applyLanguage(lng.code as Language)}
            className="justify-between"
          >
            <span className="flex items-center gap-2">
              <span aria-hidden>{lng.flag}</span>
              {lng.label}
            </span>
            {current === lng.code && <Check className="h-3.5 w-3.5 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

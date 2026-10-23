import { useTranslation } from "react-i18next";
import { LogIn, Loader2, ExternalLink } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

type LoginRequiredModalProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** URL de login do WordPress (já contém o redirect para voltar à cena) */
  loginUrl: string;
  /** Callback quando o usuário clica em "Fazer login" */
  onLoginClick: () => void;
  /** Estado de polling - se está verificando autenticação */
  isChecking?: boolean;
};

export function LoginRequiredModal({
  open,
  onOpenChange,
  loginUrl,
  onLoginClick,
  isChecking = false,
}: LoginRequiredModalProps) {
  const { t } = useTranslation();

  const handleLoginClick = () => {
    // Abre o login em nova aba via link (não window.open, evita bloqueio de popup)
    const a = document.createElement("a");
    a.href = loginUrl;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.click();
    // Chama o callback para iniciar o polling
    onLoginClick();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LogIn className="h-4 w-4" />
            {t("viewer.auth.loginPromptTitle")}
          </DialogTitle>
          <DialogDescription>
            {isChecking ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin inline-block mr-2" />
                {t("viewer.auth.checkingAuth")}
              </>
            ) : (
              t("viewer.auth.loginPromptMessage")
            )}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            className="btn-ghost"
            onClick={() => onOpenChange(false)}
            disabled={isChecking}
          >
            {t("viewer.common.cancel")}
          </button>
          <button
            type="button"
            className="btn-primary gap-2"
            onClick={handleLoginClick}
            disabled={isChecking}
          >
            {isChecking ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t("viewer.auth.checkingAuth")}
              </>
            ) : (
              <>
                <ExternalLink className="h-3.5 w-3.5" />
                {t("viewer.auth.openLogin")}
              </>
            )}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

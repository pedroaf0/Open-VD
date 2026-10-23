import { useTranslation } from "react-i18next";
import { Eye, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Confirmação antes de excluir um modelo STL da cena. */
export function MeshDeleteDialog({
  open,
  meshName,
  onOpenChange,
  onCancel,
  onHide,
  onDelete,
}: {
  open: boolean;
  meshName: string | undefined;
  onOpenChange: (open: boolean) => void;
  onCancel: () => void;
  onHide: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("viewer.meshes.confirmDeleteTitle")}</DialogTitle>
          <DialogDescription>
            {t("viewer.meshes.confirmDeleteMessage", { name: meshName })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <button className="btn-ghost w-full sm:w-auto" onClick={onCancel}>
            {t("viewer.common.cancel")}
          </button>
          <button className="btn-outline w-full sm:w-auto" onClick={onHide}>
            <Eye className="h-3.5 w-3.5 text-white" aria-hidden="true" />
            {t("viewer.meshes.hide", { name: meshName })}
          </button>
          <button className="btn-destructive w-full sm:w-auto" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5 text-white" aria-hidden="true" />
            {t("viewer.meshes.remove", { name: meshName })}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

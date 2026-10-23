import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/** Grupo colapsável do painel de parâmetros. */
export function PanelSection({
  title,
  defaultOpen = true,
  right,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  right?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="min-w-0 shrink-0 overflow-visible rounded-lg border border-border bg-panel">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="group-title">{title}</span>
        <span className="flex items-center gap-1.5">
          {right}
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200",
              open && "rotate-180",
            )}
          />
        </span>
      </button>
      {open && (
        <div className="min-w-0 space-y-2.5 break-words border-t border-border px-3 py-2.5">
          {children}
        </div>
      )}
    </section>
  );
}

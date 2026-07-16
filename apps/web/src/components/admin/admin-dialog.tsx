"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";

interface AdminDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "md" | "lg";
}

export function AdminDialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: AdminDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
      onClick={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
      className={
        size === "lg"
          ? "m-auto max-h-[92vh] w-[min(94vw,52rem)] overflow-hidden rounded-2xl border border-border-strong bg-surface p-0 text-foreground shadow-[0_30px_90px_rgba(0,0,0,.65)] backdrop:bg-black/75 backdrop:backdrop-blur-sm"
          : "m-auto max-h-[92vh] w-[min(92vw,35rem)] overflow-hidden rounded-2xl border border-border-strong bg-surface p-0 text-foreground shadow-[0_30px_90px_rgba(0,0,0,.65)] backdrop:bg-black/75 backdrop:backdrop-blur-sm"
      }
    >
      <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
        <div>
          <h2 id={titleId} className="text-lg font-semibold tracking-tight">
            {title}
          </h2>
          {description ? (
            <p id={descriptionId} className="mt-1 text-sm leading-6 text-muted">
              {description}
            </p>
          ) : null}
        </div>
        <Button variant="ghost" size="icon" aria-label="Fechar" onClick={onClose}>
          <X aria-hidden="true" className="size-4" />
        </Button>
      </div>
      <div className="max-h-[calc(92vh-9rem)] overflow-y-auto px-5 py-5 sm:px-6">
        {children}
      </div>
      {footer ? (
        <div className="flex flex-wrap justify-end gap-3 border-t border-border px-5 py-4 sm:px-6">
          {footer}
        </div>
      ) : null}
    </dialog>
  );
}

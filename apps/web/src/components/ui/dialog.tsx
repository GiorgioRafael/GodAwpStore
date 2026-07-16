"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "./button";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="dialog-title"
      aria-describedby={description ? "dialog-description" : undefined}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
      className="m-auto w-[min(92vw,34rem)] rounded-2xl border border-border-strong bg-surface p-0 text-foreground shadow-[0_30px_90px_rgba(0,0,0,.65)] backdrop:bg-black/75 backdrop:backdrop-blur-sm"
    >
      <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
        <div>
          <h2 id="dialog-title" className="text-lg font-semibold tracking-tight">
            {title}
          </h2>
          {description ? (
            <p id="dialog-description" className="mt-1 text-sm leading-6 text-muted">
              {description}
            </p>
          ) : null}
        </div>
        <Button variant="ghost" size="icon" aria-label="Fechar" onClick={onClose}>
          <X aria-hidden="true" className="size-4" />
        </Button>
      </div>
      <div className="px-5 py-5 sm:px-6">{children}</div>
      {footer ? (
        <div className="flex justify-end gap-3 border-t border-border px-5 py-4 sm:px-6">
          {footer}
        </div>
      ) : null}
    </dialog>
  );
}

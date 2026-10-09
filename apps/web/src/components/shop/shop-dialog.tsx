"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import styles from "./shop.module.css";

export function ShopDialog({ open, title, onClose, children, wide = false }: {
  open: boolean; title: string; onClose: () => void; children: ReactNode; wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (open && dialog && !dialog.open) dialog.showModal();
    if (!open && dialog?.open) dialog.close();
  }, [open]);
  return <dialog ref={ref} aria-labelledby={titleId} className={`${styles.dialog} ${wide ? styles.dialogWide : ""}`}
    onCancel={event => { event.preventDefault(); onClose(); }} onClose={onClose}>
    <div className={styles.dialogHeader}><h2 id={titleId}>{title}</h2>
      <button type="button" className={styles.iconButton} aria-label="Fechar janela" onClick={onClose}><X size={20} /></button>
    </div><div className={styles.dialogBody}>{children}</div>
  </dialog>;
}

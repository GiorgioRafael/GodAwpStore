"use client";

import { useEffect, useId, useRef, type MouseEvent, type ReactNode } from "react";
import { X } from "lucide-react";
import ui from "./shop.module.css";

/** A press on the ::backdrop targets the dialog itself, outside its box (not its border, scrollbar or content).
 * Tapping the backdrop closes only when the press also started there, so a text selection dragged out does not. */
const onBackdrop = (event: MouseEvent<HTMLDialogElement>) => {
  const box = event.currentTarget.getBoundingClientRect();
  return event.target === event.currentTarget &&
    (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom);
};

/** Native modal dialog: centred (wide for the product), a right drawer for the cart, and a bottom sheet on phones. */
export function ShopDialog({ open, title, onClose, children, wide = false, variant = "center", meta }: {
  open: boolean; title: string; onClose: () => void; children: ReactNode; wide?: boolean; variant?: "center" | "drawer"; meta?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const backdropPress = useRef(false);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!open) { if (dialog.open) dialog.close(); return; }
    if (!dialog.open) { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; dialog.showModal(); }
    // The product detail is keyed and unmounts while still open, so the browser's own focus restore has nothing
    // to return to: put focus back on the opener, unless another dialog (the cart) has taken over.
    return () => { if (opener.current?.isConnected && !document.querySelector("dialog[open]")) opener.current.focus({ preventScroll: true }); };
  }, [open]);
  return <dialog ref={ref} aria-labelledby={titleId} data-variant={variant}
    className={[ui.dialog, wide && ui.dialogWide, variant === "drawer" && ui.dialogDrawer].filter(Boolean).join(" ")}
    onCancel={event => { event.preventDefault(); onClose(); }} onClose={onClose}
    onPointerDown={event => { backdropPress.current = onBackdrop(event); }}
    onClick={event => { if (backdropPress.current && onBackdrop(event)) onClose(); }}>
    <div className={ui.dialogHeader}><div className={ui.dialogTitleRow}><h2 id={titleId}>{title}</h2>{meta}</div>
      <button type="button" className={ui.iconButton} aria-label="Fechar janela" onClick={onClose}><X size={20} aria-hidden="true" /></button>
    </div><div className={ui.dialogBody}>{children}</div>
  </dialog>;
}

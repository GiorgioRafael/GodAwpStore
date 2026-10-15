"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import QRCode from "qrcode";
import {
  Check, CheckCheck, CircleCheck, CircleX, Clock, Copy, CopyCheck, ExternalLink, Hourglass, LoaderCircle, LockKeyhole,
  MessagesSquare, QrCode, RotateCcw, Send, TriangleAlert, type LucideIcon,
} from "lucide-react";
import type { ShopMessage, ShopOrderStatus } from "@/lib/shop/types";
import { formatShopPrice, shopProductDisplayName } from "@/lib/shop/catalog-view";
import { ShopDialog } from "./shop-dialog";
import { EmptyState, Kicker } from "./shop-ui";
import ui from "./shop.module.css";
import styles from "./account.module.css";

type Chat = { messages: ShopMessage[]; canSend: boolean; deliveredAt: string | null };
export function shopOrderStatusLabel(order: Pick<ShopOrderStatus, "status" | "paymentStatus" | "deliveredAt">): string {
  if (order.deliveredAt || ["delivered", "completed"].includes(order.status)) return "Entregue";
  if (order.status === "refunded" || order.paymentStatus === "refunded") return "Reembolsado";
  if (order.paymentStatus === "paid" && ["cancelled", "canceled", "expired"].includes(order.status)) return "Análise necessária";
  if (["cancelled", "canceled"].includes(order.status)) return "Cancelado";
  if (order.status === "expired" || order.paymentStatus === "expired") return "Pagamento expirado";
  return order.paymentStatus === "paid" ? "Em atendimento" : "Aguardando pagamento";
}

/** Colour family of a status label, shared by the orders list and the workspace (and the admin remap). */
export type ShopOrderTone = "pending" | "active" | "done" | "halted" | "refunded" | "review";
export function shopOrderStatusTone(order: Parameters<typeof shopOrderStatusLabel>[0]): ShopOrderTone {
  return ({ "Entregue": "done", "Reembolsado": "refunded", "Análise necessária": "review", "Cancelado": "halted",
    "Pagamento expirado": "halted", "Em atendimento": "active", "Aguardando pagamento": "pending" } as Record<string, ShopOrderTone>)[shopOrderStatusLabel(order)] ?? "pending";
}
export const ORDER_TONE_ICON: Record<ShopOrderTone, LucideIcon> = { pending: Hourglass, active: MessagesSquare, done: CircleCheck, halted: CircleX, refunded: RotateCcw, review: TriangleAlert };

// None of these equals a status label: each label appears once, in the summary pill.
const STEPS = ["Pedido", "Pagamento", "Atendimento", "Entrega"];
const clock = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

export function ShopOrderWorkspace({ orderId, admin = false }: { orderId: string; admin?: boolean }) {
  const [order, setOrder] = useState<ShopOrderStatus | null>(null);
  const [chat, setChat] = useState<Chat | null>(null);
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [deliveryConfirm, setDeliveryConfirm] = useState(false);
  const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const pendingMessage = useRef<{ body: string; id: string } | null>(null);
  const pixTitleId = useId();
  const base = `/api/loja/pedidos/${encodeURIComponent(orderId)}`;

  const refresh = useCallback(async () => {
    if (controller.current || document.hidden) return;
    const request = new AbortController(); controller.current = request;
    try {
      const response = await fetch(base, { cache: "no-store", signal: request.signal });
      const result = await response.json();
      if (!result.ok) { setError(result.error?.message || "Não foi possível carregar este pedido."); return; }
      setOrder(result);
      if (result.paidAt || result.paymentStatus === "paid") {
        const chatResponse = await fetch(`${base}/mensagens`, { cache: "no-store", signal: request.signal });
        const chatResult = await chatResponse.json();
        if (!chatResult.ok) { setError(chatResult.error?.message || "O chat não carregou. Tente novamente."); return; }
        setChat(chatResult);
      }
      setError("");
    } catch { if (!request.signal.aborted) setError("A conexão falhou. Atualize para tentar novamente."); }
    finally { if (controller.current === request) controller.current = null; }
  }, [base]);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (active) void refresh(); });
    const timer = window.setInterval(() => void refresh(), 8000);
    const visible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", visible);
    return () => { active = false; window.clearInterval(timer); document.removeEventListener("visibilitychange", visible); controller.current?.abort(); controller.current = null; };
  }, [refresh]);
  useEffect(() => {
    if (!order?.pixCode) return;
    let active = true;
    void QRCode.toDataURL(order.pixCode, { width: 280, margin: 1, errorCorrectionLevel: "M" }).then(image => { if (active) setQr(image); });
    return () => { active = false; };
  }, [order?.pixCode]);
  useEffect(() => {
    const element = messagesRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [chat?.messages.length]);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || !body.trim() || !chat?.canSend) return;
    const message = body.trim();
    if (pendingMessage.current?.body !== message) pendingMessage.current = { body: message, id: crypto.randomUUID() };
    setBusy(true); setError("");
    try {
      const response = await fetch(`${base}/mensagens`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: message, requestId: pendingMessage.current.id }) });
      const result = await response.json();
      if (!result.ok) { setError(result.error?.message || "Não foi possível enviar a mensagem."); return; }
      setBody(""); pendingMessage.current = null; await refresh();
    } catch { setError("A mensagem não foi confirmada. Tente enviá-la novamente."); }
    finally { setBusy(false); }
  }
  async function finishDelivery() {
    if (busy) return; setBusy(true); setError("");
    try {
      const response = await fetch(`${base}/entrega`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const result = await response.json();
      if (!result.ok) { setError(result.error?.message || "Não foi possível concluir a entrega."); return; }
      setDeliveryConfirm(false); await refresh();
    } catch { setError("A conclusão não foi confirmada. Atualize o pedido antes de tentar de novo."); }
    finally { setBusy(false); }
  }
  const payable = order?.status === "awaiting_payment" && order.paymentStatus !== "paid";
  const paymentUrl = order?.checkoutUrl && /^https:\/\//.test(order.checkoutUrl) ? order.checkoutUrl : null;
  const tone = order ? shopOrderStatusTone(order) : "pending";
  const reached = tone === "pending" ? 1 : tone === "active" ? 2 : 4;

  return <div className={`${ui.shop} ${ui.workspaceTheme}`} data-context={admin ? "admin" : "customer"}>
    {error ? <p className={ui.error} role="alert">{error}<button className={ui.secondaryButton} onClick={() => void refresh()}>Atualizar</button></p> : null}
    {!order ? <>
        {error ? null : <div className={styles.workspaceSkeleton} aria-hidden="true"><div className={`${ui.skeleton} ${styles.skeletonAside}`} /><div className={`${ui.skeleton} ${styles.skeletonMain}`} /></div>}
        <p className={ui.smallNote} role="status">{error ? "Não foi possível abrir esta compra." : "Carregando pedido…"}</p></>
      : <div className={styles.orderWorkspace}>
        <aside className={styles.orderSummary} data-tone={tone}>
          <div className={styles.orderSummaryHead}><h2>Pedido #{order.orderId.slice(0, 8).toUpperCase()}</h2>
            <span className={styles.orderStatus} data-tone={tone}>{shopOrderStatusLabel(order)}</span></div>
          {tone === "pending" || tone === "active" || tone === "done" ? <ol className={styles.stepper} aria-label="Etapas da compra">{STEPS.map((step, i) => {
            const state = i < reached ? "done" : i === reached ? "current" : "todo";
            return <li key={step} data-state={state} aria-current={state === "current" ? "step" : undefined}>
              <span className={styles.stepDot} aria-hidden="true">{state === "done" ? <Check size={14} strokeWidth={3} aria-hidden="true" /> : i + 1}</span><span>{step}</span>
              <span className="sr-only">{state === "done" ? " (concluída)" : state === "current" ? " (etapa atual)" : ""}</span></li>;
          })}</ol> : null}
          <div className={styles.orderAmount}><span>Total</span><strong>{formatShopPrice(order.totalPriceCents)}</strong></div>
          <ul className={styles.orderItems}>{order.items.map((item, i) => <li key={i}><span className={styles.qtyBadge}>{item.quantity}×</span>{shopProductDisplayName(item.productName)}</li>)}</ul>
          <dl className={styles.orderMeta}>
            <dt>Roblox</dt><dd>{order.gameNickname ? <span className={styles.nickname}>{order.gameNickname}</span> : "Não informado"}</dd>
            <dt>Data</dt><dd>{new Date(order.createdAt).toLocaleString("pt-BR")}</dd></dl>
          {admin ? <p className={styles.orderBuyer}>{`Comprador: ${order.buyerName}`}</p> : null}
          {admin && order.paymentStatus === "paid" && !order.deliveredAt && !["cancelled", "canceled", "expired"].includes(order.status) ? <button className={`${ui.primaryButton} ${styles.deliverButton}`} onClick={() => setDeliveryConfirm(true)} disabled={busy}><CheckCheck size={18} aria-hidden="true" /> Concluir entrega</button> : null}
        </aside>
        <div className={styles.workspaceMain}>
          {payable ? <section className={styles.pixPanel} aria-labelledby={pixTitleId}>
            <div className={styles.pixHead}><Kicker icon={QrCode}>Pagamento</Kicker><h2 id={pixTitleId}>Pague com Pix</h2>
              {order.paymentExpiresAt ? <p className={styles.pixExpiry}><Clock size={14} aria-hidden="true" />Pix válido até {clock(order.paymentExpiresAt)}</p> : null}</div>
            {order.pixCode && qr ? <div className={styles.pixBody}>{/* The QR is generated locally; the payment code never goes to an external image service. */}
                <div className={styles.qrFrame}><Image unoptimized className={styles.paymentQr} src={qr} alt="QR Code Pix do seu pedido" width={280} height={280} /></div>
                <div className={styles.pixCopy}>
                  <p className={styles.pixMobileHint}>No celular? Copie o código e cole no app do seu banco, em Pix copia e cola.</p>
                  <p className={styles.pixLabel}>Pix copia e cola</p>
                  <div className={styles.codeBox}><code className={styles.paymentCode}>{order.pixCode}</code></div>
                  <button className={`${ui.primaryButton} ${styles.copyButton}`} data-copied={copied || undefined} onClick={async () => { try { await navigator.clipboard.writeText(order.pixCode!); setCopied(true); } catch { setError("Copie o código Pix exibido acima."); } }}>
                    {copied ? <CopyCheck size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}{copied ? "Código copiado" : "Copiar código Pix"}</button>
                  <ol className={styles.pixSteps}><li>Abra o app do seu banco e escolha Pix.</li><li>Escaneie o QR Code ou use o Pix copia e cola.</li><li>Confirme o pagamento no app do banco.</li></ol>
                </div></div>
              : paymentUrl ? <a className={ui.primaryButton} href={paymentUrl} target="_blank" rel="noopener noreferrer">Pagar com Pix <ExternalLink size={16} aria-hidden="true" /></a>
              : <p className={ui.smallNote}>O Pix está sendo preparado. Retome pelo carrinho se necessário.</p>}
            <p className={styles.pixWaiting}><span className={styles.liveDot} aria-hidden="true" />A confirmação aparece automaticamente aqui após o pagamento.</p>
          </section> : null}
          <section className={styles.chatPanel} aria-label="Chat privado da compra"><header className={styles.chatHeader}>
            <span className={styles.chatSeal} aria-hidden="true">GW</span>
            <div className={styles.chatTitle}><h2>Atendimento da compra</h2><p>Conversa privada entre o comprador e a equipe da GWStore.</p></div>
            {chat ? <span className={styles.chatState} data-open={chat.canSend || undefined}>{chat.canSend ? "Chat aberto" : "Chat encerrado"}</span> : null}
          </header>
            {!order.paidAt && order.paymentStatus !== "paid" ? <EmptyState icon={LockKeyhole} inset title="Seu chat abre após o pagamento"
                text="Assim que o Pix for confirmado, converse por aqui para combinar a entrega." action={admin ? null : <Link href="/" className={ui.secondaryButton}>Voltar à loja</Link>} />
              : <><div className={styles.messages} ref={messagesRef} role="log" aria-label="Mensagens do atendimento" aria-live="polite">
                {!chat?.messages.length ? <p className={styles.messageSystem}>Pagamento confirmado. Envie uma mensagem para combinar a entrega com a equipe.</p> : chat.messages.map(message => {
                  if (message.authorRole === "system") return <p key={message.id} className={styles.messageSystem}>{message.body}</p>;
                  const own = admin ? message.authorRole === "staff" : message.authorRole === "buyer";
                  return <div key={message.id} className={`${styles.message} ${own ? styles.messageOwn : ""}`}>
                    {!own ? <span className={styles.messageAvatar} data-role={message.authorRole} aria-hidden="true">{message.authorRole === "staff" ? "GW" : (message.authorName.trim().charAt(0) || "?").toUpperCase()}</span> : null}
                    <div className={styles.messageStack}><div className={styles.messageMeta}><strong>{message.authorRole === "staff" ? "Equipe GWStore" : message.authorName}</strong><time dateTime={message.createdAt}>{clock(message.createdAt)}</time></div>
                      <div className={styles.messageBody}>{message.body}</div></div>
                  </div>;
                })}
              </div><form className={styles.composer} onSubmit={send}><label className="sr-only" htmlFor={`message-${orderId}`}>Sua mensagem</label>
                <textarea id={`message-${orderId}`} className={`${ui.input} ${styles.composerInput}`} maxLength={2000} placeholder={chat?.canSend ? "Escreva sua mensagem…" : "O atendimento desta compra está encerrado."} value={body} disabled={busy || !chat?.canSend} onChange={event => setBody(event.target.value)} />
                <div className={styles.composerFooter}><p>{order.deliveredAt ? "Entrega concluída. O histórico fica salvo nesta compra." : "Combine a entrega e tire suas dúvidas por aqui."}</p>
                  <button className={`${ui.primaryButton} ${styles.sendButton}`} disabled={busy || !body.trim() || !chat?.canSend}>{busy ? <LoaderCircle className={ui.spinner} size={16} aria-hidden="true" /> : <Send size={16} aria-hidden="true" />} Enviar</button></div>
              </form></>}
          </section>
        </div>
      </div>}
    <ShopDialog open={deliveryConfirm} onClose={() => { if (!busy) setDeliveryConfirm(false); }} title="Concluir entrega">
      <p className={styles.confirmText}>Confirme somente depois de entregar todos os itens deste pedido. A compra será marcada como entregue e o comprador verá a confirmação no chat.</p>
      <button className={`${ui.primaryButton} ${styles.confirmButton}`} onClick={() => void finishDelivery()} disabled={busy}>{busy ? "Concluindo…" : "Confirmar entrega"}</button>
    </ShopDialog>
  </div>;
}

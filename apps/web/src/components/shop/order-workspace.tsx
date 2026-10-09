"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import QRCode from "qrcode";
import { Check, CheckCheck, Copy, ExternalLink, LoaderCircle, Send } from "lucide-react";
import type { ShopMessage, ShopOrderStatus } from "@/lib/shop/types";
import { formatShopPrice } from "@/lib/shop/catalog-view";
import { ShopDialog } from "./shop-dialog";
import styles from "./shop.module.css";

type Chat = { messages: ShopMessage[]; canSend: boolean; deliveredAt: string | null };
export function shopOrderStatusLabel(order: Pick<ShopOrderStatus, "status" | "paymentStatus" | "deliveredAt">): string {
  if (order.deliveredAt || ["delivered", "completed"].includes(order.status)) return "Entregue";
  if (order.status === "refunded" || order.paymentStatus === "refunded") return "Reembolsado";
  if (order.paymentStatus === "paid" && ["cancelled", "canceled", "expired"].includes(order.status)) return "Análise necessária";
  if (["cancelled", "canceled"].includes(order.status)) return "Cancelado";
  if (order.status === "expired" || order.paymentStatus === "expired") return "Pagamento expirado";
  return order.paymentStatus === "paid" ? "Em atendimento" : "Aguardando pagamento";
}

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

  return <div className={`${styles.shop} ${styles.workspaceTheme}`}>
    {error ? <p className={styles.error} role="alert">{error}<button className={styles.secondaryButton} onClick={() => void refresh()}>Atualizar</button></p> : null}
    {!order ? <p className={styles.smallNote} role="status">{error ? "Não foi possível abrir esta compra." : "Carregando pedido…"}</p>
      : <div className={styles.orderWorkspace}>
        <aside className={styles.orderSummary}><h2>Pedido #{order.orderId.slice(0, 8).toUpperCase()}</h2><span className={styles.orderStatus}>{shopOrderStatusLabel(order)}</span>
          <strong className={styles.orderAmount}>{formatShopPrice(order.totalPriceCents)}</strong>
          <div className={styles.orderItems}>{order.items.map((item, i) => <div key={i}>{item.quantity}× {item.productName}</div>)}</div>
          <p>Roblox: <strong>{order.gameNickname || "Não informado"}</strong></p><p>{new Date(order.createdAt).toLocaleString("pt-BR")}</p>
          {admin ? <p>Comprador: {order.buyerName}</p> : null}
          {payable ? <>
            {order.pixCode && qr ? <>{/* The QR is generated locally; the payment code never goes to an external image service. */}
              <Image unoptimized className={styles.paymentQr} src={qr} alt="QR Code Pix do seu pedido" width={280} height={280} /><code className={styles.paymentCode}>{order.pixCode}</code>
              <button className={styles.secondaryButton} onClick={async () => { try { await navigator.clipboard.writeText(order.pixCode!); setCopied(true); } catch { setError("Copie o código Pix exibido acima."); } }}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? "Código copiado" : "Copiar código Pix"}</button>
            </> : paymentUrl ? <a className={styles.primaryButton} href={paymentUrl} target="_blank" rel="noopener noreferrer">Pagar com Pix <ExternalLink size={16} /></a> : <p className={styles.smallNote}>O Pix está sendo preparado. Retome pelo carrinho se necessário.</p>}
            {order.paymentExpiresAt ? <p className={styles.smallNote}>Pix válido até {new Date(order.paymentExpiresAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.</p> : null}
            <p className={styles.smallNote}>A confirmação aparece automaticamente aqui após o pagamento.</p>
          </> : null}
          {admin && order.paymentStatus === "paid" && !order.deliveredAt && !["cancelled", "canceled", "expired"].includes(order.status) ? <button className={styles.primaryButton} onClick={() => setDeliveryConfirm(true)} disabled={busy}><CheckCheck size={18} /> Concluir entrega</button> : null}
        </aside>
        <section className={styles.chatPanel} aria-label="Chat privado da compra"><header className={styles.chatHeader}><h2>Atendimento da compra</h2><p>Conversa privada entre o comprador e a equipe da GWStore.</p></header>
          {!order.paidAt && order.paymentStatus !== "paid" ? <div className={styles.emptyState}><h3>Seu chat abre após o pagamento</h3><p>Assim que o Pix for confirmado, converse por aqui para combinar a entrega.</p><Link href="/" className={styles.secondaryButton}>Voltar à loja</Link></div>
            : <><div className={styles.messages} ref={messagesRef} role="log" aria-label="Mensagens do atendimento" aria-live="polite">
              {!chat?.messages.length ? <p className={styles.messageSystem}>Pagamento confirmado. Envie uma mensagem para combinar a entrega com a equipe.</p> : chat.messages.map(message => message.authorRole === "system" ? <p key={message.id} className={styles.messageSystem}>{message.body}</p>
                : <div key={message.id} className={`${styles.message} ${(admin ? message.authorRole === "staff" : message.authorRole === "buyer") ? styles.messageOwn : ""}`}>
                  <div className={styles.messageMeta}><strong>{message.authorRole === "staff" ? "Equipe GWStore" : message.authorName}</strong><time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</time></div><div className={styles.messageBody}>{message.body}</div>
                </div>)}
            </div><form className={styles.composer} onSubmit={send}><label className="sr-only" htmlFor={`message-${orderId}`}>Sua mensagem</label>
              <textarea id={`message-${orderId}`} maxLength={2000} placeholder={chat?.canSend ? "Escreva sua mensagem…" : "O atendimento desta compra está encerrado."} value={body} disabled={busy || !chat?.canSend} onChange={event => setBody(event.target.value)} />
              <div className={styles.composerFooter}><p>{order.deliveredAt ? "Entrega concluída. O histórico fica salvo nesta compra." : "Combine a entrega e tire suas dúvidas por aqui."}</p><button className={styles.primaryButton} disabled={busy || !body.trim() || !chat?.canSend}>{busy ? <LoaderCircle className={styles.spinner} size={16} /> : <Send size={16} />} Enviar</button></div>
            </form></>}
        </section>
      </div>}
    <ShopDialog open={deliveryConfirm} onClose={() => { if (!busy) setDeliveryConfirm(false); }} title="Concluir entrega">
      <p className={styles.description}>Confirme somente depois de entregar todos os itens deste pedido. A compra será marcada como entregue e o comprador verá a confirmação no chat.</p>
      <button className={styles.primaryButton} onClick={() => void finishDelivery()} disabled={busy}>{busy ? "Concluindo…" : "Confirmar entrega"}</button>
    </ShopDialog>
  </div>;
}

"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, ReceiptText, RefreshCw } from "lucide-react";
import type { ShopOrderSummary } from "@/lib/shop/types";
import { formatShopPrice, shopProductDisplayName } from "@/lib/shop/catalog-view";
import { ORDER_TONE_ICON, shopOrderStatusLabel, shopOrderStatusTone, type ShopOrderTone } from "./order-workspace";
import { Emblem, EmptyState, Kicker } from "./shop-ui";
import ui from "./shop.module.css";
import styles from "./account.module.css";

// The buyer's next step for each status tone.
const ACTION: Record<ShopOrderTone, string> = { pending: "Pagar", active: "Abrir chat", review: "Abrir chat", done: "Ver conversa", halted: "Ver pedido", refunded: "Ver pedido" };

export function ShopOrdersList() {
  const [orders, setOrders] = useState<ShopOrderSummary[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    if (controller.current) return;
    const request = new AbortController(); controller.current = request; setBusy(true); setError("");
    try {
      const response = await fetch("/api/loja/pedidos", { cache: "no-store", signal: request.signal });
      const result = await response.json();
      if (!result.ok) { setError(result.error?.message || "Não foi possível carregar suas compras."); return; }
      setOrders(result.orders);
    } catch { if (!request.signal.aborted) setError("Não foi possível carregar suas compras. Tente atualizar."); }
    finally { if (!request.signal.aborted) setBusy(false); if (controller.current === request) controller.current = null; }
  }, []);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (active) void refresh(); });
    return () => { active = false; controller.current?.abort(); controller.current = null; };
  }, [refresh]);
  return <>
    <div className={styles.accountTitle}><div><Kicker>Sua conta</Kicker><h1>Minhas compras</h1><p>Acompanhe o pagamento e converse com a equipe para receber seus itens.</p></div>
      <button className={ui.secondaryButton} onClick={() => void refresh()} disabled={busy}><RefreshCw size={16} aria-hidden="true" className={busy ? ui.spinner : undefined} /> Atualizar</button></div>
    {error ? <p className={ui.error} role="alert">{error}</p> : null}
    {!orders ? <>
        {busy ? <div className={styles.orderList} aria-hidden="true">{[0, 1, 2].map(i => <div key={i} className={`${ui.skeleton} ${styles.orderSkeleton}`} />)}</div> : null}
        <p className={ui.smallNote} role="status">{busy ? "Carregando suas compras…" : "Atualize para consultar suas compras."}</p></>
      : !orders.length ? <EmptyState icon={ReceiptText} title="Sua primeira compra começa na loja" text="Os pedidos e chats aparecerão aqui."
          action={<Link href="/#catalogo" className={ui.primaryButton}>Explorar produtos <ArrowRight size={17} aria-hidden="true" /></Link>} />
      : <div className={styles.orderList}>{orders.map(order => {
        const tone = shopOrderStatusTone(order); const ToneIcon = ORDER_TONE_ICON[tone];
        return <Link href={`/minhas-compras/${order.orderId}`} key={order.orderId} className={styles.orderCard} data-tone={tone}>
          <Emblem icon={ToneIcon} size="m" hue="var(--tone)" className={styles.orderEmblem} />
          <div className={styles.orderCardBody}><h2>{order.items.map(item => `${item.quantity}× ${shopProductDisplayName(item.productName)}`).join(" · ")}</h2>
            <div className={styles.orderCardMeta}><span className={styles.orderStatus} data-tone={tone}>{shopOrderStatusLabel(order)}</span>
              <p>Pedido #{order.orderId.slice(0, 8).toUpperCase()} · {new Date(order.createdAt).toLocaleDateString("pt-BR")}</p></div></div>
          <div className={styles.orderCardAside}><strong>{formatShopPrice(order.totalPriceCents)}</strong>
            <span className={styles.orderAction}>{ACTION[tone]}<ArrowRight size={15} aria-hidden="true" /></span></div>
        </Link>;
      })}</div>}
  </>;
}

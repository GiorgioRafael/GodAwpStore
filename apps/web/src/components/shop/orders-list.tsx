"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, RefreshCw } from "lucide-react";
import type { ShopOrderSummary } from "@/lib/shop/types";
import { formatShopPrice } from "@/lib/shop/catalog-view";
import { shopOrderStatusLabel } from "./order-workspace";
import styles from "./shop.module.css";

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
    <div className={styles.accountTitle}><div><h1>Minhas compras</h1><p>Acompanhe o pagamento e converse com a equipe para receber seus itens.</p></div>
      <button className={styles.secondaryButton} onClick={() => void refresh()} disabled={busy}><RefreshCw size={16} /> Atualizar</button></div>
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    {!orders ? <p className={styles.smallNote} role="status">{busy ? "Carregando suas compras…" : "Atualize para consultar suas compras."}</p>
      : !orders.length ? <div className={styles.emptyState}><h3>Sua primeira compra começa na loja</h3><p>Os pedidos e chats aparecerão aqui.</p><Link href="/#catalogo" className={styles.primaryButton}>Explorar produtos <ArrowRight size={17} /></Link></div>
      : <div className={styles.orderList}>{orders.map(order => <Link href={`/minhas-compras/${order.orderId}`} key={order.orderId} className={styles.orderCard}>
        <div><h2>{order.items.map(item => `${item.quantity}× ${item.productName}`).join(" · ")}</h2><span className={styles.orderStatus}>{shopOrderStatusLabel(order)}</span><p>Pedido #{order.orderId.slice(0, 8).toUpperCase()} · {new Date(order.createdAt).toLocaleDateString("pt-BR")}</p></div>
        <div><strong>{formatShopPrice(order.totalPriceCents)}</strong><p>{order.paymentStatus === "paid" ? "Abrir chat" : "Ver pedido"} →</p></div>
      </Link>)}</div>}
  </>;
}

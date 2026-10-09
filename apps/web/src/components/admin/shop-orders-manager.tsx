"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, MessageSquare, RefreshCw } from "lucide-react";
import { formatBrl, formatDateTimePtBr } from "@godawp/domain";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { TableShell } from "@/components/ui/table-shell";
import type { ShopOrderSummary } from "@/lib/shop/types";
import { storeAdminHref } from "@/lib/store-admin-routes";

type Filter = "active" | "pending" | "completed" | "all";
const filters: Array<{ value: Filter; label: string }> = [
  { value: "active", label: "Em atendimento" },
  { value: "pending", label: "Pagamento pendente" },
  { value: "completed", label: "Concluídos" },
  { value: "all", label: "Todos" },
];

function isCompleted(order: ShopOrderSummary): boolean {
  return Boolean(order.deliveredAt) || order.status === "completed" || order.status === "delivered";
}

function isActive(order: ShopOrderSummary): boolean {
  return order.paymentStatus === "paid" && !isCompleted(order)
    && order.status !== "refunded";
}

function needsReview(order: ShopOrderSummary): boolean {
  return isActive(order) && ["cancelled", "canceled", "expired"].includes(order.status);
}

function statusLabel(order: ShopOrderSummary): string {
  if (isCompleted(order)) return "Entregue";
  if (needsReview(order)) return "Análise necessária";
  if (order.status === "cancelled" || order.status === "canceled") return "Cancelado";
  if (order.paymentStatus === "refunded" || order.status === "refunded") return "Reembolsado";
  if (order.status === "expired" || order.paymentStatus === "expired") return "Expirado";
  return order.paymentStatus === "paid" ? "Em atendimento" : "Pagamento pendente";
}

export function ShopOrdersManager() {
  const [orders, setOrders] = useState<ShopOrderSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("active");
  const controller = useRef<AbortController | null>(null);

  const loadOrders = useCallback(async () => {
    if (controller.current) return;
    const request = new AbortController();
    controller.current = request;
    try {
      const response = await fetch("/api/loja/admin/pedidos", { cache: "no-store", signal: request.signal });
      const result = await response.json() as { ok: boolean; orders?: ShopOrderSummary[] };
      if (!response.ok || !result.ok || !Array.isArray(result.orders)) throw new Error("request_failed");
      if (!request.signal.aborted) setOrders(result.orders);
    } catch {
      if (!request.signal.aborted) setError("Não foi possível carregar os pedidos. Atualize para tentar novamente.");
    } finally {
      if (!request.signal.aborted) setLoading(false);
      if (controller.current === request) controller.current = null;
    }
  }, []);

  const refresh = useCallback(() => {
    if (controller.current) return;
    setLoading(true);
    setError("");
    void loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    // A discarded Strict Mode mount should not start a network request.
    let mounted = true;
    queueMicrotask(() => { if (mounted) void loadOrders(); });
    return () => {
      mounted = false;
      controller.current?.abort();
      controller.current = null;
    };
  }, [loadOrders]);

  const visible = (orders ?? []).filter(order => filter === "all"
    || (filter === "active" && isActive(order))
    || (filter === "pending" && order.paymentStatus === "pending" && !["expired", "cancelled", "canceled"].includes(order.status))
    || (filter === "completed" && isCompleted(order)));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Filtrar pedidos" className="flex flex-wrap gap-2">
          {filters.map(item => <Button key={item.value} size="sm" variant={filter === item.value ? "primary" : "secondary"} aria-pressed={filter === item.value} onClick={() => setFilter(item.value)}>{item.label}</Button>)}
        </div>
        <Button size="sm" variant="secondary" disabled={loading} onClick={() => void refresh()}><RefreshCw aria-hidden="true" className={`size-4 ${loading ? "animate-spin" : ""}`} />{loading ? "Atualizando..." : "Atualizar"}</Button>
      </div>
      {error ? <p role="alert" className="rounded-xl border border-danger/25 bg-danger/5 px-4 py-3 text-sm text-danger">{error}</p> : null}
      {orders === null && loading ? <p role="status" className="py-8 text-sm text-muted">Carregando pedidos da loja...</p> : visible.length === 0 ? (
        <EmptyState icon={MessageSquare} title="Nenhum pedido nesta lista" description="As compras realizadas no site aparecerão aqui. Use os filtros para consultar pagamentos pendentes e entregas concluídas." />
      ) : (
        <TableShell caption="Pedidos feitos no site" columns={["Pedido", "Comprador", "Itens", "Situação", "Valor", "Atendimento"]}>
          {visible.map(order => <tr key={order.orderId} className="border-b border-border last:border-b-0">
            <td className="px-5 py-4"><p className="font-medium text-foreground">#{order.orderId.slice(0, 8).toUpperCase()}</p><p className="mt-1 text-xs text-muted">{formatDateTimePtBr(order.createdAt)}</p></td>
            <td className="px-5 py-4 text-sm text-muted-strong">{order.buyerName}{order.gameNickname ? <p className="mt-1 text-xs text-muted">No jogo: {order.gameNickname}</p> : null}</td>
            <td className="max-w-64 px-5 py-4"><ul className="space-y-1 text-sm text-muted-strong">{order.items.map((item, index) => <li key={index}>{item.quantity}x {item.productName}</li>)}</ul></td>
            <td className="px-5 py-4"><Badge tone={isCompleted(order) ? "success" : needsReview(order) ? "warning" : isActive(order) ? "gold" : "neutral"}>{statusLabel(order)}</Badge></td>
            <td className="whitespace-nowrap px-5 py-4 text-sm font-medium text-foreground">{formatBrl(order.totalPriceCents)}</td>
            <td className="px-5 py-4"><Link href={storeAdminHref(`/atendimento-loja/${order.orderId}`)} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-medium text-gold hover:underline focus-visible:outline-2 focus-visible:outline-gold">Abrir pedido<ArrowUpRight aria-hidden="true" className="size-4" /></Link></td>
          </tr>)}
        </TableShell>
      )}
    </div>
  );
}

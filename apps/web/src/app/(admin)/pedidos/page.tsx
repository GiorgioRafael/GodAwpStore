import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  CalendarDays,
  CircleDollarSign,
  Filter,
  ReceiptText,
  ShoppingBag,
} from "lucide-react";
import { formatBrl } from "@godawp/domain";

import { OrdersChartLoader } from "@/components/admin/orders-chart-loader";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { Button, LinkButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input } from "@/components/ui/form-field";
import { TableEmptyRow, TableShell } from "@/components/ui/table-shell";
import {
  getOrderAnalyticsMetrics,
  getOrderDailySeries,
  listOrders,
} from "@/lib/data/admin-repository";
import {
  ORDERS_PAGE_SIZE,
  ORDERS_STATUS_OPTIONS,
  resolveOrdersPage,
  resolveOrdersPeriod,
  resolveOrdersStatus,
  type OrdersPeriodKey,
  type OrdersStatusFilter,
} from "@/lib/orders-period";
import { buildOrdersHref } from "@/lib/orders-query";

export const metadata: Metadata = { title: "Pedidos" };

type OrdersSearchParams = {
  period?: string | string[];
  from?: string | string[];
  to?: string | string[];
  status?: string | string[];
  page?: string | string[];
};

type OrdersPageProps = { searchParams: Promise<OrdersSearchParams> };
type BadgeTone = "neutral" | "success" | "warning" | "danger";

const PERIOD_SHORTCUTS: Array<{ value: OrdersPeriodKey; label: string }> = [
  { value: "all", label: "Todo o período" },
  { value: "today", label: "Hoje" },
  { value: "7d", label: "Últimos 7 dias" },
  { value: "30d", label: "Últimos 30 dias" },
];

const ORDER_STATUS_LABELS: Record<string, string> = {
  pending: "Pendente",
  awaiting_payment: "Aguardando pagamento",
  paid: "Pago",
  processing: "Em processamento",
  delivered: "Entregue",
  cancelled: "Cancelado",
  expired: "Expirado",
  refunded: "Reembolsado",
  failed: "Falhou",
};

function orderStatusTone(status: string): BadgeTone {
  if (["paid", "delivered"].includes(status)) return "success";
  if (["failed", "cancelled", "expired", "refunded"].includes(status)) return "danger";
  if (["pending", "awaiting_payment", "processing"].includes(status)) return "warning";
  return "neutral";
}

function dateTime(value: string): string {
  return new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function summaryHref(period: OrdersPeriodKey): string {
  return buildOrdersHref({ period, status: "all", page: 1 });
}

function MetricCard({
  label,
  value,
  detail,
  tone,
  href,
}: {
  label: string;
  value: string;
  detail: string;
  tone: "orders" | "revenue";
  href?: string;
}) {
  const Icon = tone === "orders" ? ShoppingBag : CircleDollarSign;
  const content = (
    <Card
      className={cn(
        "group relative h-full overflow-hidden p-4 transition-colors sm:p-5",
        href ? "hover:border-gold-muted hover:bg-surface-elevated" : "",
      )}
    >
      <div
        aria-hidden="true"
        className={cn(
          "absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent to-transparent",
          tone === "orders" ? "via-gold/70" : "via-success/70",
        )}
      />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">{label}</p>
          <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-foreground">{value}</p>
        </div>
        <span
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-xl border",
            tone === "orders"
              ? "border-gold/20 bg-gold/[0.07] text-gold"
              : "border-success/20 bg-success/[0.07] text-success",
          )}
        >
          <Icon aria-hidden="true" className="size-4" />
        </span>
      </div>
      <p className="mt-3 text-xs leading-5 text-muted">{detail}</p>
    </Card>
  );

  return href ? (
    <Link href={href} className="rounded-2xl focus-visible:outline-none" aria-label={`${label}: ${value}. Aplicar filtro`}>
      {content}
    </Link>
  ) : content;
}

function filterHref({
  period,
  status,
  from,
  to,
}: {
  period: OrdersPeriodKey;
  status: OrdersStatusFilter;
  from: string;
  to: string;
}) {
  return buildOrdersHref({ period, status, from, to, page: 1 });
}

export default async function OrdersPage({ searchParams }: OrdersPageProps) {
  const params = await searchParams;
  const period = resolveOrdersPeriod(params);
  const status = resolveOrdersStatus(params.status);
  const requestedPage = resolveOrdersPage(params.page);
  const [orders, metrics, dailySeries] = await Promise.all([
    listOrders({ period, status, page: requestedPage, pageSize: ORDERS_PAGE_SIZE }),
    getOrderAnalyticsMetrics(),
    getOrderDailySeries(),
  ]);

  if (orders.total > 0 && requestedPage > orders.totalPages) {
    redirect(buildOrdersHref({
      period: period.key,
      status,
      from: period.fromInput,
      to: period.toInput,
      page: orders.totalPages,
    }));
  }

  const firstVisible = orders.total === 0 ? 0 : (orders.page - 1) * orders.pageSize + 1;
  const lastVisible = Math.min(orders.page * orders.pageSize, orders.total);
  const statusLabel = ORDERS_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? "Todos";
  const currentState = {
    period: period.key,
    status,
    from: period.fromInput,
    to: period.toInput,
  };

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Operação"
        title="Pedidos"
        description="Acompanhe pedidos e pagamentos com indicadores atualizados automaticamente."
      />

      <section aria-label="Indicadores de pedidos" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <MetricCard
          label="Pedidos hoje"
          value={metrics.ordersTodayCount.toLocaleString("pt-BR")}
          detail="Clique para ver os pedidos criados hoje."
          tone="orders"
          href={summaryHref("today")}
        />
        <MetricCard
          label="Receita hoje"
          value={formatBrl(metrics.revenueTodayCents)}
          detail="LivePix confirmado pela data do pagamento."
          tone="revenue"
        />
        <MetricCard
          label="Pedidos · 7 dias"
          value={metrics.ordersLast7DaysCount.toLocaleString("pt-BR")}
          detail="Clique para aplicar a janela móvel de sete dias."
          tone="orders"
          href={summaryHref("7d")}
        />
        <MetricCard
          label="Receita · 7 dias"
          value={formatBrl(metrics.revenueLast7DaysCents)}
          detail="Pagamentos elegíveis confirmados no período."
          tone="revenue"
        />
        <MetricCard
          label="Pedidos · 30 dias"
          value={metrics.ordersLast30DaysCount.toLocaleString("pt-BR")}
          detail="Clique para aplicar a janela móvel de trinta dias."
          tone="orders"
          href={summaryHref("30d")}
        />
        <MetricCard
          label="Receita · 30 dias"
          value={formatBrl(metrics.revenueLast30DaysCents)}
          detail="Pagamentos elegíveis confirmados no período."
          tone="revenue"
        />
      </section>

      <OrdersChartLoader points={dailySeries} />

      <Card className="p-4 sm:p-5">
        <div className="space-y-5">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted">Período</p>
            <div className="flex flex-wrap gap-2" aria-label="Filtros rápidos de período">
              {PERIOD_SHORTCUTS.map((option) => {
                const active = period.key === option.value;
                return (
                  <Link
                    key={option.value}
                    href={filterHref({ ...currentState, period: option.value })}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "rounded-xl border px-3 py-2 text-sm font-medium transition-colors",
                      active
                        ? "border-gold/55 bg-gold text-[#171208] shadow-gold"
                        : "border-border-strong bg-surface-muted text-muted-strong hover:border-gold-muted hover:text-foreground",
                    )}
                  >
                    {option.label}
                  </Link>
                );
              })}
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted">Status</p>
            <div className="flex flex-wrap gap-2" aria-label="Filtros rápidos de status">
              {ORDERS_STATUS_OPTIONS.map((option) => {
                const active = status === option.value;
                return (
                  <Link
                    key={option.value}
                    href={filterHref({ ...currentState, status: option.value })}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "rounded-xl border px-3 py-2 text-sm font-medium transition-colors",
                      active
                        ? "border-gold/45 bg-gold/[0.12] text-gold-bright"
                        : "border-border bg-surface-muted text-muted hover:border-border-strong hover:text-foreground",
                    )}
                  >
                    {option.label}
                  </Link>
                );
              })}
            </div>
          </div>

          <form method="get" className="grid gap-4 border-t border-border pt-5 lg:grid-cols-[minmax(10rem,.7fr)_minmax(10rem,.7fr)_auto] lg:items-end">
            <input type="hidden" name="period" value="custom" />
            {status !== "all" ? <input type="hidden" name="status" value={status} /> : null}
            <Field label="Data inicial" htmlFor="orders-from" hint="Personalizado">
              <Input id="orders-from" name="from" type="date" defaultValue={period.fromInput} required />
            </Field>
            <Field label="Data final" htmlFor="orders-to" hint="Personalizado">
              <Input id="orders-to" name="to" type="date" defaultValue={period.toInput} required />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="submit">
                <Filter aria-hidden="true" className="size-4" />
                Aplicar datas
              </Button>
              <LinkButton href="/pedidos" variant="secondary">Limpar tudo</LinkButton>
            </div>
          </form>
        </div>

        {period.error ? (
          <p className="mt-4 rounded-xl border border-danger/25 bg-danger/[0.07] px-4 py-3 text-sm text-danger" role="alert">
            {period.error} O painel exibiu todo o histórico para não ocultar pedidos.
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs text-muted">
          <span className="inline-flex items-center gap-2">
            <CalendarDays aria-hidden="true" className="size-4" />
            {period.label} · {statusLabel}
          </span>
          <span>{orders.total.toLocaleString("pt-BR")} pedidos encontrados</span>
        </div>
      </Card>

      <div className="space-y-3">
        <TableShell
          columns={["Pedido", "Cliente", "Produto", "Qtd.", "Total", "Status", "Pagamento", "Criado em"]}
          caption="Tabela de pedidos"
        >
          {orders.rows.length > 0 ? (
            orders.rows.map((row) => (
              <tr key={row.id} className="border-b border-border/70 last:border-b-0">
                <td className="px-5 py-4 font-mono text-xs text-muted-strong" title={row.id}>{row.id.slice(0, 8)}…</td>
                <td className="px-5 py-4 font-mono text-xs text-muted">{row.buyer_discord_id}</td>
                <td className="px-5 py-4 text-xs text-muted">
                  {row.items.length > 0 ? (
                    <ul className="space-y-1">
                      {row.items.map((item) => (
                        <li key={item.productId} title={item.productId}>
                          <span className="font-medium text-muted-strong">{item.productName}</span>
                          {" ×"}{item.quantity.toLocaleString("pt-BR")}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="font-mono" title={row.product_id}>{row.product_id.slice(0, 8)}…</span>
                  )}
                </td>
                <td className="px-5 py-4 text-sm font-medium">{row.quantity.toLocaleString("pt-BR")}</td>
                <td className="px-5 py-4 text-sm font-medium">{formatBrl(row.sale_price_cents)}</td>
                <td className="px-5 py-4">
                  <Badge tone={orderStatusTone(row.status)}>{ORDER_STATUS_LABELS[row.status] ?? row.status}</Badge>
                </td>
                <td className="px-5 py-4 text-xs text-muted">
                  {row.late_payment_detected_at ? (
                    <span className="font-medium text-danger">
                      Pago após o prazo · {dateTime(row.paid_at ?? row.late_payment_detected_at)}
                    </span>
                  ) : row.paid_at ? dateTime(row.paid_at) : "Pendente"}
                </td>
                <td className="px-5 py-4 text-xs text-muted">{dateTime(row.created_at)}</td>
              </tr>
            ))
          ) : (
            <TableEmptyRow colSpan={8}>
              <EmptyState
                icon={ReceiptText}
                title="Nenhum pedido encontrado"
                description="Altere o período ou o status para consultar outros pedidos."
                compact
              />
            </TableEmptyRow>
          )}
        </TableShell>

        <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted">
            Mostrando {firstVisible.toLocaleString("pt-BR")}–{lastVisible.toLocaleString("pt-BR")} de {orders.total.toLocaleString("pt-BR")}
          </p>
          <div className="flex items-center gap-2">
            <LinkButton
              href={buildOrdersHref({ ...currentState, page: Math.max(1, orders.page - 1) })}
              variant="secondary"
              size="sm"
              aria-disabled={orders.page <= 1}
              className={orders.page <= 1 ? "pointer-events-none opacity-45" : ""}
            >
              Anterior
            </LinkButton>
            <span className="min-w-20 text-center text-xs text-muted-strong">
              {orders.page} de {orders.totalPages}
            </span>
            <LinkButton
              href={buildOrdersHref({ ...currentState, page: Math.min(orders.totalPages, orders.page + 1) })}
              variant="secondary"
              size="sm"
              aria-disabled={orders.page >= orders.totalPages}
              className={orders.page >= orders.totalPages ? "pointer-events-none opacity-45" : ""}
            >
              Próxima
            </LinkButton>
          </div>
        </div>
      </div>
    </div>
  );
}

import type { Metadata } from "next";
import { CalendarDays, CircleDollarSign, Filter, ReceiptText } from "lucide-react";
import { formatBrl } from "@godawp/domain";

import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { Button, LinkButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select } from "@/components/ui/form-field";
import { TableEmptyRow, TableShell } from "@/components/ui/table-shell";
import { getPaidOrderSummary, listOrders } from "@/lib/data/admin-repository";
import { ORDERS_PERIOD_OPTIONS, resolveOrdersPeriod } from "@/lib/orders-period";

export const metadata: Metadata = { title: "Pedidos" };

type OrdersPageProps = {
  searchParams: Promise<{
    period?: string | string[];
    from?: string | string[];
    to?: string | string[];
  }>;
};

type BadgeTone = "neutral" | "success" | "warning" | "danger";

function orderStatusTone(status: string): BadgeTone {
  if (status === "paid" || status === "delivered") return "success";
  if (["failed", "cancelled", "expired", "refunded"].includes(status)) return "danger";
  if (["awaiting_payment", "processing"].includes(status)) return "warning";
  return "neutral";
}

function dateTime(value: string): string {
  return new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

export default async function OrdersPage({ searchParams }: OrdersPageProps) {
  const period = resolveOrdersPeriod(await searchParams);
  const [rows, paidSummary] = await Promise.all([
    listOrders(period, 500),
    getPaidOrderSummary(period),
  ]);

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Operação"
        title="Pedidos"
        description="Acompanhe pedidos, pagamentos e o total recebido em qualquer período."
      />

      <section aria-label="Resumo dos pedidos" className="grid gap-4 lg:grid-cols-2">
        <Card className="relative overflow-hidden p-5 sm:p-6">
          <div aria-hidden="true" className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-success/70 to-transparent" />
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.13em] text-muted">
                Total recebido
              </p>
              <p className="mt-2 text-3xl font-semibold tracking-[-0.045em] text-foreground">
                {formatBrl(paidSummary.totalReceivedCents)}
              </p>
              <p className="mt-2 text-sm text-muted">
                {paidSummary.paidOrdersCount.toLocaleString("pt-BR")} pedidos com status paid
              </p>
            </div>
            <span className="grid size-11 shrink-0 place-items-center rounded-xl border border-success/25 bg-success/[0.08] text-success">
              <CircleDollarSign aria-hidden="true" className="size-5" />
            </span>
          </div>
          <div className="mt-5 border-t border-border pt-4 text-xs text-muted">
            Somente pedidos criados em <strong className="font-medium text-muted-strong">{period.label}</strong> e cujo status atual é exatamente <strong className="font-medium text-success">paid</strong>.
          </div>
        </Card>

        <Card className="p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.13em] text-muted">
                Pedidos no período
              </p>
              <p className="mt-2 text-3xl font-semibold tracking-[-0.045em] text-foreground">
                {rows.length.toLocaleString("pt-BR")}
              </p>
              <p className="mt-2 text-sm text-muted">Exibidos do mais recente para o mais antigo</p>
            </div>
            <span className="grid size-11 shrink-0 place-items-center rounded-xl border border-gold/25 bg-gold/[0.08] text-gold-bright">
              <ReceiptText aria-hidden="true" className="size-5" />
            </span>
          </div>
          <div className="mt-5 border-t border-border pt-4 text-xs text-muted">
            O total acima ignora pending, awaiting_payment, processing e qualquer outro status.
          </div>
        </Card>
      </section>

      <Card className="p-4 sm:p-5">
        <form method="get" className="grid gap-4 lg:grid-cols-[minmax(12rem,.8fr)_minmax(10rem,.6fr)_minmax(10rem,.6fr)_auto] lg:items-end">
          <Field label="Período" htmlFor="orders-period">
            <Select id="orders-period" name="period" defaultValue={period.key}>
              {ORDERS_PERIOD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Data inicial" htmlFor="orders-from" hint="Personalizado">
            <Input id="orders-from" name="from" type="date" defaultValue={period.fromInput} />
          </Field>
          <Field label="Data final" htmlFor="orders-to" hint="Personalizado">
            <Input id="orders-to" name="to" type="date" defaultValue={period.toInput} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit">
              <Filter aria-hidden="true" className="size-4" />
              Aplicar
            </Button>
            <LinkButton href="/pedidos" variant="secondary">
              Limpar
            </LinkButton>
          </div>
        </form>
        {period.error ? (
          <p className="mt-4 rounded-xl border border-danger/25 bg-danger/[0.07] px-4 py-3 text-sm text-danger" role="alert">
            {period.error} O painel exibiu todo o histórico para não ocultar pedidos.
          </p>
        ) : null}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs text-muted">
          <span className="inline-flex items-center gap-2">
            <CalendarDays aria-hidden="true" className="size-4" />
            Período aplicado: {period.label}
          </span>
          <span>Somente leitura · {rows.length.toLocaleString("pt-BR")} registros</span>
        </div>
      </Card>

      <TableShell
        columns={["Pedido", "Cliente", "Produto", "Qtd.", "Total", "Status", "Pagamento", "Criado em"]}
        caption="Tabela de pedidos"
      >
        {rows.length > 0 ? (
          rows.map((row) => (
            <tr key={row.id} className="border-b border-border/70 last:border-b-0">
              <td className="px-5 py-4 font-mono text-xs text-muted-strong" title={row.id}>{row.id.slice(0, 8)}…</td>
              <td className="px-5 py-4 font-mono text-xs text-muted">{row.buyer_discord_id}</td>
              <td className="px-5 py-4 font-mono text-xs text-muted" title={row.product_id}>{row.product_id.slice(0, 8)}…</td>
              <td className="px-5 py-4 text-sm font-medium">{row.quantity.toLocaleString("pt-BR")}</td>
              <td className="px-5 py-4 text-sm font-medium">{formatBrl(row.sale_price_cents)}</td>
              <td className="px-5 py-4">
                <Badge tone={orderStatusTone(row.status)}>{row.status}</Badge>
              </td>
              <td className="px-5 py-4 text-xs text-muted">{row.paid_at ? dateTime(row.paid_at) : "Pendente"}</td>
              <td className="px-5 py-4 text-xs text-muted">{dateTime(row.created_at)}</td>
            </tr>
          ))
        ) : (
          <TableEmptyRow colSpan={8}>
            <EmptyState
              icon={ReceiptText}
              title="Nenhum pedido no período"
              description="Altere o período para consultar outros pedidos."
              compact
            />
          </TableEmptyRow>
        )}
      </TableShell>
    </div>
  );
}

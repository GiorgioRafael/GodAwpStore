import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Banknote,
  Boxes,
  CalendarDays,
  CircleDollarSign,
  ClipboardList,
  PackageSearch,
  ReceiptText,
  Tags,
} from "lucide-react";
import { formatBrl, formatDateTimePtBr } from "@godawp/domain";
import { PageHeader } from "@/components/admin/page-header";
import { MetricCard } from "@/components/admin/metric-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  getDashboardSummary,
  getPaidPixMetrics,
  listAuditEvents,
  listProductStock,
} from "@/lib/data/admin-repository";

export const metadata: Metadata = {
  title: "Visão geral",
};

const actionLabels: Record<string, string> = {
  "game.create": "Jogo criado",
  "game.update": "Jogo atualizado",
  "substore.create": "Subloja criada",
  "substore.update": "Subloja atualizada",
  "product.create": "Produto criado",
  "product.update": "Produto atualizado",
  "whitelist.create": "Discord ID autorizado",
  "whitelist.update": "Whitelist atualizada",
  "inventory.import": "Estoque importado",
  "inventory.reveal": "Unidade revelada",
  "inventory.status_change": "Estado de estoque alterado",
  "settings.update": "Configurações atualizadas",
};

export default async function DashboardPage() {
  const [summary, paidPix, lowStock, audit] = await Promise.all([
    getDashboardSummary(),
    getPaidPixMetrics(),
    listProductStock({ lowOnly: true }),
    listAuditEvents(6),
  ]);
  const salesMetrics = [
    {
      label: "Receita bruta Pix",
      value: formatBrl(paidPix.grossRevenueCents),
      detail: "Somente pagamentos LivePix confirmados",
      icon: CircleDollarSign,
    },
    {
      label: "Pix pagos",
      value: paidPix.paidOrdersCount.toLocaleString("pt-BR"),
      detail: "Pedidos únicos, sem pendentes ou reembolsos",
      icon: ReceiptText,
    },
    {
      label: "Últimos 30 dias",
      value: formatBrl(paidPix.grossRevenueLast30DaysCents),
      detail: "Receita bruta em janela móvel",
      icon: CalendarDays,
    },
    {
      label: "Ticket médio",
      value: formatBrl(paidPix.averageOrderCents),
      detail: "Média por Pix confirmado",
      icon: Banknote,
    },
  ];
  const operationalMetrics = [
    {
      label: "Produtos",
      value: summary.productsCount.toLocaleString("pt-BR"),
      detail: `${summary.gamesCount} jogos e ${summary.substoresCount} sublojas`,
      icon: Tags,
    },
    {
      label: "Unidades disponíveis",
      value: summary.availableUnitsCount.toLocaleString("pt-BR"),
      detail: "Calculado pelo estado do estoque",
      icon: Boxes,
    },
    {
      label: "Pedidos",
      value: summary.ordersCount.toLocaleString("pt-BR"),
      detail: `${summary.deliveredOrdersCount} concluídos`,
      icon: ClipboardList,
    },
    {
      label: "Saldo no ledger",
      value: formatBrl(summary.ledgerBalanceCents),
      detail: "Valores em BRL",
      icon: Banknote,
    },
  ];
  const revenuePeriods = [
    { label: "Hoje", value: paidPix.grossRevenueTodayCents },
    { label: "Últimos 7 dias", value: paidPix.grossRevenueLast7DaysCents },
    { label: "Últimos 30 dias", value: paidPix.grossRevenueLast30DaysCents },
  ];
  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Visão geral"
        title="Central de operação"
        description="Acompanhe a receita bruta dos Pix pagos, o catálogo, o estoque e a atividade da plataforma."
        actions={
          <Link
            href="/catalogo/produtos"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-gold/55 bg-gold px-4 text-sm font-medium text-[#171208] shadow-gold transition-colors hover:border-gold-bright hover:bg-gold-bright"
          >
            Ver catálogo
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        }
      />

      <section aria-labelledby="sales-metrics-title" className="space-y-4">
        <div>
          <h2 id="sales-metrics-title" className="text-base font-semibold tracking-tight text-foreground">
            Vendas confirmadas
          </h2>
          <p className="mt-1 text-sm text-muted">
            Valores calculados exclusivamente com pedidos LivePix que tiveram o pagamento confirmado.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {salesMetrics.map((metric) => (
            <MetricCard key={metric.label} {...metric} />
          ))}
        </div>
      </section>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold tracking-tight">Entradas por período</h2>
            <p className="mt-1 text-sm text-muted">Receita bruta recebida por Pix confirmado.</p>
          </div>
          <Badge tone={paidPix.lastPaidAt ? "success" : "neutral"}>
            {paidPix.lastPaidAt
              ? `Último Pix: ${formatDateTimePtBr(paidPix.lastPaidAt)}`
              : "Nenhum Pix pago"}
          </Badge>
        </CardHeader>
        <CardContent className="grid gap-3 pt-0 sm:grid-cols-3">
          {revenuePeriods.map((period) => (
            <div key={period.label} className="rounded-xl border border-border bg-surface-muted/35 px-4 py-3.5">
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted">{period.label}</p>
              <p className="mt-2 text-lg font-semibold tracking-[-0.03em] text-foreground">
                {formatBrl(period.value)}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>

      <section aria-labelledby="operations-metrics-title" className="space-y-4">
        <div>
          <h2 id="operations-metrics-title" className="text-base font-semibold tracking-tight text-foreground">
            Operação
          </h2>
          <p className="mt-1 text-sm text-muted">Indicadores de catálogo, estoque, pedidos e saldo.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {operationalMetrics.map((metric) => (
            <MetricCard key={metric.label} {...metric} />
          ))}
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(20rem,.75fr)]">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold tracking-tight">Atividade recente</h2>
              <p className="mt-1 text-sm text-muted">Pagamentos, entregas e alterações administrativas.</p>
            </div>
            <Badge tone="neutral">Tempo real</Badge>
          </CardHeader>
          <CardContent className="pt-2">
            {audit.length === 0 ? (
              <EmptyState
                icon={Activity}
                title="Nenhuma atividade registrada"
                description="Os eventos aparecerão aqui assim que a operação começar. Nenhuma movimentação de teste foi criada."
                compact
              />
            ) : (
              <ul className="divide-y divide-border" aria-label="Atividade administrativa recente">
                {audit.map((event) => (
                  <li key={event.id} className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {actionLabels[event.action] ?? event.action}
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        Discord {event.actor_discord_user_id ?? "sistema"} · {event.entity_type}
                      </p>
                    </div>
                    <time className="shrink-0 text-xs text-muted" dateTime={event.created_at}>
                      {formatDateTimePtBr(event.created_at)}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold tracking-tight">Estoque baixo</h2>
                <p className="mt-1 text-sm text-muted">Produtos abaixo do limite definido.</p>
              </div>
              <span className="grid size-9 place-items-center rounded-xl border border-warning/20 bg-warning/[0.07] text-warning">
                <AlertTriangle aria-hidden="true" className="size-4" />
              </span>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {lowStock.length === 0 ? (
              <EmptyState
                icon={PackageSearch}
                title="Sem alertas"
                description="Nenhum produto ativo está abaixo do limite definido."
                compact
              />
            ) : (
              <ul className="space-y-2">
                {lowStock.slice(0, 6).map((stock) => (
                  <li key={stock.product_id} className="flex items-center justify-between gap-3 rounded-xl border border-warning/15 bg-warning/[0.04] px-3 py-2.5">
                    <span className="truncate text-sm text-foreground">{stock.product_name}</span>
                    <Badge tone="warning">
                      {stock.available_count}/{stock.low_stock_threshold}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-xl border border-gold/20 bg-gold/[0.06] text-gold">
              <Activity aria-hidden="true" className="size-[18px]" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-foreground">Ambiente pronto para integração</h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
                Os indicadores são calculados diretamente no PostgreSQL e não usam dados demonstrativos. A receita
                bruta considera apenas pedidos com Pix LivePix confirmado como pago.
              </p>
            </div>
          </div>
          <Link href="/configuracoes" className="shrink-0 text-sm font-medium text-gold-bright hover:text-gold">
            Revisar configurações
          </Link>
        </div>
      </Card>
    </div>
  );
}

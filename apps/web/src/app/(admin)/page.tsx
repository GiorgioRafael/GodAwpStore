import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Boxes,
  CircleDollarSign,
  ClipboardList,
  PackageSearch,
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
  const [summary, lowStock, audit] = await Promise.all([
    getDashboardSummary(),
    listProductStock({ lowOnly: true }),
    listAuditEvents(6),
  ]);
  const metrics = [
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
      icon: CircleDollarSign,
    },
  ];
  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Visão geral"
        title="Central de operação"
        description="Acompanhe catálogo, estoque e atividade da plataforma em um só lugar."
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

      <section aria-label="Indicadores principais" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <MetricCard key={metric.label} {...metric} />
        ))}
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
                Os indicadores são calculados diretamente no PostgreSQL e não usam dados demonstrativos.
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

import Link from "next/link";
import { formatBrl } from "@godawp/domain";
import {
  CircleDollarSign,
  ExternalLink,
  MousePointerClick,
  ShoppingBag,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";

import { MasterMetricCard, MasterPageHeader } from "@/components/platform/master-metric-card";
import { SobremesasFitChart } from "@/components/platform/sobremesas-fit-chart";
import {
  SobremesasFitElements,
  SobremesasFitFunnel,
  SobremesasFitOrders,
  SobremesasFitSources,
} from "@/components/platform/sobremesas-fit-panels";
import type { SobremesasFitDashboard, SobremesasFitResult } from "@/lib/data/sobremesas-fit";
import { MASTER_ADMIN_TABS } from "@/lib/master-admin-tabs";

/**
 * A aba do e-book.
 *
 * Diferente das lojas de bots, aqui a 101Devs vê o funil inteiro: o produto é
 * dela, então a pergunta não é só quanto entrou, é onde o visitante desistiu.
 */

export const SOBREMESAS_FIT_PERIODS = [
  { id: "7d", label: "7 dias" },
  { id: "30d", label: "30 dias" },
  { id: "90d", label: "90 dias" },
] as const;

export type SobremesasFitPeriod = (typeof SOBREMESAS_FIT_PERIODS)[number]["id"];

export function parseSobremesasFitPeriod(value: string | undefined): SobremesasFitPeriod {
  return SOBREMESAS_FIT_PERIODS.some((period) => period.id === value)
    ? (value as SobremesasFitPeriod)
    : "30d";
}

const TAB_HREF = MASTER_ADMIN_TABS.find((tab) => tab.id === "sobremesas-fit")?.href ?? "/admin";

function changeDetail(change: number | null | undefined, suffix = "em relação ao período anterior") {
  if (change == null) return "Sem base comparável no período anterior";
  const prefix = change > 0 ? "+" : "";
  return `${prefix}${change.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% ${suffix}`;
}

function percent(value: number) {
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-[#0b121c] px-4 py-3.5">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1.5 text-lg font-semibold tabular-nums tracking-[-0.02em] text-white">{value}</p>
      {detail ? <p className="mt-0.5 text-[11px] leading-4 text-slate-500">{detail}</p> : null}
    </div>
  );
}

function PeriodTabs({ active }: { active: SobremesasFitPeriod }) {
  return (
    <div className="inline-flex h-10 items-center gap-1 rounded-lg border border-slate-800 bg-[#0b121c] p-1">
      {SOBREMESAS_FIT_PERIODS.map((period) => (
        <Link
          key={period.id}
          href={period.id === "30d" ? TAB_HREF : `${TAB_HREF}?periodo=${period.id}`}
          aria-current={period.id === active ? "page" : undefined}
          className={
            period.id === active
              ? "rounded-md bg-violet-500/15 px-3 py-1.5 text-xs font-medium text-violet-200"
              : "rounded-md px-3 py-1.5 text-xs font-medium text-slate-400 transition-colors hover:text-white"
          }
        >
          {period.label}
        </Link>
      ))}
    </div>
  );
}

function Unavailable({ message, unconfigured }: { message: string; unconfigured: boolean }) {
  return (
    <div className="space-y-5">
      <MasterPageHeader
        title="Sobremesas Fit"
        description="Audiência, funil e vendas do e-book de receitas."
      />
      <div
        role="status"
        className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] p-6 text-sm text-amber-100"
      >
        <p className="font-medium">{message}</p>
        {unconfigured ? (
          <p className="mt-2 text-amber-200/80">
            Defina <code className="font-mono text-xs">SOBREMESAS_FIT_METRICS_KEY</code> nesta
            aplicação com a mesma chave publicada em{" "}
            <code className="font-mono text-xs">METRICS_API_KEY</code> no site de receitas. Sem ela, a
            API de métricas responde fechada — que é o comportamento correto, não uma falha.
          </p>
        ) : (
          <p className="mt-2 text-amber-200/80">
            O painel volta a mostrar os números assim que o site de receitas responder. Nada foi
            perdido: as métricas continuam sendo gravadas do outro lado.
          </p>
        )}
      </div>
    </div>
  );
}

export function SobremesasFitView({
  result,
  period,
}: {
  result: SobremesasFitResult<SobremesasFitDashboard>;
  period: SobremesasFitPeriod;
}) {
  if (result.status !== "ok") {
    return <Unavailable message={result.error} unconfigured={result.status === "unconfigured"} />;
  }

  const { totals, change, daily, funnel, breakdowns, orders, siteUrl, range } = result.data;
  const RevenueIcon = (change.revenue ?? 0) < 0 ? TrendingDown : TrendingUp;

  return (
    <div className="space-y-5 sm:space-y-6">
      <MasterPageHeader
        title="Sobremesas Fit"
        description={`Audiência, funil e vendas do e-book. Período de ${range.from} a ${range.to}.`}
        aside={
          <>
            <PeriodTabs active={period} />
            <a
              href={siteUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-700 bg-[#0b121c] px-3.5 text-xs font-medium text-slate-300 transition-colors hover:border-slate-600 hover:text-white"
            >
              <ExternalLink aria-hidden="true" className="size-3.5" />
              Abrir o site
            </a>
          </>
        }
      />

      <section aria-label="Resumo do período" className="grid gap-3 sm:grid-cols-2 min-[1100px]:grid-cols-4">
        <MasterMetricCard
          label="Receita no período"
          value={formatBrl(totals.revenueCents)}
          detail={changeDetail(change.revenue)}
          icon={CircleDollarSign}
          accent="violet"
        />
        <MasterMetricCard
          label="Vendas aprovadas"
          value={totals.purchases.toLocaleString("pt-BR")}
          detail={`Ticket médio de ${formatBrl(totals.averageOrderValueCents)}`}
          icon={ShoppingBag}
          accent="success"
        />
        <MasterMetricCard
          label="Visitas"
          value={totals.sessions.toLocaleString("pt-BR")}
          detail={changeDetail(change.sessions)}
          icon={Users}
        />
        <MasterMetricCard
          label="Conversão"
          value={percent(totals.conversionRate)}
          detail={`${percent(totals.paymentConversionRate)} de quem abriu o pagamento comprou`}
          icon={RevenueIcon}
        />
      </section>

      <section
        aria-label="Indicadores complementares"
        className="grid gap-3 grid-cols-2 sm:grid-cols-3 min-[1100px]:grid-cols-6"
      >
        <Stat
          label="Visitantes"
          value={totals.visitors.toLocaleString("pt-BR")}
          detail={`${totals.newVisitors.toLocaleString("pt-BR")} novos`}
        />
        <Stat
          label="Páginas vistas"
          value={totals.pageviews.toLocaleString("pt-BR")}
          detail={`${totals.pagesPerSession.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} por visita`}
        />
        <Stat
          label="Cliques em comprar"
          value={totals.ctaClicks.toLocaleString("pt-BR")}
          detail={percent(totals.checkoutRate) + " abriram o checkout"}
        />
        <Stat
          label="Foram ao pagamento"
          value={totals.checkoutStarts.toLocaleString("pt-BR")}
          detail={percent(totals.checkoutStartRate) + " das visitas"}
        />
        <Stat
          label="Não concluídas"
          value={(totals.pendingPurchases + totals.rejectedPurchases).toLocaleString("pt-BR")}
          detail={`${totals.pendingPurchases.toLocaleString("pt-BR")} pendentes · ${totals.rejectedPurchases.toLocaleString("pt-BR")} recusadas`}
        />
        <Stat
          label="E-books entregues"
          value={totals.delivered.toLocaleString("pt-BR")}
          detail={
            totals.refunds > 0
              ? `${totals.refunds.toLocaleString("pt-BR")} reembolsos (${formatBrl(totals.refundedRevenueCents)})`
              : "Nenhum reembolso no período"
          }
        />
      </section>

      <SobremesasFitChart daily={daily} />

      <div className="grid gap-5 min-[1100px]:grid-cols-2">
        <SobremesasFitFunnel steps={funnel} />
        <SobremesasFitSources rows={breakdowns.sources} />
      </div>

      <SobremesasFitElements rows={breakdowns.elements} />
      <SobremesasFitOrders orders={orders} />

      <p className="flex items-start gap-2 rounded-2xl border border-slate-800 bg-[#0b121c] p-5 text-xs leading-5 text-slate-500">
        <MousePointerClick aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-slate-600" />
        A receita do e-book é venda direta da 101Devs — entra inteira no consolidado da visão geral,
        sem comissão. O comprador aparece mascarado porque a API nunca entrega o e-mail completo.
      </p>
    </div>
  );
}

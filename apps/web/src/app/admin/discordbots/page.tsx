import type { Metadata } from "next";
import { formatBrl } from "@godawp/domain";
import {
  Bot,
  CalendarDays,
  CircleDollarSign,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  WalletCards,
  type LucideIcon,
} from "lucide-react";

import { BusinessBotsTable } from "@/components/platform/business-bots-table";
import { MasterCommissionForm } from "@/components/platform/master-commission-form";
import { RevenueHistoryChart } from "@/components/platform/revenue-history-chart";
import { formatCommission } from "@/components/admin/admin-format";
import {
  getDiscordBotsDashboard,
  type DiscordBotsDashboard,
} from "@/lib/data/discord-bots-dashboard";

export const metadata: Metadata = {
  title: "Bots Discord | 101Devs",
  description: "Painel privado de gestão, faturamento e comissão dos serviços da 101Devs.",
};

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  accent = "neutral",
}: {
  label: string;
  value: string;
  detail: string;
  icon: LucideIcon;
  accent?: "neutral" | "violet" | "success";
}) {
  const iconClass =
    accent === "violet"
      ? "border-violet-400/15 bg-violet-500/[0.08] text-violet-300"
      : accent === "success"
        ? "border-emerald-400/15 bg-emerald-400/[0.07] text-emerald-300"
        : "border-slate-700 bg-slate-800/50 text-slate-400";

  return (
    <article className="min-h-36 rounded-2xl border border-slate-800 bg-[#0b121c] p-5 shadow-[0_18px_55px_rgba(0,0,0,.16)]">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm font-medium text-slate-300">{label}</p>
        <span className={`grid size-9 shrink-0 place-items-center rounded-lg border ${iconClass}`}>
          <Icon aria-hidden="true" className="size-[17px]" strokeWidth={1.8} />
        </span>
      </div>
      <p className="mt-4 text-2xl font-semibold tracking-[-0.035em] text-white sm:text-[28px]">{value}</p>
      <p className="mt-2 text-xs leading-5 text-slate-500">{detail}</p>
    </article>
  );
}

function currentPeriodLabel() {
  const label = new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  }).format(new Date());
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function revenueChangeDetail(change: number | null) {
  if (change == null) return "Sem base comparável no mês anterior";
  const prefix = change > 0 ? "+" : "";
  return `${prefix}${change.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% em relação ao mês anterior`;
}

export function DiscordBotsDashboardView({
  dashboard,
}: {
  dashboard: DiscordBotsDashboard;
}) {
  const change = dashboard.revenueChangePercent;
  const ChangeIcon = change != null && change < 0 ? TrendingDown : TrendingUp;

  return (
    <div id="visao-geral" className="space-y-5 sm:space-y-6">
      <header className="flex flex-col gap-5 pb-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.035em] text-white sm:text-[32px]">
            Visão geral dos serviços
          </h1>
          <p className="mt-2 text-sm text-slate-400 sm:text-base">
            GWStore e Loja TH, com vendas, bots e comissões em um só lugar.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-700 bg-[#0b121c] px-3.5 text-xs font-medium text-slate-300">
            <CalendarDays aria-hidden="true" className="size-4 text-slate-500" />
            {currentPeriodLabel()}
          </span>
          <span className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-800 px-3.5 text-xs text-slate-500">
            <RefreshCw aria-hidden="true" className="size-3.5" />
            Dados em tempo real
          </span>
        </div>
      </header>

      <section aria-label="Resumo financeiro e operacional" className="grid gap-3 sm:grid-cols-2 min-[1100px]:grid-cols-4">
        <MetricCard
          label="Faturamento este mês"
          value={formatBrl(dashboard.currentMonthRevenueCents)}
          detail={`${dashboard.currentMonthPaidOrdersCount.toLocaleString("pt-BR")} ${dashboard.currentMonthPaidOrdersCount === 1 ? "pedido pago" : "pedidos pagos"}`}
          icon={CircleDollarSign}
          accent="violet"
        />
        <MetricCard
          label="Faturamento mês anterior"
          value={formatBrl(dashboard.previousMonthRevenueCents)}
          detail={revenueChangeDetail(change)}
          icon={ChangeIcon}
        />
        <MetricCard
          label="Comissão estimada"
          value={formatBrl(dashboard.currentMonthCommissionCents)}
          detail={`${formatCommission(dashboard.globalCommissionBps)} padrão sobre o faturamento bruto pago`}
          icon={WalletCards}
          accent="violet"
        />
        <MetricCard
          label="Bots ativos"
          value={`${dashboard.activeBotsCount.toLocaleString("pt-BR")} ativos`}
          detail={`${dashboard.onlineBotsCount.toLocaleString("pt-BR")} online agora · ${dashboard.servicesCount.toLocaleString("pt-BR")} serviços`}
          icon={Bot}
          accent="success"
        />
      </section>

      <div className="grid gap-5 min-[1100px]:grid-cols-[minmax(0,1.75fr)_minmax(19rem,.85fr)]">
        <RevenueHistoryChart data={dashboard.monthlyRevenue} />
        <MasterCommissionForm globalCommissionBps={dashboard.globalCommissionBps} />
      </div>

      <BusinessBotsTable services={dashboard.services} />
    </div>
  );
}

export default async function DiscordBotsAdminPage() {
  const dashboard = await getDiscordBotsDashboard();
  return <DiscordBotsDashboardView dashboard={dashboard} />;
}

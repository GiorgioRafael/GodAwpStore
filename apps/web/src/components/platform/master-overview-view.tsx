import Link from "next/link";
import { formatBrl } from "@godawp/domain";
import {
  ArrowUpRight,
  Bot,
  CakeSlice,
  CalendarDays,
  CircleDollarSign,
  RefreshCw,
  Store,
  TrendingDown,
  TrendingUp,
  WalletCards,
  type LucideIcon,
} from "lucide-react";

import { formatCommission } from "@/components/admin/admin-format";
import { MasterCommissionForm } from "@/components/platform/master-commission-form";
import {
  MasterMetricCard,
  MasterPageHeader,
  currentPeriodLabel,
} from "@/components/platform/master-metric-card";
import { MasterRevenueChart } from "@/components/platform/master-revenue-chart";
import type { MasterOverview } from "@/lib/data/master-overview";
import { MASTER_ADMIN_TABS } from "@/lib/master-admin-tabs";

/**
 * A aba de abertura do painel.
 *
 * Responde a uma pergunta só: quanto a 101Devs faturou. Por isso o número
 * grande é comissão mais e-book, e não o faturamento bruto das lojas — aquele
 * dinheiro passa pela casa, mas não é dela.
 */

function changeDetail(change: number | null) {
  if (change == null) return "Sem base comparável no mês anterior";
  const prefix = change > 0 ? "+" : "";
  return `${prefix}${change.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% em relação ao mês anterior`;
}

function ProductCard({
  href,
  name,
  value,
  detail,
  icon: Icon,
  warning,
}: {
  href: string;
  name: string;
  value: string;
  detail: string;
  icon: LucideIcon;
  warning?: string | null;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col rounded-2xl border border-slate-800 bg-[#0b121c] p-5 transition-colors hover:border-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-slate-700 bg-slate-800/50 text-slate-400">
            <Icon aria-hidden="true" className="size-[17px]" strokeWidth={1.8} />
          </span>
          <p className="text-sm font-medium text-white">{name}</p>
        </div>
        <ArrowUpRight
          aria-hidden="true"
          className="size-4 text-slate-600 transition-colors group-hover:text-violet-300"
        />
      </div>
      <p className="mt-4 text-xl font-semibold tracking-[-0.03em] text-white">{value}</p>
      <p className="mt-1.5 text-xs leading-5 text-slate-500">{detail}</p>
      {warning ? <p className="mt-2 text-xs leading-5 text-amber-300">{warning}</p> : null}
    </Link>
  );
}

export function MasterOverviewView({ overview }: { overview: MasterOverview }) {
  const { bots, ebook, currentMonth, months, changePercent, ebookOrdersThisMonth } = overview;
  const ChangeIcon = changePercent != null && changePercent < 0 ? TrendingDown : TrendingUp;
  const tabHref = (id: string) => MASTER_ADMIN_TABS.find((tab) => tab.id === id)?.href ?? "/admin";

  const gwstore = bots.services.find((service) => service.id === "gwstore");
  const thstore = bots.services.find((service) => service.id === "thstore");

  return (
    <div id="visao-geral" className="space-y-5 sm:space-y-6">
      <MasterPageHeader
        title="Visão geral"
        description="Quanto a 101Devs faturou no mês, somando a comissão das lojas de bots e a venda do e-book."
        aside={
          <>
            <span className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-700 bg-[#0b121c] px-3.5 text-xs font-medium text-slate-300">
              <CalendarDays aria-hidden="true" className="size-4 text-slate-500" />
              {currentPeriodLabel()}
            </span>
            <span className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-800 px-3.5 text-xs text-slate-500">
              <RefreshCw aria-hidden="true" className="size-3.5" />
              Dados em tempo real
            </span>
          </>
        }
      />

      <section
        aria-label="Receita da 101Devs no mês"
        className="grid gap-3 sm:grid-cols-2 min-[1100px]:grid-cols-4"
      >
        <MasterMetricCard
          label="Receita da 101Devs"
          value={formatBrl(currentMonth.totalCents)}
          detail={changeDetail(changePercent)}
          icon={CircleDollarSign}
          accent="violet"
        />
        <MasterMetricCard
          label="Comissão dos bots"
          value={formatBrl(currentMonth.botsCommissionCents)}
          detail={`${formatCommission(bots.globalCommissionBps)} sobre o faturamento das lojas`}
          icon={WalletCards}
        />
        <MasterMetricCard
          label="E-book Sobremesas Fit"
          value={formatBrl(currentMonth.ebookRevenueCents)}
          detail={
            ebook.status === "ok"
              ? `${ebookOrdersThisMonth.toLocaleString("pt-BR")} ${ebookOrdersThisMonth === 1 ? "venda aprovada" : "vendas aprovadas"}`
              : ebook.error
          }
          icon={CakeSlice}
          accent="success"
        />
        <MasterMetricCard
          label="Bots ativos"
          value={`${bots.activeBotsCount.toLocaleString("pt-BR")} ativos`}
          detail={`${bots.onlineBotsCount.toLocaleString("pt-BR")} online agora · ${bots.servicesCount.toLocaleString("pt-BR")} lojas`}
          icon={Bot}
          accent="success"
        />
      </section>

      <section aria-label="Produtos" className="grid gap-3 sm:grid-cols-2 min-[1100px]:grid-cols-3">
        <ProductCard
          href={tabHref("gwstore")}
          name="GWStore"
          icon={Store}
          value={formatBrl(gwstore?.currentMonthCommissionCents ?? 0)}
          detail={`Comissão no mês · ${formatBrl(gwstore?.currentMonthRevenueCents ?? 0)} vendidos na loja`}
          warning={gwstore?.error}
        />
        <ProductCard
          href={tabHref("loja-th")}
          name="Loja TH"
          icon={Bot}
          value={formatBrl(thstore?.currentMonthCommissionCents ?? 0)}
          detail={`Comissão no mês · ${formatBrl(thstore?.currentMonthRevenueCents ?? 0)} vendidos na loja`}
          warning={thstore?.error}
        />
        <ProductCard
          href={tabHref("sobremesas-fit")}
          name="Sobremesas Fit"
          icon={CakeSlice}
          value={formatBrl(currentMonth.ebookRevenueCents)}
          detail="Receita no mês · venda direta, sem comissão"
          warning={ebook.status === "ok" ? null : ebook.error}
        />
      </section>

      <div className="grid gap-5 min-[1100px]:grid-cols-[minmax(0,1.75fr)_minmax(19rem,.85fr)]">
        <MasterRevenueChart months={months} />
        <div className="space-y-5">
          <MasterCommissionForm globalCommissionBps={bots.globalCommissionBps} />
          <p className="flex items-start gap-2 rounded-2xl border border-slate-800 bg-[#0b121c] p-5 text-xs leading-5 text-slate-500">
            <ChangeIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-slate-600" />
            O faturamento bruto das lojas de bots não entra nesta soma: ele pertence a quem é dono
            da loja. A 101Devs fica com a comissão, e o e-book é venda direta da casa.
          </p>
        </div>
      </div>
    </div>
  );
}

import "server-only";

import {
  getDiscordBotsDashboard,
  type DiscordBotsDashboard,
} from "@/lib/data/discord-bots-dashboard";
import {
  getSobremesasFitMonthlyRevenue,
  type SobremesasFitMonthlyRevenue,
  type SobremesasFitResult,
} from "@/lib/data/sobremesas-fit";
import { formatDashboardMonth } from "@/lib/discord-bots-dashboard";

/**
 * O consolidado da 101Devs.
 *
 * O faturamento bruto das lojas de bots não entra: aquele dinheiro é do dono da
 * loja, e a 101Devs só recebe a comissão. O e-book é o caso oposto — a venda é
 * inteira da casa. Somar as duas coisas certas é o que faz o total desta tela
 * significar "quanto a 101Devs faturou".
 */

const MONTHS_IN_CHART = 6;

export type MasterOverviewMonth = {
  monthStart: string;
  monthLabel: string;
  botsCommissionCents: number;
  ebookRevenueCents: number;
  totalCents: number;
};

export type MasterOverviewTotals = {
  botsCommissionCents: number;
  ebookRevenueCents: number;
  totalCents: number;
};

export type MasterOverview = {
  bots: DiscordBotsDashboard;
  ebook: SobremesasFitResult<SobremesasFitMonthlyRevenue[]>;
  months: MasterOverviewMonth[];
  currentMonth: MasterOverviewTotals;
  previousMonth: MasterOverviewTotals;
  ebookOrdersThisMonth: number;
  /** Variação do total consolidado contra o mês anterior. */
  changePercent: number | null;
};

export async function getMasterOverview(): Promise<MasterOverview> {
  const [bots, ebook] = await Promise.all([
    getDiscordBotsDashboard(),
    getSobremesasFitMonthlyRevenue(MONTHS_IN_CHART),
  ]);

  // O eixo do gráfico é gerado a partir do calendário, não dos dados. Assim os
  // dois produtos ficam alinhados no mesmo mês mesmo quando um deles não teve
  // movimento nenhum no período.
  const axis = recentMonthStarts(MONTHS_IN_CHART);
  const botsByMonth = new Map(bots.monthlyRevenue.map((month) => [month.monthStart, month]));
  const ebookByMonth = new Map((ebook.data ?? []).map((month) => [month.monthStart, month]));

  const months = axis.map((monthStart) => {
    const botsCommissionCents = botsByMonth.get(monthStart)?.commissionCents ?? 0;
    const ebookRevenueCents = ebookByMonth.get(monthStart)?.revenueCents ?? 0;

    return {
      monthStart,
      monthLabel: formatDashboardMonth(monthStart),
      botsCommissionCents,
      ebookRevenueCents,
      totalCents: botsCommissionCents + ebookRevenueCents,
    };
  });

  const currentMonth = toTotals(months.at(-1));
  const previousMonth = toTotals(months.at(-2));

  return {
    bots,
    ebook,
    months,
    currentMonth,
    previousMonth,
    ebookOrdersThisMonth: ebookByMonth.get(axis.at(-1) ?? "")?.paidOrdersCount ?? 0,
    changePercent:
      previousMonth.totalCents > 0
        ? ((currentMonth.totalCents - previousMonth.totalCents) / previousMonth.totalCents) * 100
        : null,
  };
}

function toTotals(month: MasterOverviewMonth | undefined): MasterOverviewTotals {
  return {
    botsCommissionCents: month?.botsCommissionCents ?? 0,
    ebookRevenueCents: month?.ebookRevenueCents ?? 0,
    totalCents: month?.totalCents ?? 0,
  };
}

const monthFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
});

/** Os N primeiros dias de mês até o mês corrente em São Paulo, do mais antigo ao atual. */
export function recentMonthStarts(count: number, now = new Date()): string[] {
  const [year, month] = monthFormatter.format(now).split("-").map(Number);

  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1 - (count - 1 - index), 1));
    return date.toISOString().slice(0, 10);
  });
}

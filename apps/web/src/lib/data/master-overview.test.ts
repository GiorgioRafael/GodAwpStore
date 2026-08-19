import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getDiscordBotsDashboard: vi.fn(),
  getSobremesasFitMonthlyRevenue: vi.fn(),
}));

vi.mock("@/lib/data/discord-bots-dashboard", () => ({
  getDiscordBotsDashboard: mocks.getDiscordBotsDashboard,
}));
vi.mock("@/lib/data/sobremesas-fit", () => ({
  getSobremesasFitMonthlyRevenue: mocks.getSobremesasFitMonthlyRevenue,
}));

import { getMasterOverview, recentMonthStarts } from "./master-overview";

function botsDashboard(monthlyRevenue: Array<{ monthStart: string; grossRevenueCents: number; commissionCents: number; paidOrdersCount: number }>) {
  return {
    globalCommissionBps: 200,
    monthlyRevenue: monthlyRevenue.map((month) => ({ ...month, monthLabel: month.monthStart })),
    services: [],
    activeBotsCount: 0,
    onlineBotsCount: 0,
    servicesCount: 2,
    currentMonthRevenueCents: 0,
    previousMonthRevenueCents: 0,
    currentMonthCommissionCents: 0,
    currentMonthPaidOrdersCount: 0,
    revenueChangePercent: null,
  };
}

describe("consolidado da 101Devs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T15:00:00Z"));
  });

  it("soma a comissão dos bots com a receita do e-book, nunca o bruto das lojas", async () => {
    const [, , , , previousMonth, currentMonth] = recentMonthStarts(6);
    mocks.getDiscordBotsDashboard.mockResolvedValue(
      botsDashboard([
        { monthStart: previousMonth, grossRevenueCents: 500_000, commissionCents: 10_000, paidOrdersCount: 40 },
        { monthStart: currentMonth, grossRevenueCents: 1_000_000, commissionCents: 20_000, paidOrdersCount: 80 },
      ]),
    );
    mocks.getSobremesasFitMonthlyRevenue.mockResolvedValue({
      status: "ok",
      error: null,
      data: [
        { monthStart: previousMonth, monthLabel: "Jul", revenueCents: 5_970, paidOrdersCount: 3 },
        { monthStart: currentMonth, monthLabel: "Ago", revenueCents: 9_950, paidOrdersCount: 5 },
      ],
    });

    const overview = await getMasterOverview();

    expect(overview.currentMonth).toEqual({
      botsCommissionCents: 20_000,
      ebookRevenueCents: 9_950,
      totalCents: 29_950,
    });
    // O R$ 10.000,00 de faturamento bruto da loja não pode aparecer em lugar nenhum
    // do consolidado: aquele dinheiro é do dono da loja.
    expect(overview.months.every((month) => month.totalCents < 1_000_000)).toBe(true);
    expect(overview.ebookOrdersThisMonth).toBe(5);
  });

  it("calcula a variação sobre o total consolidado", async () => {
    const [, , , , previousMonth, currentMonth] = recentMonthStarts(6);
    mocks.getDiscordBotsDashboard.mockResolvedValue(
      botsDashboard([
        { monthStart: previousMonth, grossRevenueCents: 0, commissionCents: 10_000, paidOrdersCount: 0 },
        { monthStart: currentMonth, grossRevenueCents: 0, commissionCents: 15_000, paidOrdersCount: 0 },
      ]),
    );
    mocks.getSobremesasFitMonthlyRevenue.mockResolvedValue({ status: "ok", error: null, data: [] });

    const overview = await getMasterOverview();

    expect(overview.changePercent).toBeCloseTo(50);
  });

  it("mantém o eixo do gráfico mesmo quando o e-book está indisponível", async () => {
    mocks.getDiscordBotsDashboard.mockResolvedValue(botsDashboard([]));
    mocks.getSobremesasFitMonthlyRevenue.mockResolvedValue({
      status: "error",
      data: null,
      error: "Não foi possível atualizar as métricas do 40 Sobremesas Fit agora.",
    });

    const overview = await getMasterOverview();

    expect(overview.months).toHaveLength(6);
    expect(overview.currentMonth.totalCents).toBe(0);
    expect(overview.changePercent).toBeNull();
    expect(overview.ebook.status).toBe("error");
  });

  it("gera o eixo de meses no fuso de São Paulo", () => {
    expect(recentMonthStarts(3, new Date("2026-08-19T15:00:00Z"))).toEqual([
      "2026-06-01",
      "2026-07-01",
      "2026-08-01",
    ]);
    // 01:30 UTC do dia 1º de setembro ainda é agosto em São Paulo.
    expect(recentMonthStarts(1, new Date("2026-09-01T01:30:00Z"))).toEqual(["2026-08-01"]);
  });
});

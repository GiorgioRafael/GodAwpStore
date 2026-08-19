import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  getSobremesasFitDashboard,
  getSobremesasFitMonthlyRevenue,
  monthWindow,
} from "./sobremesas-fit";

const fetchMock = vi.fn();

function metrics(overrides: Record<string, number> = {}) {
  return {
    sessions: 0,
    visitors: 0,
    newVisitors: 0,
    returningVisitors: 0,
    pageviews: 0,
    ctaClicks: 0,
    checkoutViews: 0,
    checkoutStarts: 0,
    purchases: 0,
    revenue: 0,
    netRevenue: 0,
    refunds: 0,
    refundedRevenue: 0,
    pendingPurchases: 0,
    rejectedPurchases: 0,
    delivered: 0,
    averageOrderValue: 0,
    revenuePerSession: 0,
    pagesPerSession: 0,
    averageEngagementSeconds: 0,
    conversionRate: 0,
    checkoutRate: 0,
    checkoutStartRate: 0,
    paymentConversionRate: 0,
    scroll: {},
    ...overrides,
  };
}

function point(bucket: string, overrides: Record<string, number> = {}) {
  return {
    bucket,
    sessions: 0,
    visitors: 0,
    pageviews: 0,
    ctaClicks: 0,
    checkoutViews: 0,
    checkoutStarts: 0,
    purchases: 0,
    revenue: 0,
    conversionRate: 0,
    ...overrides,
  };
}

function summaryPayload() {
  return {
    range: { from: "2026-07-21", to: "2026-08-19", days: 30 },
    totals: metrics({ purchases: 3, revenue: 59.7, netRevenue: 59.7, averageOrderValue: 19.9 }),
    previous: metrics({ purchases: 1, revenue: 19.9 }),
    change: { revenue: 200, sessions: null },
    timeseries: [point("2026-08-18", { sessions: 12, revenue: 19.9, purchases: 1 })],
    funnel: [{ step: "visit", label: "Visitou o site", visits: 40, shareOfVisits: 100, shareOfPrevious: 100, dropOff: 0 }],
    breakdowns: { sources: [], pages: [], devices: [], countries: [], elements: [] },
    recentOrders: [
      {
        paymentId: "1",
        status: "approved",
        amount: 19.9,
        currency: "BRL",
        method: "pix",
        day: "2026-08-18",
        createdAt: "2026-08-18T18:00:00.000Z",
        approvedAt: "2026-08-18T18:01:00.000Z",
        delivered: true,
        buyerMask: "m***a@gmail.com",
        buyerDomain: "gmail.com",
        source: "instagram",
        medium: "social",
        campaign: null,
      },
    ],
    events: [{ name: "pageview", label: "Pagina vista", count: 90 }],
  };
}

function respondWith(body: unknown, status = 200) {
  fetchMock.mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body });
}

describe("métricas do Sobremesas Fit", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("SOBREMESAS_FIT_METRICS_KEY", "chave-de-teste");
    vi.stubEnv("SOBREMESAS_FIT_METRICS_URL", "https://petrakis.com.br");
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("avisa que falta configuração em vez de chamar a API sem credencial", async () => {
    vi.stubEnv("SOBREMESAS_FIT_METRICS_KEY", "");

    const result = await getSobremesasFitDashboard();

    expect(result.status).toBe("unconfigured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("envia a chave no cabeçalho e nunca na URL", async () => {
    respondWith(summaryPayload());

    await getSobremesasFitDashboard("7d");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url.toString()).toBe("https://petrakis.com.br/api/metrics/summary?period=7d");
    expect(url.toString()).not.toContain("chave-de-teste");
    expect(init.headers.Authorization).toBe("Bearer chave-de-teste");
  });

  it("converte o dinheiro de reais para centavos", async () => {
    respondWith(summaryPayload());

    const result = await getSobremesasFitDashboard();

    expect(result.status).toBe("ok");
    expect(result.data?.totals.revenueCents).toBe(5970);
    expect(result.data?.totals.averageOrderValueCents).toBe(1990);
    expect(result.data?.daily[0]?.revenueCents).toBe(1990);
    expect(result.data?.orders[0]?.amountCents).toBe(1990);
  });

  it("trata 503 como falta de configuração, não como queda", async () => {
    respondWith({ error: "API de metricas fechada." }, 503);

    const result = await getSobremesasFitDashboard();

    expect(result.status).toBe("unconfigured");
  });

  it("recusa uma resposta fora do contrato em vez de exibir número errado", async () => {
    respondWith({ ...summaryPayload(), totals: { sessions: "muitas" } });

    const result = await getSobremesasFitDashboard();

    expect(result.status).toBe("error");
    expect(result.data).toBeNull();
  });

  it("não deixa uma falha de rede derrubar a página", async () => {
    fetchMock.mockRejectedValue(new Error("sem rede"));

    const result = await getSobremesasFitDashboard();

    expect(result.status).toBe("error");
  });

  it("agrupa a série diária por mês, somando receita e vendas", async () => {
    respondWith({
      range: { from: "2026-07-01", to: "2026-08-19" },
      interval: "day",
      points: [
        point("2026-07-05", { revenue: 19.9, purchases: 1 }),
        point("2026-07-20", { revenue: 39.8, purchases: 2 }),
        point("2026-08-02", { revenue: 19.9, purchases: 1 }),
      ],
    });

    const result = await getSobremesasFitMonthlyRevenue(2);

    expect(result.status).toBe("ok");
    expect(result.data).toEqual([
      expect.objectContaining({ monthStart: "2026-07-01", revenueCents: 5970, paidOrdersCount: 3 }),
      expect.objectContaining({ monthStart: "2026-08-01", revenueCents: 1990, paidOrdersCount: 1 }),
    ]);
  });

  it("pede a janela desde o primeiro dia do mês mais antigo", () => {
    expect(monthWindow(6, new Date("2026-08-19T15:00:00Z"))).toEqual({
      from: "2026-03-01",
      to: "2026-08-19",
    });
  });

  it("usa o dia de São Paulo, não o de UTC, ao fechar a janela", () => {
    // 01:30 UTC do dia 1º ainda é 22:30 do dia 31 em São Paulo.
    expect(monthWindow(1, new Date("2026-09-01T01:30:00Z"))).toEqual({
      from: "2026-08-01",
      to: "2026-08-31",
    });
  });
});

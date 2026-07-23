import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  createServerSupabaseClient: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  select: vi.fn(),
  single: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}));

import {
  getOrderAnalyticsMetrics,
  getOrderDailySeries,
  getPaidOrderSummary,
  getPaidPixMetrics,
  listOrders,
} from "./admin-repository";

describe("métricas administrativas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createServerSupabaseClient.mockResolvedValue({ from: mocks.from, rpc: mocks.rpc });
    mocks.from.mockReturnValue({ select: mocks.select });
    mocks.select.mockReturnValue({ single: mocks.single });
  });

  it("carrega a soma de pedidos pagos no período", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ paid_orders_count: 2, total_received_cents: 5_500 }],
      error: null,
    });

    await expect(getPaidOrderSummary({
      from: "2026-07-01T03:00:00.000Z",
      to: "2026-08-01T03:00:00.000Z",
    })).resolves.toEqual({ paidOrdersCount: 2, totalReceivedCents: 5_500 });
    expect(mocks.rpc).toHaveBeenCalledWith("get_paid_order_summary", {
      p_created_from: "2026-07-01T03:00:00.000Z",
      p_created_to: "2026-08-01T03:00:00.000Z",
    });
  });

  it("carrega e normaliza o resumo de pagamentos Pix confirmados", async () => {
    mocks.single.mockResolvedValue({
      data: {
        paid_orders_count: 3,
        gross_revenue_cents: 12_345,
        gross_revenue_today_cents: 2_500,
        gross_revenue_last_7_days_cents: 6_000,
        gross_revenue_last_30_days_cents: 8_000,
        average_order_cents: 4_115,
        last_paid_at: "2026-07-16T12:30:00.000Z",
      },
      error: null,
    });

    await expect(getPaidPixMetrics()).resolves.toEqual({
      paidOrdersCount: 3,
      grossRevenueCents: 12_345,
      grossRevenueTodayCents: 2_500,
      grossRevenueLast7DaysCents: 6_000,
      grossRevenueLast30DaysCents: 8_000,
      averageOrderCents: 4_115,
      lastPaidAt: "2026-07-16T12:30:00.000Z",
    });
    expect(mocks.requireAdmin).toHaveBeenCalledOnce();
  });

  it("não converte valores inválidos em receita", async () => {
    mocks.single.mockResolvedValue({
      data: {
        paid_orders_count: "inválido",
        gross_revenue_cents: Number.MAX_SAFE_INTEGER + 1,
        gross_revenue_today_cents: null,
        gross_revenue_last_7_days_cents: 0,
        gross_revenue_last_30_days_cents: 0,
        average_order_cents: 0,
        last_paid_at: null,
      },
      error: null,
    });

    const metrics = await getPaidPixMetrics();
    expect(metrics.paidOrdersCount).toBe(0);
    expect(metrics.grossRevenueCents).toBe(0);
  });

  it("carrega os seis indicadores operacionais", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{
        orders_today_count: 4,
        revenue_today_cents: 2_000,
        orders_last_7_days_count: 15,
        revenue_last_7_days_cents: 8_000,
        orders_last_30_days_count: 60,
        revenue_last_30_days_cents: 32_000,
      }],
      error: null,
    });

    await expect(getOrderAnalyticsMetrics()).resolves.toEqual({
      ordersTodayCount: 4,
      revenueTodayCents: 2_000,
      ordersLast7DaysCount: 15,
      revenueLast7DaysCents: 8_000,
      ordersLast30DaysCount: 60,
      revenueLast30DaysCents: 32_000,
    });
  });

  it("normaliza a série diária", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ metric_date: "2026-07-22", orders_count: 3, paid_orders_count: 2, revenue_cents: 1_500 }],
      error: null,
    });

    await expect(getOrderDailySeries()).resolves.toEqual([
      { date: "2026-07-22", ordersCount: 3, paidOrdersCount: 2, revenueCents: 1_500 },
    ]);
  });
});

describe("listOrders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createServerSupabaseClient.mockResolvedValue({ from: mocks.from, rpc: mocks.rpc });
  });

  it("pagina no servidor e aplica o agrupamento de pedidos pagos", async () => {
    const orderQuery = {
      select: vi.fn(), gte: vi.fn(), lt: vi.fn(), eq: vi.fn(), in: vi.fn(),
      is: vi.fn(), order: vi.fn(), range: vi.fn(),
    };
    orderQuery.select.mockReturnValue(orderQuery);
    orderQuery.gte.mockReturnValue(orderQuery);
    orderQuery.lt.mockReturnValue(orderQuery);
    orderQuery.eq.mockReturnValue(orderQuery);
    orderQuery.in.mockReturnValue(orderQuery);
    orderQuery.is.mockReturnValue(orderQuery);
    orderQuery.order.mockReturnValue(orderQuery);
    orderQuery.range.mockResolvedValue({
      data: [{
        id: "71000000-0000-4000-8000-000000000001",
        product_id: "71000000-0000-4000-8000-000000000003",
        created_at: "2026-07-22T12:00:00.000Z",
      }],
      count: 51,
      error: null,
    });

    const itemQuery = { select: vi.fn(), in: vi.fn(), order: vi.fn() };
    itemQuery.select.mockReturnValue(itemQuery);
    itemQuery.in.mockReturnValue(itemQuery);
    itemQuery.order.mockResolvedValue({ data: [], error: null });
    mocks.from.mockImplementation((table: string) => table === "orders" ? orderQuery : itemQuery);

    const result = await listOrders({
      period: { from: "2026-07-01T03:00:00.000Z", to: "2026-08-01T03:00:00.000Z" },
      status: "paid",
      page: 2,
      pageSize: 50,
    });

    expect(orderQuery.eq).toHaveBeenCalledWith("payment_status", "paid");
    expect(orderQuery.in).toHaveBeenCalledWith("status", ["paid", "processing", "delivered"]);
    expect(orderQuery.is).toHaveBeenCalledWith("stock_released_at", null);
    expect(orderQuery.range).toHaveBeenCalledWith(50, 99);
    expect(result).toMatchObject({ total: 51, page: 2, pageSize: 50, totalPages: 2 });
    expect(result.rows).toHaveLength(1);
  });

  it("agrupa cancelados e expirados", async () => {
    const query = { select: vi.fn(), in: vi.fn(), order: vi.fn(), range: vi.fn() };
    query.select.mockReturnValue(query);
    query.in.mockReturnValue(query);
    query.order.mockReturnValue(query);
    query.range.mockResolvedValue({ data: [], count: 0, error: null });
    mocks.from.mockReturnValue(query);

    await listOrders({ period: { from: null, to: null }, status: "cancelled", page: 1, pageSize: 50 });
    expect(query.in).toHaveBeenCalledWith("status", ["cancelled", "expired"]);
  });
});

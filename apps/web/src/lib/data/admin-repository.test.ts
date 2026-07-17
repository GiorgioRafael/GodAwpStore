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

import { getPaidOrderSummary, getPaidPixMetrics } from "./admin-repository";

describe("getPaidPixMetrics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createServerSupabaseClient.mockResolvedValue({ from: mocks.from, rpc: mocks.rpc });
    mocks.from.mockReturnValue({ select: mocks.select });
    mocks.select.mockReturnValue({ single: mocks.single });
  });

  it("carrega a soma de pedidos cujo status é paid no período", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ paid_orders_count: 2, total_received_cents: 5_500 }],
      error: null,
    });

    await expect(
      getPaidOrderSummary({
        from: "2026-07-01T03:00:00.000Z",
        to: "2026-08-01T03:00:00.000Z",
      }),
    ).resolves.toEqual({
      paidOrdersCount: 2,
      totalReceivedCents: 5_500,
    });
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
    expect(mocks.from).toHaveBeenCalledWith("admin_paid_pix_metrics");
    expect(mocks.select).toHaveBeenCalledWith("*");
    expect(mocks.single).toHaveBeenCalledOnce();
  });

  it("não converte um valor inválido em receita", async () => {
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
    expect(metrics.grossRevenueTodayCents).toBe(0);
  });
});

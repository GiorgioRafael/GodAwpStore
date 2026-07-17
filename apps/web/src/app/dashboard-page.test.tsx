import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const repository = vi.hoisted(() => ({
  getDashboardSummary: vi.fn(),
  getPaidPixMetrics: vi.fn(),
  listAuditEvents: vi.fn(),
  listProductStock: vi.fn(),
}));

vi.mock("@/lib/data/admin-repository", () => repository);

import DashboardPage from "@/app/(admin)/page";

describe("painel de métricas", () => {
  it("mostra receita e períodos somente a partir das métricas de Pix confirmados", async () => {
    repository.getDashboardSummary.mockResolvedValue({
      gamesCount: 1,
      substoresCount: 2,
      productsCount: 5,
      availableUnitsCount: 30,
      lowStockProductsCount: 0,
      guildsCount: 1,
      ordersCount: 9,
      deliveredOrdersCount: 2,
      ledgerBalanceCents: 7_000,
      pendingPayoutsCents: 0,
    });
    repository.getPaidPixMetrics.mockResolvedValue({
      paidOrdersCount: 3,
      grossRevenueCents: 12_345,
      grossRevenueTodayCents: 2_500,
      grossRevenueLast7DaysCents: 6_000,
      grossRevenueLast30DaysCents: 8_000,
      averageOrderCents: 4_115,
      lastPaidAt: "2026-07-16T12:30:00.000Z",
    });
    repository.listProductStock.mockResolvedValue([]);
    repository.listAuditEvents.mockResolvedValue([]);

    render(await DashboardPage());

    expect(screen.getByRole("heading", { name: "Vendas confirmadas" })).toBeInTheDocument();
    expect(screen.getByText(/R\$\s*123,45/)).toBeInTheDocument();
    expect(screen.getByText(/R\$\s*41,15/)).toBeInTheDocument();
    expect(screen.getByText("Somente pagamentos LivePix confirmados")).toBeInTheDocument();
    expect(screen.getByText("Pedidos únicos, sem pendentes ou reembolsos")).toBeInTheDocument();
    expect(screen.getByText("Hoje")).toBeInTheDocument();
    expect(screen.getByText("Últimos 7 dias")).toBeInTheDocument();
    expect(screen.getAllByText(/R\$\s*80,00/)).toHaveLength(2);
    expect(screen.getByText(/Último Pix:/)).toBeInTheDocument();
  });

  it("mostra estado zerado sem inventar vendas", async () => {
    repository.getDashboardSummary.mockResolvedValue({
      gamesCount: 0,
      substoresCount: 0,
      productsCount: 0,
      availableUnitsCount: 0,
      lowStockProductsCount: 0,
      guildsCount: 0,
      ordersCount: 0,
      deliveredOrdersCount: 0,
      ledgerBalanceCents: 0,
      pendingPayoutsCents: 0,
    });
    repository.getPaidPixMetrics.mockResolvedValue({
      paidOrdersCount: 0,
      grossRevenueCents: 0,
      grossRevenueTodayCents: 0,
      grossRevenueLast7DaysCents: 0,
      grossRevenueLast30DaysCents: 0,
      averageOrderCents: 0,
      lastPaidAt: null,
    });
    repository.listProductStock.mockResolvedValue([]);
    repository.listAuditEvents.mockResolvedValue([]);

    render(await DashboardPage());

    expect(screen.getByText("Nenhum Pix pago")).toBeInTheDocument();
    expect(screen.getAllByText(/R\$\s*0,00/).length).toBeGreaterThanOrEqual(4);
  });
});

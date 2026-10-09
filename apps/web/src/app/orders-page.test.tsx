import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const repository = vi.hoisted(() => ({
  getOrderAnalyticsMetrics: vi.fn(),
  getOrderDailySeries: vi.fn(),
  listOrders: vi.fn(),
}));
const routing = vi.hoisted(() => ({ isGwStore: true, redirect: vi.fn() }));
vi.mock("@/lib/brand", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/brand")>(),
  get IS_GWSTORE() { return routing.isGwStore; },
}));
vi.mock("next/navigation", () => ({ redirect: routing.redirect }));

vi.mock("@/lib/data/admin-repository", () => repository);
vi.mock("@/components/admin/orders-chart-loader", () => ({
  OrdersChartLoader: () => <div data-testid="orders-chart" />,
}));

import OrdersPage from "@/app/(admin)/pedidos/page";

const baseOrder = {
  id: "71000000-0000-4000-8000-000000000001",
  guild_id: "71000000-0000-4000-8000-000000000002",
  product_id: "71000000-0000-4000-8000-000000000003",
  buyer_discord_id: "911402638975844354",
  quantity: 2,
  items: [{
    productId: "71000000-0000-4000-8000-000000000003",
    productName: "Super Watering",
    quantity: 2,
  }],
  status: "paid" as const,
  sale_price_cents: 2_000,
  payment_status: "paid" as const,
  stock_released_at: null,
  stock_release_reason: null,
  late_payment_detected_at: null,
  paid_at: "2026-07-17T12:05:00.000Z",
  created_at: "2026-07-17T12:00:00.000Z",
  updated_at: "2026-07-17T12:05:00.000Z",
};

describe("aba Pedidos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routing.isGwStore = true;
    routing.redirect.mockImplementation(() => { throw new Error("redirect"); });
    repository.getOrderAnalyticsMetrics.mockResolvedValue({
      ordersTodayCount: 3,
      revenueTodayCents: 2_000,
      ordersLast7DaysCount: 9,
      revenueLast7DaysCents: 7_500,
      ordersLast30DaysCount: 25,
      revenueLast30DaysCents: 20_000,
    });
    repository.getOrderDailySeries.mockResolvedValue([]);
  });

  it("mostra indicadores, filtros rápidos e status traduzidos", async () => {
    repository.listOrders.mockResolvedValue({
      rows: [
        baseOrder,
        {
          ...baseOrder,
          id: "71000000-0000-4000-8000-000000000004",
          status: "awaiting_payment",
          payment_status: "pending",
          paid_at: null,
          sale_price_cents: 9_900,
        },
        {
          ...baseOrder,
          id: "71000000-0000-4000-8000-000000000005",
          status: "cancelled",
          stock_released_at: "2026-07-17T14:00:00.000Z",
          stock_release_reason: "payment_timeout",
          late_payment_detected_at: "2026-07-17T14:05:00.000Z",
        },
      ],
      total: 53,
      page: 1,
      pageSize: 50,
      totalPages: 2,
    });

    render(await OrdersPage({ searchParams: Promise.resolve({ period: "today" }) }));

    expect(screen.getByText("Pedidos hoje")).toBeInTheDocument();
    expect(screen.getByText("Receita hoje")).toBeInTheDocument();
    expect(screen.getAllByText("R$ 20,00")).not.toHaveLength(0);
    expect(screen.getByTestId("orders-chart")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Pedidos hoje: 3/ })).toHaveAttribute(
      "href",
      "/admin/pedidos?period=today",
    );
    expect(screen.getByRole("link", { name: "Pagos" })).toHaveAttribute(
      "href",
      "/admin/pedidos?period=today&status=paid",
    );
    expect(repository.listOrders).toHaveBeenCalledWith(expect.objectContaining({
      status: "all",
      page: 1,
      pageSize: 50,
      period: expect.objectContaining({ key: "today" }),
    }));

    const table = screen.getByRole("table");
    expect(within(table).getByText("Pago")).toHaveClass("text-[#94e5b2]");
    expect(within(table).getByText("Aguardando pagamento")).toHaveClass("text-[#f3c878]");
    expect(within(table).getByText("Cancelado")).toHaveClass("text-[#ffaaa7]");
    expect(within(table).getByText(/Pago após o prazo/)).toHaveClass("text-danger");
    expect(screen.getByText("Mostrando 1–50 de 53")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Próxima" })).toHaveAttribute(
      "href",
      "/admin/pedidos?period=today&page=2",
    );
  });

  it("aplica status e página recebidos pela URL", async () => {
    repository.listOrders.mockResolvedValue({
      rows: [baseOrder],
      total: 51,
      page: 2,
      pageSize: 50,
      totalPages: 2,
    });

    render(await OrdersPage({
      searchParams: Promise.resolve({ period: "7d", status: "paid", page: "2" }),
    }));

    expect(repository.listOrders).toHaveBeenCalledWith(expect.objectContaining({ status: "paid", page: 2 }));
    expect(screen.getByRole("link", { name: "Pagos" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Mostrando 51–51 de 51")).toBeInTheDocument();
  });

  it("mostra estado vazio sem perder os filtros", async () => {
    repository.listOrders.mockResolvedValue({
      rows: [], total: 0, page: 1, pageSize: 50, totalPages: 1,
    });

    render(await OrdersPage({ searchParams: Promise.resolve({ status: "cancelled" }) }));

    expect(screen.getByText("Nenhum pedido encontrado")).toBeInTheDocument();
    expect(screen.getByText("0 pedidos encontrados")).toBeInTheDocument();
  });

  it.each([[true, "/admin"], [false, ""]] as const)(
    "preserva datas, status e paginação nas URLs da loja (GW=%s)", async (isGwStore, prefix) => {
      routing.isGwStore = isGwStore;
      repository.listOrders.mockResolvedValue({ rows: [baseOrder], total: 101, page: 2, pageSize: 50, totalPages: 3 });
      render(await OrdersPage({ searchParams: Promise.resolve({ period: "custom", from: "2026-10-01",
        to: "2026-10-09", status: "paid", page: "2" }) }));
      const filteredPath = `${prefix}/pedidos?period=custom&from=2026-10-01&to=2026-10-09&status=paid`;
      expect(screen.getByRole("link", { name: "Anterior" })).toHaveAttribute("href", filteredPath);
      expect(screen.getByRole("link", { name: "Próxima" })).toHaveAttribute("href", `${filteredPath}&page=3`);
      expect(screen.getByRole("link", { name: "Pagos" })).toHaveAttribute("href", filteredPath);
      expect(screen.getByRole("link", { name: "Limpar tudo" })).toHaveAttribute("href", `${prefix}/pedidos`);
      const form = screen.getByRole("button", { name: "Aplicar datas" }).closest("form");
      expect(form).toHaveAttribute("method", "get");
      expect(form).not.toHaveAttribute("action");
      expect(form?.querySelector('input[name="status"]')).toHaveAttribute("value", "paid");
    },
  );

  it.each([[true, "/admin"], [false, ""]] as const)(
    "corrige página fora do limite mantendo filtros e o painel da loja (GW=%s)", async (isGwStore, prefix) => {
      routing.isGwStore = isGwStore;
      repository.listOrders.mockResolvedValue({ rows: [], total: 51, page: 99, pageSize: 50, totalPages: 2 });
      await expect(OrdersPage({ searchParams: Promise.resolve({ period: "7d", status: "paid", page: "99" }) }))
        .rejects.toThrow("redirect");
      expect(routing.redirect).toHaveBeenCalledWith(`${prefix}/pedidos?period=7d&status=paid&page=2`);
    },
  );
});

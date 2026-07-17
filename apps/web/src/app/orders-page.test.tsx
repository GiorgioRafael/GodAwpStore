import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const repository = vi.hoisted(() => ({
  getPaidOrderSummary: vi.fn(),
  listOrders: vi.fn(),
}));

vi.mock("@/lib/data/admin-repository", () => repository);

import OrdersPage from "@/app/(admin)/pedidos/page";

const baseOrder = {
  id: "71000000-0000-4000-8000-000000000001",
  guild_id: "71000000-0000-4000-8000-000000000002",
  seller_whitelist_entry_id: null,
  product_id: "71000000-0000-4000-8000-000000000003",
  inventory_unit_id: null,
  buyer_discord_id: "911402638975844354",
  quantity: 2,
  status: "paid" as const,
  currency_code: "BRL",
  sale_price_cents: 2_000,
  minimum_price_cents: 100,
  commission_bps: 0,
  payment_reference: "ORDER-1",
  payment_provider: "livepix",
  payment_provider_reference: "LIVEPIX-1",
  payment_provider_checkout_id: "CHECKOUT-1",
  payment_checkout_url: "https://example.com/checkout",
  livepix_checkout_claim_token: null,
  livepix_checkout_claimed_at: null,
  payment_provider_proof_id: "PROOF-1",
  payment_status: "paid" as const,
  payment_expires_at: null,
  payment_provider_created_at: "2026-07-17T12:00:00.000Z",
  discord_ticket_channel_id: null,
  discord_ticket_status: "not_started" as const,
  discord_ticket_claimed_at: null,
  paid_at: "2026-07-17T12:05:00.000Z",
  delivered_at: null,
  cancelled_at: null,
  created_at: "2026-07-17T12:00:00.000Z",
  updated_at: "2026-07-17T12:05:00.000Z",
};

describe("aba Pedidos", () => {
  it("mostra o total apenas de paid, filtra o período e pinta paid de verde", async () => {
    repository.getPaidOrderSummary.mockResolvedValue({
      paidOrdersCount: 1,
      totalReceivedCents: 2_000,
    });
    repository.listOrders.mockResolvedValue([
      baseOrder,
      {
        ...baseOrder,
        id: "71000000-0000-4000-8000-000000000004",
        status: "awaiting_payment",
        payment_status: "pending",
        paid_at: null,
        sale_price_cents: 9_900,
      },
    ]);

    render(
      await OrdersPage({
        searchParams: Promise.resolve({ period: "today" }),
      }),
    );

    expect(screen.getByText("R$ 20,00", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByText("1 pedidos com status paid")).toBeInTheDocument();
    expect(screen.getByText("Hoje", { selector: "strong" })).toBeInTheDocument();
    expect(repository.listOrders).toHaveBeenCalledWith(
      {
        from: expect.stringContaining("2026-"),
        to: expect.stringContaining("2026-"),
        key: "today",
        label: "Hoje",
        fromInput: expect.any(String),
        toInput: expect.any(String),
        error: null,
      },
      500,
    );

    const table = screen.getByRole("table");
    expect(within(table).getByText("paid")).toHaveClass("text-[#94e5b2]");
    expect(within(table).getByText("awaiting_payment")).toHaveClass("text-[#f3c878]");
  });

  it("mostra o estado vazio para um período sem pedidos", async () => {
    repository.getPaidOrderSummary.mockResolvedValue({
      paidOrdersCount: 0,
      totalReceivedCents: 0,
    });
    repository.listOrders.mockResolvedValue([]);

    render(await OrdersPage({ searchParams: Promise.resolve({ period: "all" }) }));

    expect(screen.getByText("Nenhum pedido no período")).toBeInTheDocument();
    expect(screen.getByText("R$ 0,00")).toBeInTheDocument();
  });
});

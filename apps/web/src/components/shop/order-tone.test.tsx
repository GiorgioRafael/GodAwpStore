import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ShopOrderStatus } from "@/lib/shop/types";
import { ORDER_TONE_ICON, shopOrderStatusLabel, shopOrderStatusTone, type ShopOrderTone } from "./order-workspace";
import { ShopOrdersList } from "./orders-list";

const BASE: ShopOrderStatus = {
  orderId: "10000000-0000-4000-8000-000000000001", status: "awaiting_payment", paymentStatus: "pending", totalPriceCents: 5_500,
  checkoutUrl: null, ticketUrl: null, chatUrl: null, gameNickname: "Buyer_123", createdAt: "2026-10-09T11:55:00.000Z",
  paidAt: null, deliveredAt: null, paymentExpiresAt: null, pixCode: null, buyerName: "Ana",
  items: [{ productName: "MAGNETIC FISICA - BLOX FRUITS", quantity: 2, unitPriceCents: 2_750, totalPriceCents: 5_500 }],
};
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
afterEach(() => { vi.unstubAllGlobals(); });

const CASES: [Partial<ShopOrderStatus>, string, ShopOrderTone][] = [
  [{}, "Aguardando pagamento", "pending"],
  [{ status: "paid", paymentStatus: "paid" }, "Em atendimento", "active"],
  [{ status: "delivered", paymentStatus: "paid", deliveredAt: "2026-10-09T12:10:00.000Z" }, "Entregue", "done"],
  [{ status: "refunded", paymentStatus: "refunded" }, "Reembolsado", "refunded"],
  [{ status: "cancelled", paymentStatus: "paid" }, "Análise necessária", "review"],
  [{ status: "cancelled" }, "Cancelado", "halted"],
  [{ status: "expired", paymentStatus: "expired" }, "Pagamento expirado", "halted"],
];

describe("tons de status das compras", () => {
  it.each(CASES)("%o vira %s com o tom %s", (patch, label, tone) => {
    const order = { ...BASE, ...patch };
    expect(shopOrderStatusLabel(order)).toBe(label);
    expect(shopOrderStatusTone(order)).toBe(tone);
    expect(ORDER_TONE_ICON[tone]).toBeDefined();
  });

  it("lista cada compra com o tom, o status uma única vez, o nome limpo e a próxima ação", async () => {
    const orders = CASES.slice(0, 3).map(([patch], i) => ({ ...BASE, ...patch, orderId: `10000000-0000-4000-8000-00000000000${i}` }));
    vi.stubGlobal("fetch", vi.fn(async () => json({ ok: true, orders })));
    render(<ShopOrdersList />);
    const pending = (await screen.findByText("Aguardando pagamento")).closest("a")!;
    expect(pending).toHaveAttribute("href", `/minhas-compras/${orders[0].orderId}`);
    expect(pending).toHaveAttribute("data-tone", "pending");
    expect(within(pending).getByRole("heading", { level: 2 })).toHaveTextContent("2× Magnetic Física");
    expect(within(pending).getByText("Pagar")).toBeInTheDocument();
    expect(within(pending).getByText("R$ 55,00")).toBeInTheDocument();
    expect(screen.getByText("Em atendimento").closest("a")).toHaveAttribute("data-tone", "active");
    expect(within(screen.getByText("Entregue").closest("a")!).getByText("Ver conversa")).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(3);
  });

  it("mostra o convite para a loja quando ainda não há compras", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ ok: true, orders: [] })));
    render(<ShopOrdersList />);
    expect(await screen.findByRole("heading", { name: "Sua primeira compra começa na loja" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Explorar produtos" })).toHaveAttribute("href", "/#catalogo");
  });
});

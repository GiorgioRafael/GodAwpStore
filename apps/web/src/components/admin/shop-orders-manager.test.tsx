import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ShopOrderSummary } from "@/lib/shop/types";
import { ShopOrdersManager } from "./shop-orders-manager";

const request = vi.fn();
const BASE: ShopOrderSummary = {
  orderId: "10000000-0000-4000-8000-000000000001", status: "paid", paymentStatus: "paid",
  totalPriceCents: 5_500, checkoutUrl: null, ticketUrl: null, chatUrl: "/minhas-compras/10000000-0000-4000-8000-000000000001",
  gameNickname: "PlayerOne", createdAt: "2026-10-09T12:00:00Z", paidAt: "2026-10-09T12:01:00Z",
  deliveredAt: null, paymentExpiresAt: null, pixCode: null, buyerName: "Ana",
  items: [{ productName: "Dragon", quantity: 1, unitPriceCents: 5_500, totalPriceCents: 5_500 }],
};
function reply(orders: ShopOrderSummary[]) {
  return { ok: true, json: async () => ({ ok: true, orders }) };
}

beforeEach(() => {
  vi.stubGlobal("fetch", request);
  request.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("atendimento dos pedidos feitos no site", () => {
  it("prioriza pedidos pagos, distingue filtros e abre o atendimento administrativo", async () => {
    request.mockResolvedValue(reply([
      BASE,
      { ...BASE, orderId: "20000000-0000-4000-8000-000000000002", buyerName: "Bruno", paymentStatus: "pending", status: "awaiting_payment" },
      { ...BASE, orderId: "30000000-0000-4000-8000-000000000003", buyerName: "Carla", status: "completed", deliveredAt: "2026-10-09T13:00:00Z" },
      { ...BASE, orderId: "40000000-0000-4000-8000-000000000004", buyerName: "Davi", status: "cancelled" },
    ]));
    render(<ShopOrdersManager />);
    expect(await screen.findByText("Ana")).toBeInTheDocument();
    expect(screen.queryByText("Bruno")).not.toBeInTheDocument();
    expect(screen.queryByText("Carla")).not.toBeInTheDocument();
    expect(screen.getByText("Davi")).toBeInTheDocument();
    expect(screen.getByText("Análise necessária")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Abrir pedido" })[0]).toHaveAttribute("href", `/admin/atendimento-loja/${BASE.orderId}`);
    expect(request).toHaveBeenCalledWith("/api/loja/admin/pedidos", expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }));

    fireEvent.click(screen.getByRole("button", { name: "Pagamento pendente" }));
    expect(screen.getByText("Bruno")).toBeInTheDocument();
    expect(screen.queryByText("Ana")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Concluídos" }));
    expect(screen.getByText("Carla")).toBeInTheDocument();
    expect(screen.getByText("Entregue")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Todos" }));
    expect(screen.getAllByRole("link", { name: "Abrir pedido" })).toHaveLength(4);
  });

  it("mostra falha de leitura e permite tentar novamente", async () => {
    request.mockRejectedValueOnce(new Error("offline"));
    request.mockResolvedValueOnce(reply([BASE]));
    render(<ShopOrdersManager />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível carregar os pedidos");
    fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));
    expect(await screen.findByText("Ana")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("não sobrepõe pedidos de atualização e cancela a leitura ao sair", async () => {
    request.mockImplementation(() => new Promise(() => {}));
    const { unmount } = render(<ShopOrdersManager />);
    await waitFor(() => expect(request).toHaveBeenCalledOnce());
    expect(screen.getByRole("button", { name: "Atualizando..." })).toBeDisabled();
    const signal = request.mock.calls[0][1].signal as AbortSignal;
    unmount();
    expect(signal.aborted).toBe(true);
  });
});

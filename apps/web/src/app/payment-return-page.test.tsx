import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn(), createAdminSupabaseClient: vi.fn(), isGwStore: true }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabaseClient: mocks.createAdminSupabaseClient }));
vi.mock("@/lib/brand", () => ({ get IS_GWSTORE() { return mocks.isGwStore; }, STORE_NAME: "GWStore" }));
import PaymentReturnPage from "./pagamento/[orderId]/page";

const id = "550e8400-e29b-41d4-a716-446655440000";
const paid = {
  status: "paid", payment_status: "paid", discord_ticket_status: "open",
  discord_ticket_delivery_completed_at: null,
};
function setup(orders: unknown, robux: unknown, itemError: unknown = null) {
  mocks.from.mockImplementation((table: string) => ({
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: table === "orders" ? orders : robux,
      error: table === "orders" ? itemError : null,
    }),
  }));
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.isGwStore = true;
  mocks.createAdminSupabaseClient.mockReturnValue({ from: mocks.from });
});
afterEach(cleanup);

describe("retorno de pedidos de itens e Robux", () => {
  it.each([
    [paid, "Pagamento confirmado"],
    [{ ...paid, status: "awaiting_payment", payment_status: "pending", discord_ticket_status: "not_created" }, "Aguardando confirmação"],
    [{ ...paid, payment_status: "refunded" }, "Pagamento reembolsado"],
    [{ ...paid, payment_status: "failed" }, "Não foi possível confirmar"],
    [{ ...paid, payment_status: "expired" }, "Pedido cancelado"],
    [{ ...paid, discord_ticket_delivery_completed_at: "2026-10-01T12:00:00Z" }, "Pedido entregue"],
  ])("consulta Robux quando o pedido não está na tabela de itens", async (robux, title) => {
    setup(null, robux);
    render(await PaymentReturnPage({ params: Promise.resolve({ orderId: id }) }));
    expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    expect(mocks.from.mock.calls.map(([table]) => table)).toEqual(["orders", "robux_orders"]);
  });
  it("preserva o retorno de um pedido de itens sem consultar Robux", async () => {
    setup({ ...paid, late_payment_detected_at: null, stock_commit_failure_reason: null }, null);
    render(await PaymentReturnPage({ params: Promise.resolve({ orderId: id }) }));
    expect(screen.getByRole("heading", { name: "Pagamento confirmado" })).toBeInTheDocument();
    expect(mocks.from).toHaveBeenCalledExactlyOnceWith("orders");
  });
  it.each(["awaiting_payment", "paid", "cancelled", "delivered"])("retorna checkout web antigo ao pedido autenticado (%s)", async status => {
    setup({ ...paid, status, payment_reference: `web:${id}` }, null);
    await expect(PaymentReturnPage({ params: Promise.resolve({ orderId: id }) })).rejects.toMatchObject({
      digest: `NEXT_REDIRECT;replace;/minhas-compras/${id};307;`,
    });
    expect(mocks.from).toHaveBeenCalledExactlyOnceWith("orders");
  });
  it("preserva a página de retorno da THStore", async () => {
    mocks.isGwStore = false;
    setup({ ...paid, payment_reference: `web:${id}`, late_payment_detected_at: null, stock_commit_failure_reason: null }, null);
    render(await PaymentReturnPage({ params: Promise.resolve({ orderId: id }) }));
    expect(screen.getByRole("heading", { name: "Pagamento confirmado" })).toBeInTheDocument();
    expect(screen.getByText(/ticket privado já foi criado no Discord/)).toBeInTheDocument();
  });
  it("não mascara erro de leitura como ausência de pedido", async () => {
    setup(null, paid, { message: "unavailable" });
    render(await PaymentReturnPage({ params: Promise.resolve({ orderId: id }) }));
    expect(screen.getByRole("heading", { name: "Status indisponível" })).toBeInTheDocument();
    expect(mocks.from).toHaveBeenCalledExactlyOnceWith("orders");
  });
  it("não consulta o banco para um identificador inválido", async () => {
    render(await PaymentReturnPage({ params: Promise.resolve({ orderId: "invalid" }) }));
    expect(screen.getByRole("heading", { name: "Status indisponível" })).toBeInTheDocument();
    expect(mocks.from).not.toHaveBeenCalled();
  });
});

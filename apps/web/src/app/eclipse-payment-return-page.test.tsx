import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn(), after: vi.fn(), gw: true }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/brand", () => ({ get IS_GWSTORE() { return mocks.gw; } }));
vi.mock("@/lib/roulette/availability", () => ({ ROULETTE_AVAILABLE: false }));
vi.mock("@/lib/eclipsepay/runtime", () => ({ eclipseDatabase: () => ({ from: mocks.from }) }));
vi.mock("@/lib/eclipsepay/reconciliation", () => ({ reconcileEclipsePayments: vi.fn() }));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("./pagamento/pix/[token]/controls", () => ({ PixControls: () => null }));
import EclipseCheckoutPage from "./pagamento/pix/[token]/page";

const token = "a".repeat(64);
const orderId = "550e8400-e29b-41d4-a716-446655440000";
const checkout = { order_id: orderId, order_kind: "items", amount_cents: 2000,
  operation_status: "completed", processed_at: "2026-10-09T12:00:00Z", br_code: null, expires_at: null };
function setup(kind: string, paymentReference: string | null, orderError: unknown = null) {
  mocks.from.mockImplementation((table: string) => ({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: table === "eclipsepay_checkouts" ? { ...checkout, order_kind: kind }
      : { payment_reference: paymentReference }, error: table === "orders" ? orderError : null }) }));
}
beforeEach(() => { vi.clearAllMocks(); mocks.gw = true; });
afterEach(cleanup);

describe("retorno Pix EclipsePay e origem persistida", () => {
  it("abre a compra web autenticada sem expor código Pix no link público", async () => {
    setup("items", `web:${orderId}`);
    await expect(EclipseCheckoutPage({ params: Promise.resolve({ token }) })).rejects.toMatchObject({
      digest: `NEXT_REDIRECT;replace;/minhas-compras/${orderId};307;`,
    });
    expect(mocks.from.mock.calls.map(([table]) => table)).toEqual(["eclipsepay_checkouts", "orders"]);
    expect(mocks.after).not.toHaveBeenCalled();
  });
  it.each(["items", "robux"])("mantém o retorno Discord para %s do bot", async kind => {
    setup(kind, "discord:123456789012345678");
    render(await EclipseCheckoutPage({ params: Promise.resolve({ token }) }));
    expect(screen.getByRole("heading", { name: "Pagamento confirmado" })).toBeInTheDocument();
    expect(screen.getByText(/Volte ao Discord/)).toBeInTheDocument();
  });
  it("falha sem sugerir outro destino quando a origem de item não pode ser lida", async () => {
    setup("items", null, { message: "unavailable" });
    await expect(EclipseCheckoutPage({ params: Promise.resolve({ token }) })).rejects.toThrow("Pedido temporariamente indisponível");
  });
  it("preserva confirmação de moeda antiga sem oferecer roleta desativada", async () => {
    setup("coins", null);
    render(await EclipseCheckoutPage({ params: Promise.resolve({ token }) }));
    expect(screen.getByText(/Seu pagamento anterior foi confirmado/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /roleta/i })).not.toBeInTheDocument();
    expect(mocks.from).toHaveBeenCalledExactlyOnceWith("eclipsepay_checkouts");
  });
  it("continua indisponível na THStore", async () => {
    mocks.gw = false;
    await expect(EclipseCheckoutPage({ params: Promise.resolve({ token }) })).rejects.toThrow();
    expect(mocks.from).not.toHaveBeenCalled();
  });
});

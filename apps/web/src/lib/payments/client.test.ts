import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  brand: { IS_GWSTORE: true }, enabled: true, db: { rpc: vi.fn(), from: vi.fn() },
  legacy: { createPayment: vi.fn(), getPaymentByReference: vi.fn(), findPaymentByReference: vi.fn() },
  eclipse: { createCharge: vi.fn(), getCharge: vi.fn() },
}));
vi.mock("@/lib/brand", () => mocks.brand);
vi.mock("@/lib/livepix/client", () => ({ getLivePixClient: () => mocks.legacy }));
vi.mock("@/lib/eclipsepay/runtime", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/eclipsepay/runtime")>();
  return { ...original, eclipseDatabase: () => mocks.db, eclipsePayEnabled: () => mocks.enabled && mocks.brand.IS_GWSTORE, getEclipsePayClient: () => mocks.eclipse };
});
import { getPaymentClient } from "./client";
const id = "550e8400-e29b-41d4-a716-446655440000";
const operation = "550e8400-e29b-41d4-a716-446655440001";
const token = "a".repeat(64);
const input = { amountCents: 4000, redirectUrl: `https://gwstore.vercel.app/pagamento/${id}` };
beforeEach(() => {
  vi.clearAllMocks(); mocks.brand.IS_GWSTORE = true; mocks.enabled = true;
  vi.stubEnv("ECLIPSEPAY_WEBHOOK_SECRET", "test-only");
  mocks.db.rpc.mockImplementation((name) => name === "prepare_eclipsepay_checkout"
    ? { single: async () => ({ data: { order_id: id, order_kind: "robux", amount_cents: 4000, checkout_token: token, operation_id: null }, error: null }) }
    : Promise.resolve({ error: null }));
  mocks.eclipse.createCharge.mockResolvedValue({ id: operation, status: "pending", amountCents: 4000, brCode: "code", expiresAt: null });
});
describe("isolated payment provider routing", () => {
  it("mantém THStore no LivePix mesmo se a flag for copiada por engano", async () => {
    mocks.brand.IS_GWSTORE = false;
    await getPaymentClient().createPayment(input);
    expect(mocks.legacy.createPayment).toHaveBeenCalledWith(input);
    expect(mocks.eclipse.createCharge).not.toHaveBeenCalled();
  });
  it("mantém pedidos LivePix antigos no cliente antigo após a troca", async () => {
    await getPaymentClient().getPaymentByReference("old-livepix-reference");
    expect(mocks.legacy.getPaymentByReference).toHaveBeenCalledWith("old-livepix-reference");
    expect(mocks.eclipse.getCharge).not.toHaveBeenCalled();
  });
  it("persiste intenção antes da API e associa operação antes de retornar checkout privado", async () => {
    const result = await getPaymentClient().createPayment(input);
    expect(mocks.db.rpc.mock.calls[0][0]).toBe("prepare_eclipsepay_checkout");
    expect(mocks.eclipse.createCharge).toHaveBeenCalledWith(id, { amountCents: 4000, description: `GWStore ${id}` });
    expect(mocks.db.rpc.mock.calls[1][0]).toBe("register_eclipsepay_operation");
    expect(result).toEqual({ reference: `ep:${operation}`, checkoutUrl: `https://gwstore.vercel.app/pagamento/pix/${token}` });
  });
  it("usa a mesma intenção em tentativas repetidas e não cai no LivePix depois de timeout", async () => {
    mocks.eclipse.createCharge.mockRejectedValueOnce(new Error("timeout"));
    await expect(getPaymentClient().createPayment(input)).rejects.toThrow("timeout");
    await getPaymentClient().createPayment(input);
    expect(mocks.eclipse.createCharge.mock.calls[0]).toEqual(mocks.eclipse.createCharge.mock.calls[1]);
    expect(mocks.legacy.createPayment).not.toHaveBeenCalled();
  });
  it("não cria checkout acima do limite nem sem webhook secret", async () => {
    await expect(getPaymentClient().createPayment({ ...input, amountCents: 100001 })).rejects.toThrow("1.000");
    vi.stubEnv("ECLIPSEPAY_WEBHOOK_SECRET", "");
    await expect(getPaymentClient().createPayment(input)).rejects.toThrow("Webhook");
    expect(mocks.eclipse.createCharge).not.toHaveBeenCalled();
  });
  it("não entrega cobrança pendente ou estornada e confere valor bruto", async () => {
    const chain = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { amount_cents: 4000 }, error: null }) };
    mocks.db.from.mockReturnValue(chain);
    for (const status of ["pending", "failed", "refunded"]) {
      mocks.eclipse.getCharge.mockResolvedValue({ id: operation, status, amountCents: 4000 });
      await expect(getPaymentClient().findPaymentByReference(`ep:${operation}`)).resolves.toBeNull();
    }
    mocks.eclipse.getCharge.mockResolvedValue({ id: operation, status: "completed", amountCents: 3900 });
    await expect(getPaymentClient().findPaymentByReference(`ep:${operation}`)).rejects.toThrow("divergente");
  });
});

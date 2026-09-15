import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), charge: vi.fn(), fulfill: vi.fn(), writes: [] as Record<string, unknown>[] }));
vi.mock("@/lib/brand", () => ({ IS_GWSTORE: true }));
vi.mock("@/lib/payments/fulfillment", () => ({ fulfillVerifiedPayment: mocks.fulfill }));
vi.mock("./runtime", async (importOriginal) => ({
  ...await importOriginal<typeof import("./runtime")>(), eclipseDatabase: () => ({ rpc: mocks.rpc, from: mocks.from }), getEclipsePayClient: () => ({ getCharge: mocks.charge }),
}));
import { reconcileEclipsePayments } from "./reconciliation";
const id = "550e8400-e29b-41d4-a716-446655440000";
const operation = "550e8400-e29b-41d4-a716-446655440001";
beforeEach(() => {
  vi.clearAllMocks(); mocks.writes.length = 0;
  vi.stubEnv("ECLIPSEPAY_API_KEY", "test-key");
  mocks.rpc.mockReturnValueOnce({ maybeSingle: async () => ({ data: { order_id: id, order_kind: "robux", amount_cents: 4000, checkout_token: "a".repeat(64), operation_id: operation }, error: null }) })
    .mockReturnValue({ maybeSingle: async () => ({ data: null, error: null }) });
  mocks.from.mockImplementation(() => {
    const chain = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(),
      update: (values: Record<string, unknown>) => { mocks.writes.push(values); return chain; },
      then: (resolve: (value: unknown) => unknown) => resolve({ data: [{ event_id: id, amount_cents: 4000, resource_version: 2 }], error: null }),
    }; return chain;
  });
  mocks.charge.mockResolvedValue({ id: operation, status: "completed", amountCents: 4000, updatedAt: "2026-09-15T12:00:00Z", expiresAt: null });
  mocks.fulfill.mockResolvedValue(Response.json({ received: true, ticket: "open" }));
});
describe("durable EclipsePay reconciliation", () => {
  it("confirma na API e só depois entrega", async () => {
    expect(await reconcileEclipsePayments()).toEqual({ processed: 1, failed: 0 });
    expect(mocks.fulfill).toHaveBeenCalledWith({ providerPaymentId: operation, providerReference: `ep:${operation}` });
    expect(mocks.charge.mock.invocationCallOrder[0]).toBeLessThan(mocks.fulfill.mock.invocationCallOrder[0]);
  });
  it.each(["pending", "failed", "refunded"])("não entrega evento antigo pago quando estado atual é %s", async (status) => {
    mocks.charge.mockResolvedValue({ id: operation, status, amountCents: 4000, updatedAt: "2026-09-15T12:00:00Z", expiresAt: null });
    await reconcileEclipsePayments();
    expect(mocks.fulfill).not.toHaveBeenCalled();
    if (status === "refunded") expect(mocks.writes.some((write) => write.review_required === true)).toBe(true);
  });
  it("não entrega valor divergente e programa nova tentativa", async () => {
    mocks.charge.mockResolvedValue({ id: operation, status: "completed", amountCents: 3900 });
    expect(await reconcileEclipsePayments()).toEqual({ processed: 0, failed: 1 });
    expect(mocks.fulfill).not.toHaveBeenCalled();
    expect(mocks.writes.some((write) => write.next_check_at && write.lease_token === null)).toBe(true);
  });
  it("repete abertura do ticket após falha temporária", async () => {
    mocks.fulfill.mockResolvedValue(new Response(null, { status: 503 }));
    expect(await reconcileEclipsePayments()).toEqual({ processed: 0, failed: 1 });
    expect(mocks.writes.every((write) => !write.processed_at)).toBe(true);
  });
});

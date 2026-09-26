import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), getCharge: vi.fn(), writes: [] as Record<string, unknown>[] }));
vi.mock("@/lib/brand", () => ({ IS_GWSTORE: true }));
vi.mock("./runtime", async (importOriginal) => ({
  ...await importOriginal<typeof import("./runtime")>(),
  eclipseDatabase: () => ({ rpc: mocks.rpc, from: mocks.from }),
  getEclipsePayClient: () => ({ getCharge: mocks.getCharge }),
}));
import { reconcileEclipsePaymentLinks } from "./payment-link-reconciliation";

const id = "550e8400-e29b-41d4-a716-446655440000";
const operationId = "550e8400-e29b-41d4-a716-446655440001";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.writes.length = 0;
  vi.stubEnv("ECLIPSEPAY_API_KEY", "test-key");
  mocks.rpc.mockReturnValueOnce({ maybeSingle: async () => ({ data: {
    id, link_token: "a".repeat(64), amount_cents: 2500,
    operation_id: operationId, operation_status: "pending", confirmed_at: null,
  }, error: null }) }).mockReturnValue({ maybeSingle: async () => ({ data: null, error: null }) });
  mocks.from.mockImplementation(() => {
    const chain = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(),
      update: (values: Record<string, unknown>) => { mocks.writes.push(values); return chain; },
      then: (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null }),
    }; return chain;
  });
  mocks.getCharge.mockResolvedValue({ id: operationId, status: "completed", amountCents: 2500,
    feeCents: 50, netCents: 2450, updatedAt: "2026-09-26T12:00:00Z", expiresAt: null });
});

describe("conciliação do link Pix", () => {
  it("registra o valor recebido real após consultar o provedor", async () => {
    expect(await reconcileEclipsePaymentLinks()).toEqual({ processed: 1, failed: 0 });
    expect(mocks.getCharge).toHaveBeenCalledWith(operationId);
    expect(mocks.writes[0]).toMatchObject({
      operation_status: "completed", fee_cents: 50, net_cents: 2450,
      confirmed_at: "2026-09-26T12:00:00Z",
    });
  });
  it("não confirma valor divergente e mantém a tentativa na fila", async () => {
    mocks.getCharge.mockResolvedValue({ id: operationId, status: "completed", amountCents: 2400 });
    expect(await reconcileEclipsePaymentLinks()).toEqual({ processed: 0, failed: 1 });
    expect(mocks.writes.some((write) => write.operation_status === "completed")).toBe(false);
    expect(mocks.writes.some((write) => write.next_check_at && write.lease_token === null)).toBe(true);
  });
});

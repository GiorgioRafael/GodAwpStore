import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), createCharge: vi.fn(), getCharge: vi.fn(), writes: [] as Record<string, unknown>[] }));
vi.mock("@/lib/brand", () => ({ IS_GWSTORE: true }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/eclipsepay/runtime", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/eclipsepay/runtime")>(),
  eclipseDatabase: () => ({ rpc: mocks.rpc, from: mocks.from }),
  getEclipsePayClient: () => ({ createCharge: mocks.createCharge, getCharge: mocks.getCharge }),
}));

import { retryPaymentLink, startPaymentLink } from "./actions";

const intentId = "550e8400-e29b-41d4-a716-446655440000";
const operationId = "550e8400-e29b-41d4-a716-446655440001";
const token = "a".repeat(64);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.writes.length = 0;
  vi.stubEnv("PAYMENT_PROVIDER", "eclipsepay");
  vi.stubEnv("ECLIPSEPAY_API_KEY", "test-key");
  vi.stubEnv("ECLIPSEPAY_WEBHOOK_SECRET", "test-secret");
  mocks.rpc.mockReturnValue({ single: async () => ({ data: {
    id: intentId, link_token: token, amount_cents: 2500, operation_id: null,
    operation_status: "pending", confirmed_at: null,
  }, error: null }) });
  mocks.from.mockImplementation(() => {
    const chain = {
      eq: vi.fn().mockReturnThis(),
      then: (resolve: (value: unknown) => unknown) => resolve({ error: null }),
    };
    return { update: (value: Record<string, unknown>) => {
      mocks.writes.push(value);
      return chain;
    } };
  });
  mocks.createCharge.mockResolvedValue({
    id: operationId, status: "pending", amountCents: 2500, brCode: "pix-code",
    feeCents: 50, netCents: null, updatedAt: "2026-09-26T12:00:00Z", expiresAt: "2026-09-26T12:30:00Z",
  });
});
afterEach(() => vi.unstubAllEnvs());

function form(amount = "25,00") {
  const data = new FormData();
  data.set("name", "Comprador Teste");
  data.set("amount", amount);
  data.set("details", "Pagamento combinado no Discord");
  return data;
}

describe("link público Pix", () => {
  it("bloqueia uma nova emissão ao repetir um link antigo com EclipsePay pausada", async () => {
    vi.stubEnv("PAYMENT_PROVIDER", "livepix");
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: async () => ({
      data: { id: intentId, amount_cents: 2500, operation_id: null, operation_status: "pending" }, error: null,
    }) }) }) });
    await retryPaymentLink(token);
    expect(mocks.createCharge).not.toHaveBeenCalled();
    expect(mocks.getCharge).not.toHaveBeenCalled();
    expect(mocks.writes).toHaveLength(0);
    consoleSpy.mockRestore();
  });

  it("consulta e preserva uma cobrança já emitida mesmo com EclipsePay pausada", async () => {
    vi.stubEnv("PAYMENT_PROVIDER", "livepix");
    mocks.from.mockReturnValueOnce({ select: () => ({ eq: () => ({ maybeSingle: async () => ({
      data: { id: intentId, amount_cents: 2500, operation_id: operationId, operation_status: "pending" }, error: null,
    }) }) }) });
    mocks.getCharge.mockResolvedValue({
      id: operationId, status: "completed", amountCents: 2500, brCode: null,
      feeCents: 50, netCents: 2450, updatedAt: "2026-09-26T12:00:00Z", expiresAt: "2026-09-26T12:30:00Z",
    });
    await retryPaymentLink(token);
    expect(mocks.createCharge).not.toHaveBeenCalled();
    expect(mocks.getCharge).toHaveBeenCalledWith(operationId);
    expect(mocks.writes[0]).toMatchObject({ operation_id: operationId, operation_status: "completed", confirmed_at: "2026-09-26T12:00:00Z" });
  });

  it("não cria intenção ou cobrança manual quando a loja usa apenas LivePix", async () => {
    vi.stubEnv("PAYMENT_PROVIDER", "livepix");
    expect(await startPaymentLink(intentId, { ok: false, message: "" }, form())).toEqual({
      ok: false, message: "Esta cobrança está pausada. Compre pela loja para pagar com LivePix.",
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.createCharge).not.toHaveBeenCalled();
  });
  it("congela os dados antes da API e mantém a mesma chave idempotente", async () => {
    const result = await startPaymentLink(intentId, { ok: false, message: "" }, form());
    expect(result).toEqual({ ok: true, token });
    expect(mocks.rpc).toHaveBeenCalledWith("prepare_eclipsepay_payment_link", expect.objectContaining({
      p_intent_id: intentId, p_payer_name: "Comprador Teste", p_amount_cents: 2500,
    }));
    expect(mocks.createCharge).toHaveBeenCalledWith(intentId, {
      amountCents: 2500, description: `GWStore pagamento ${intentId}`,
    });
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(mocks.createCharge.mock.invocationCallOrder[0]);
    expect(mocks.writes[0]).toMatchObject({ operation_id: operationId, br_code: "pix-code" });
  });

  it("mantém a sessão recuperável após timeout do provedor", async () => {
    mocks.createCharge.mockRejectedValue(new Error("timeout"));
    expect(await startPaymentLink(intentId, { ok: false, message: "" }, form())).toEqual({ ok: true, token });
    expect(mocks.writes).toHaveLength(0);
  });

  it("não chama o provedor para valor inválido", async () => {
    const result = await startPaymentLink(intentId, { ok: false, message: "" }, form("1000,01"));
    expect(result.ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.createCharge).not.toHaveBeenCalled();
  });

  it("avisa sobre o limite apenas quando o banco confirma que a cota foi atingida", async () => {
    mocks.rpc.mockReturnValue({ single: async () => ({ data: null, error: { message: "Payment link hourly limit reached" } }) });
    expect(await startPaymentLink(intentId, { ok: false, message: "" }, form())).toEqual({
      ok: false,
      message: "O limite temporário de cobranças Pix foi atingido. Tente novamente mais tarde.",
    });
    expect(mocks.createCharge).not.toHaveBeenCalled();
  });

  it("não atribui outras falhas do banco ao limite de cobranças", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.rpc.mockReturnValue({ single: async () => ({ data: null, error: { message: "Database unavailable" } }) });
    expect(await startPaymentLink(intentId, { ok: false, message: "" }, form())).toEqual({
      ok: false,
      message: "Não foi possível criar o Pix agora. Tente novamente em instantes.",
    });
    expect(mocks.createCharge).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

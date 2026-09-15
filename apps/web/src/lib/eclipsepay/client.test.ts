import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { EclipsePayClient } from "./client";

const id = "550e8400-e29b-41d4-a716-446655440000";
const charge = {
  id, kind: "deposit", status: "pending", amountCents: 4000,
  feeCents: 50, netCents: null,
  createdAt: "2026-09-15T12:00:00.000Z", updatedAt: "2026-09-15T12:00:00.000Z",
  expiresAt: "2026-09-15T12:30:00.000Z", brCode: "000201-test-code",
};
describe("EclipsePayClient", () => {
  it("usa centavos, origem fixa e chave idempotente estável, sem transformar pending em pago", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(charge, { status: 202 }));
    const client = new EclipsePayClient("test-key", fetcher);
    await expect(client.createCharge(id, { amountCents: 4000 })).resolves.toMatchObject({ status: "pending" });
    await client.createCharge(id, { amountCents: 4000 });
    for (const call of fetcher.mock.calls) {
      expect(call[0]).toBe("https://eclipsepaybr.com/v1/charges");
      expect(call[1]).toMatchObject({ redirect: "error", cache: "no-store", body: '{"amountCents":4000}' });
      expect(call[1]?.headers).toMatchObject({ Authorization: "Bearer test-key", "Idempotency-Key": id });
    }
  });
  it.each([0, 79, 100001, 1.5, NaN])("recusa valor inválido %s sem chamar API", async (amountCents) => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(new EclipsePayClient("test", fetcher).createCharge(id, { amountCents })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("recusa identificador que tentaria alterar o caminho da API", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(new EclipsePayClient("test", fetcher).getCharge("../payouts")).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([{ amountCents: 3900 }, { kind: "payout" }])("recusa resposta divergente %j", async (override) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ...charge, ...override }));
    await expect(new EclipsePayClient("test", fetcher).createCharge(id, { amountCents: 4000 })).rejects.toThrow();
  });
  it("consulta pelo UUID e rejeita ID divergente", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ...charge, id: "550e8400-e29b-41d4-a716-446655440001" }));
    await expect(new EclipsePayClient("test", fetcher).getCharge(id)).rejects.toThrow("divergente");
  });
  it("não usa valor líquido como valor pago", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ...charge, status: "completed", netCents: 3950 }));
    await expect(new EclipsePayClient("test", fetcher).getCharge(id)).resolves.toMatchObject({ amountCents: 4000, netCents: 3950 });
  });
  it("não vaza corpo de erro nem refaz operação em resposta incerta", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ secret: "sensitive" }, { status: 429, headers: { "retry-after": "30" } }));
    await expect(new EclipsePayClient("test", fetcher).createCharge(id, { amountCents: 4000 })).rejects.toMatchObject({ status: 429, retryAfter: "30" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

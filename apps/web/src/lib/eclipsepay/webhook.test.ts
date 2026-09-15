import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { verifyEclipseWebhook } from "./webhook";

const secret = "webhook-test-secret";
const now = Date.parse("2026-09-15T12:00:00Z");
const event = {
  id: "550e8400-e29b-41d4-a716-446655440000", apiVersion: "v1", resourceVersion: 2,
  type: "charge.paid", createdAt: "2026-09-15T12:00:00Z",
  data: { operationId: "550e8400-e29b-41d4-a716-446655440001", kind: "deposit", status: "completed", amountCents: 4000, currency: "BRL" },
};
function signed(payload: unknown = event, timestamp = String(now / 1000), headerId = event.id) {
  const raw = Buffer.from(JSON.stringify(payload, null, 2));
  const signature = createHmac("sha256", secret).update(`${timestamp}.${headerId}.`).update(raw).digest("hex");
  return { raw, headers: new Headers({ "X-EclipSe-Event-Id": headerId, "X-EclipSe-Timestamp": timestamp, "X-EclipSe-Signature": `v1=${signature}` }) };
}
describe("EclipsePay signed webhooks", () => {
  it("valida os bytes originais e cabeçalhos case-insensitive", () => {
    const { headers, raw } = signed();
    expect(verifyEclipseWebhook(secret, headers, raw, now)).toEqual(event);
  });
  it("recusa corpo reserializado mesmo contendo o mesmo JSON", () => {
    const { headers } = signed();
    expect(() => verifyEclipseWebhook(secret, headers, Buffer.from(JSON.stringify(event)), now)).toThrow();
  });
  it.each([-301, 301])("recusa timestamp fora da tolerância: %s segundos", (offset) => {
    const { headers, raw } = signed(event, String(now / 1000 + offset));
    expect(() => verifyEclipseWebhook(secret, headers, raw, now)).toThrow();
  });
  it("aceita reentrega antiga com assinatura recente para deduplicação persistente", () => {
    const { headers, raw } = signed({ ...event, createdAt: "2026-09-13T12:00:00Z" });
    expect(verifyEclipseWebhook(secret, headers, raw, now).id).toBe(event.id);
  });
  it.each([
    { ...event, apiVersion: "v2" },
    { ...event, data: { ...event.data, status: "pending" } },
    { ...event, data: { ...event.data, currency: "USD" } },
    { ...event, data: { ...event.data, amountCents: -1 } },
    { ...event, resourceVersion: 1.2 },
    { ...event, id: "550e8400-e29b-41d4-a716-446655440002" },
  ])("recusa evento assinado inconsistente", (payload) => {
    const { headers, raw } = signed(payload);
    expect(() => verifyEclipseWebhook(secret, headers, raw, now)).toThrow();
  });
  it("recusa segredo incorreto e corpo acima de 64KB", () => {
    const { headers, raw } = signed();
    expect(() => verifyEclipseWebhook("wrong", headers, raw, now)).toThrow();
    expect(() => verifyEclipseWebhook(secret, headers, Buffer.alloc(65537), now)).toThrow();
  });
  it("permite challenge e teste sem tratá-los como pagamento", () => {
    for (const payload of [
      { ...event, type: "webhook.endpoint_verification", resourceVersion: null, data: { challenge: "challenge-value" } },
      { ...event, type: "webhook.test", resourceVersion: null, data: { test: true, message: "Test" } },
    ]) {
      const { headers, raw } = signed(payload);
      expect(verifyEclipseWebhook(secret, headers, raw, now).type).toBe(payload.type);
    }
  });
});

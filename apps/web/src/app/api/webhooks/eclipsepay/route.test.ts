import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const brand = vi.hoisted(() => ({ IS_GWSTORE: true }));
vi.mock("@/lib/brand", () => brand);
const database = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/lib/eclipsepay/runtime", () => ({ eclipseDatabase: () => database }));
vi.mock("@/lib/eclipsepay/reconciliation", () => ({ reconcileEclipsePayments: vi.fn() }));
vi.mock("@/lib/eclipsepay/payment-link-reconciliation", () => ({ reconcileEclipsePaymentLinks: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
import { POST } from "./route";

const secret = "test-webhook-secret";
function request(type: string, data: object, resourceVersion: number | null = null) {
  const id = "550e8400-e29b-41d4-a716-446655440000";
  const raw = JSON.stringify({ id, type, data, resourceVersion, apiVersion: "v1", createdAt: new Date().toISOString() });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const sig = createHmac("sha256", secret).update(`${timestamp}.${id}.${raw}`).digest("hex");
  return new Request("https://gwstore.vercel.app/api/webhooks/eclipsepay", { method: "POST", body: raw, headers: {
    "Content-Type": "application/json", "X-EclipSe-Event-Id": id,
    "X-EclipSe-Timestamp": timestamp, "X-EclipSe-Signature": `v1=${sig}`,
  } });
}
afterEach(() => { vi.unstubAllEnvs(); brand.IS_GWSTORE = true; });
describe("EclipsePay setup route", () => {
  it("não habilita EclipsePay na THStore mesmo com segredo configurado", async () => {
    brand.IS_GWSTORE = false;
    vi.stubEnv("ECLIPSEPAY_WEBHOOK_SECRET", secret);
    expect((await POST(request("webhook.test", { test: true }))).status).toBe(404);
  });
  it("falha fechado se o segredo ainda não foi configurado", async () => {
    vi.stubEnv("ECLIPSEPAY_WEBHOOK_SECRET", "");
    expect((await POST(request("webhook.test", { test: true }))).status).toBe(503);
  });
  it("devolve o challenge assinado exatamente como recebido", async () => {
    vi.stubEnv("ECLIPSEPAY_WEBHOOK_SECRET", secret);
    const result = await POST(request("webhook.endpoint_verification", { challenge: "challenge-test" }));
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ challenge: "challenge-test" });
  });
  it("aceita evento de teste sem efeitos financeiros", async () => {
    vi.stubEnv("ECLIPSEPAY_WEBHOOK_SECRET", secret);
    expect((await POST(request("webhook.test", { test: true }))).status).toBe(200);
  });
  it("recusa assinatura incorreta", async () => {
    vi.stubEnv("ECLIPSEPAY_WEBHOOK_SECRET", "wrong");
    expect((await POST(request("webhook.test", { test: true }))).status).toBe(401);
  });
  it.each(["charge.paid", "charge.failed", "charge.refunded"])("não descarta %s se persistência falhar", async (type) => {
    vi.stubEnv("ECLIPSEPAY_WEBHOOK_SECRET", secret);
    database.from.mockReturnValue({ upsert: vi.fn().mockResolvedValue({ error: { message: "offline" } }) });
    const statuses: Record<string, string> = { "charge.paid": "completed", "charge.failed": "failed", "charge.refunded": "refunded" };
    const result = await POST(request(type, {
      operationId: "550e8400-e29b-41d4-a716-446655440001", kind: "deposit",
      status: statuses[type], currency: "BRL", amountCents: 4000,
    }, 1));
    expect(result.status).toBe(503);
    expect(result.headers.get("retry-after")).toBe("60");
  });
  it("acorda também uma cobrança criada pelo link público", async () => {
    vi.stubEnv("ECLIPSEPAY_WEBHOOK_SECRET", secret);
    const update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    database.from.mockImplementation((table: string) => table === "eclipsepay_webhook_inbox"
      ? { upsert: vi.fn().mockResolvedValue({ error: null }), select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { body_sha256: "valid" }, error: null }) }) }) }
      : { update });
    // The digest is verified against the exact raw body; patch the inbox mock
    // rather than bypassing the webhook signature validator.
    const req = request("charge.paid", {
      operationId: "550e8400-e29b-41d4-a716-446655440001", kind: "deposit",
      status: "completed", currency: "BRL", amountCents: 4000,
    }, 2);
    const raw = await req.clone().text();
    const digest = (await import("node:crypto")).createHash("sha256").update(raw).digest("hex");
    database.from.mockImplementation((table: string) => table === "eclipsepay_webhook_inbox"
      ? { upsert: vi.fn().mockResolvedValue({ error: null }), select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { body_sha256: digest }, error: null }) }) }) }
      : { update });
    const result = await POST(req);
    expect(result.status).toBe(200);
    expect(database.from).toHaveBeenCalledWith("eclipsepay_payment_links");
    expect(update).toHaveBeenCalled();
  });
});
